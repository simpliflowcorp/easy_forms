import { AgentState, AgentTicket, AgentBusyError, emptySandboxStore, ExecutionTraceStep, normalizeSandboxStore } from "./types";
import { runDrafter } from "./personas/drafter";
import { runPlanner } from "./personas/planner";
import { runExecutor } from "./personas/executor";
import { runEvaluator } from "./personas/evaluator";
import { runCommunicator } from "./personas/communicator";
import { sandboxRedisStore } from "./sandbox/sandboxRedisStore";
import { mergeSandboxToProduction } from "./sandbox/sandboxMerge";
import { agentRedis } from "./sandbox/agentRedis";
import { acquireAgentLock, AgentLockHandle } from "./sandbox/agentLock";
import { newTicketId, newTraceId } from "./helper/id";
import AgentTicketModel from "@/models/agentTicketModel";
import AgentUsageModel from "@/models/agentUsageModel";
import User from "@/models/userModel";
import { LLMBudgetExceededError } from "@/lib/llmClient";
import { READ_ONLY_SKILLS } from "./policy/permissions";

export async function runAgentLoop(
  userId: string,
  prompt: string,
  mergeApproved: boolean = false,
  resumeTicketId?: string,
  sessionId?: string,
  onUpdate?: (state: AgentState) => void,
  onChunk?: (persona: string, chunk: string) => void
): Promise<AgentState> {
  const trace: ExecutionTraceStep[] = [];
  let state: AgentState | null = null;
  // Phase 6.1 (#9, #10): per-user Redis lock serializes concurrent invocations
  // of the agent loop so duplicate-sends / webhook retries / multi-tab clicks
  // no longer race on sandbox + merge slot. The lock is held until the loop
  // returns (success OR failure) so partial progress can't bleed into the
  // next invocation.
  let lock: AgentLockHandle | null = null;

  // Phase 5.4 (#18): the trace could grow unbounded across 3 iterations with
  // the entire `requirements` / `actionPlan` re-emitted per persona call,
  // and each `payload` could embed a full sandbox draft. Both the Redis
  // AgentState round-trip and the trace itself became unbounded storage.
  // We cap the rolling trace to 50 entries and truncate each payload to
  // 4 KB (with a marker). This bounds the AgentState JSON to a manageable
  // size while preserving the most recent diagnostic context.
  const MAX_TRACE_ENTRIES = 50;
  const MAX_PAYLOAD_BYTES = 4096;
  const MAX_HISTORY = 10; // 10 user + 10 assistant turns = 20 messages max

  // R2.3 — token budget configuration (env-overridable)
  const PER_TICKET_BUDGET = Number(process.env.LLM_TOKEN_BUDGET_PER_TICKET || "50000");
  const PER_USER_DAY_BUDGET = Number(process.env.LLM_TOKEN_BUDGET_PER_USER_DAY || "200000");

  // R2.3: pre-flight budget check — throws LLMBudgetExceededError if either
  // per-ticket or per-user-daily budget would be exceeded by the next call.
  // Called at the start of each loop iteration before any persona LLM call.
  const checkBudget = async (s: AgentState) => {
    // Per-ticket budget
    if (s.tokenUsage && s.tokenUsage.total >= PER_TICKET_BUDGET) {
      throw new LLMBudgetExceededError(
        `Per-ticket token budget (${PER_TICKET_BUDGET}) exceeded. Current: ${s.tokenUsage.total}. Please rephrase with fewer details.`,
        "per_ticket"
      );
    }

    // Per-user daily budget — sum today's usage from Mongo
    if (PER_USER_DAY_BUDGET > 0) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayUsage = await AgentUsageModel.aggregate([
        { $match: { userId: s.userId, createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
      ]);
      const todayTotal = todayUsage[0]?.total || 0;
      if (todayTotal >= PER_USER_DAY_BUDGET) {
        throw new LLMBudgetExceededError(
          `Daily token budget (${PER_USER_DAY_BUDGET}) exceeded. Current: ${todayTotal}. Please try again tomorrow.`,
          "per_day"
        );
      }
    }
  };

  const addTrace = (persona: AgentState["activePersona"], message: string, payload?: any, actionPlanRef?: string) => {
    if (trace.length >= MAX_TRACE_ENTRIES) {
      // Rolling window: drop the oldest 5 when we hit the cap. We drop in
      // batches so we don't pay the shift O(n) cost on every push.
      trace.splice(0, 5);
    }
    let tracedPayload = payload;
    if (payload !== undefined) {
      try {
        const json = JSON.stringify(payload);
        if (json.length > MAX_PAYLOAD_BYTES) {
          tracedPayload = { _truncated: true, originalSize: json.length, preview: json.slice(0, 500) };
        }
      } catch {
        tracedPayload = { _unserializable: true };
      }
    }
    const stepId = newTraceId();
    trace.push({
      stepId,
      timestamp: new Date().toLocaleTimeString(),
      persona,
      message,
      payload: tracedPayload,
      actionPlanRef,
    });
    if (state && onUpdate) {
      state.executionTrace = trace;
      onUpdate({ ...state });
    }
    return stepId;
  };

  // R2.2: helper to capture LLM usage from the last persona call and
  // accumulate into state.tokenUsage.
  const captureLLMUsage = (s: AgentState, persona: string) => {
    if (!s.lastLLMUsage) return;
    const { promptTokens, completionTokens, totalTokens, model } = s.lastLLMUsage;
    
    if (!s.tokenUsage) {
      s.tokenUsage = { total: 0, byPersona: {}, estimatedCost: 0 };
    }
    
    s.tokenUsage.total += totalTokens;
    
    if (!s.tokenUsage.byPersona[persona]) {
      s.tokenUsage.byPersona[persona] = { prompt: 0, completion: 0, total: 0 };
    }
    s.tokenUsage.byPersona[persona].prompt += promptTokens;
    s.tokenUsage.byPersona[persona].completion += completionTokens;
    s.tokenUsage.byPersona[persona].total += totalTokens;
    
    // Rough cost estimate: $0.0001 per 1K tokens (placeholder, refined in R8)
    s.tokenUsage.estimatedCost = Number((s.tokenUsage.total * 0.0001 / 1000).toFixed(6));
    
    // Clear the temporary field
    delete s.lastLLMUsage;
    
    // Persist per-call usage row to Mongo (AgentUsage model)
    if (typeof totalTokens === "number" && totalTokens > 0) {
      AgentUsageModel.create({
        ticketId: s.ticket.ticketId,
        userId: s.userId,
        persona,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: Number((totalTokens * 0.0001 / 1000).toFixed(6)),
      }).catch((err) => {
        console.warn(`[agentLoop] Failed to persist AgentUsage for ${persona}:`, err.message);
      });
    }
  };

  // Helper to finalize Mongo ticket status + clear/cache Redis.
  // Phase 6.2 (#7, #22): previously only Redis was cleared on success,
  // leaving Mongo tickets stuck in PROCESSING status, corrupting both the
  // Drafter's recent-context ordering and the followup-detection feature.
  // Mongo is authoritative; Redis is a resume cache.
  const markResolved = async (s: AgentState) => {
    s.executionTrace = trace;
    await AgentTicketModel.findOneAndUpdate(
      { ticketId: s.ticket.ticketId, userId: s.userId },
      { 
        ...s, 
        status: "RESOLVED", 
        isComplete: true,
        ticketId: s.ticket.ticketId,
        stage: s.ticket.stage,
        title: s.ticket.title,
        prompt: s.ticket.prompt,
        sessionId: s.ticket.sessionId,
        createdAt: s.ticket.createdAt
      },
      { upsert: true },
    );
    await agentRedis.clearState(s.ticket.ticketId);
  };

  // Create compressed trace for Mongo (no heavy payload blobs)
  const compressTraceForMongo = (trace: ExecutionTraceStep[]) => {
    return trace.map((t) => ({
      stepId: t.stepId,
      timestamp: t.timestamp,
      persona: t.persona,
      message: t.message,
      // Omit payload to keep Mongo docs small
    }));
  };

  const persistStateToRedis = async (s: AgentState) => {
    s.executionTrace = trace;
    // Mongo is authoritative; Redis is a resume cache.
    // Write Mongo on EVERY transition (D0.1 fix), then Redis.
    // If Mongo fails, Redis is never updated and the throw propagates
    // (loop's handleFailure marks LLM_ERROR consistently across both stores).
    await AgentTicketModel.findOneAndUpdate(
      { ticketId: s.ticket.ticketId, userId: s.userId },
      { 
        ...s,
        ticketId: s.ticket.ticketId,
        stage: s.ticket.stage,
        title: s.ticket.title,
        status: s.ticket.status,
        prompt: s.ticket.prompt,
        sessionId: s.ticket.sessionId,
        createdAt: s.ticket.createdAt,
        executionTrace: compressTraceForMongo(trace),
      },
      { upsert: true },
    );
    await agentRedis.saveState(s);
  };

  // Helper to handle failure fallback
  const handleFailure = async (err: any, currentState: AgentState) => {
    currentState.executionTrace = trace;

    // R2.3: handle budget exceeded with a friendly message, keep ticket alive
    if (err instanceof LLMBudgetExceededError) {
      currentState.ticket.status = "LLM_ERROR";
      currentState.isComplete = false;
      currentState.reply = err.budgetType === "per_ticket"
        ? `You've reached the token limit for this conversation (${PER_TICKET_BUDGET} tokens). Please start a new conversation or rephrase with fewer details.`
        : `You've reached the daily token limit (${PER_USER_DAY_BUDGET} tokens). Please try again tomorrow.`;
      addTrace(currentState.activePersona, `Budget exceeded: ${err.budgetType} (${err.message})`);
    } else {
      currentState.ticket.status = "LLM_ERROR";
      currentState.reply = "AI processing interrupted due to a server error. You can resume this ticket when the server is back online.";
      addTrace(currentState.activePersona, `Execution error: ${err.message}`);
    }
    currentState.isComplete = false;

    // Save to MongoDB on failure so the user can resume after a crash (RESOLVED is reserved for success).
    await AgentTicketModel.findOneAndUpdate(
      { ticketId: currentState.ticket.ticketId, userId: currentState.userId },
      { 
        ...currentState,
        ticketId: currentState.ticket.ticketId,
        stage: currentState.ticket.stage,
        title: currentState.ticket.title,
        status: currentState.ticket.status,
        prompt: currentState.ticket.prompt,
        sessionId: currentState.ticket.sessionId,
        createdAt: currentState.ticket.createdAt
      },
      { upsert: true },
    );
    return currentState;
  };

  try {
    const turnStartTimeMs = Date.now();
    // If user clicked final approval to merge sandbox -> production DB
    if (mergeApproved) {
      if (!resumeTicketId) {
        throw new Error("Missing resumeTicketId for merge approval.");
      }

      // Verify the ticket exists, belongs to the user, and is in AWAITING_USER_APPROVAL
      const dbTicket = await AgentTicketModel.findOne({ ticketId: resumeTicketId, userId }).lean();
      if (!dbTicket || (dbTicket as any).activePersona !== "AWAITING_USER_APPROVAL") {
        throw new Error("Invalid or expired ticket for merge approval.");
      }
      if (!(dbTicket as any).isComplete) {
        throw new Error("Merge rejected: ticket is not marked as complete.");
      }
      
      // Check if action digest / sandbox has expired in Redis
      const store = await sandboxRedisStore.get(userId, resumeTicketId);
      if (!store || (Object.keys(store.forms).length === 0 && store.updates.length === 0 && store.deletes.length === 0 && Object.keys(store.customViews).length === 0)) {
        throw new Error("Merge rejected: approval session expired or no pending actions.");
      }

      // Acquire the lock even for mergeApproved so two simultaneous confirmations
      // don't double-merge. The transaction is idempotent (#4) but the lock still
      // prevents confusing double-trace in the UI.
      const mergeTicketId = resumeTicketId;
      lock = await acquireAgentLock({ userId, ticketId: mergeTicketId, isReadOnly: false });

      state = {
        userId,
        prompt,
        ticket: {
          ticketId: mergeTicketId,
          stage: "STAGE_2",
          title: "DB Merge",
          prompt,
          createdAt: new Date().toISOString(),
          status: "RESOLVED",
        },
        activePersona: "MERGED_TO_PRODUCTION",
        iterationCount: 1,
        maxIterations: 3,
        requirements: {},
        actionPlan: [],
        sandbox: emptySandboxStore(),
        executionTrace: trace,
        reply: "",
        isComplete: true,
      };

      addTrace("MERGED_TO_PRODUCTION", "User approved merging Sandbox Store draft to production DB");
      const mergeStats = await mergeSandboxToProduction(userId, mergeTicketId);
      addTrace(
        "MERGED_TO_PRODUCTION",
        `Merged ${mergeStats.mergedForms} form(s) and ${mergeStats.mergedViews} view(s) (updates applied: ${mergeStats.updatesApplied}, updates missed: ${mergeStats.updatesMissed}, deletes applied: ${mergeStats.deletesApplied}, deletes missed: ${mergeStats.deletesMissed})`,
      );

      if (resumeTicketId) {
        await agentRedis.clearState(resumeTicketId);
        await AgentTicketModel.findOneAndUpdate(
          { ticketId: resumeTicketId, userId },
          { status: "RESOLVED", isComplete: true },
        );
      }

      const missedCount = mergeStats.updatesMissed + mergeStats.deletesMissed;
      if (missedCount > 0) {
        state.reply = `Successfully merged sandbox changes to production DB! (Forms created: ${mergeStats.mergedForms}, Views created: ${mergeStats.mergedViews})` +
          `\n\n⚠️ Warning: ${missedCount} change(s) couldn't be applied because the form was modified elsewhere after you previewed it. Please re-open the form and try again.`;
      } else {
        state.reply = `Successfully merged sandbox changes to production DB! (Forms created: ${mergeStats.mergedForms}, Views created: ${mergeStats.mergedViews})`;
      }
      if (onUpdate) onUpdate({ ...state });
      return state;
    }

    // Allocate a NEW ticket ID for the non-resume path BEFORE acquiring the
    // lock — so the lock's token carries the ticketId we're about to run.
    // (Phase 6.1: previously this ID was generated at "step 2" inside the
    // init block, AFTER the lock was acquired, so lock-compared-del could
    // never match the ticket being run.)
    const pendingTicketId = resumeTicketId || newTicketId();

    // For merge path, acquire write lock immediately.
    // For non-merge, we'll acquire the appropriate lock after Drafter classifies.
    const mergeTicketId = resumeTicketId!;
    if (mergeApproved) {
      lock = await acquireAgentLock({ userId, ticketId: mergeTicketId, isReadOnly: false });
    }

    // 1. Resume Logic: Check Redis, then MongoDB
    if (resumeTicketId) {
      let resumedState = await agentRedis.getState(resumeTicketId);
      if (!resumedState) {
        const dbTicket = await AgentTicketModel.findOne({
          ticketId: resumeTicketId,
          userId,
        }).lean();
        if (dbTicket) {
          resumedState = {
            ...dbTicket,
            ticket: {
              ticketId: (dbTicket as any).ticketId,
              stage: (dbTicket as any).stage,
              title: (dbTicket as any).title,
              prompt: (dbTicket as any).prompt,
              createdAt: (dbTicket as any).createdAt,
              status: (dbTicket as any).status,
            }
          } as unknown as AgentState;
          // Phase 1.1 (#17): legacy sandbox objects persisted before the remodel
          // lack `updates` / `deletes` arrays. Coerce to canonical so the new
          // sandboxRedisStore APIs don't silently drop pending intentions on resume.
          resumedState.sandbox = normalizeSandboxStore(resumedState.sandbox);
          // Replay the historical trace into our in-memory buffer.
          resumedState.executionTrace?.forEach((t) => trace.push(t));
          addTrace("DRAFTER", "Resumed ticket from MongoDB backup.");
        }
      } else {
        resumedState.sandbox = normalizeSandboxStore(resumedState.sandbox);
        resumedState.executionTrace?.forEach((t) => trace.push(t));
        addTrace("DRAFTER", "Resumed ticket from Redis cache.");
      }

      // Phase 6.2 (#7): reset the stale `linkedTicketId` so a resumed ticket
      // doesn't re-crosslink to the prior followup. The new user input will
      // be re-evaluated by the Drafter's recent-ticket logic on its own merits.
      if (resumedState) {
        if (resumedState.requirements) resumedState.requirements.linkedTicketId = undefined;
        resumedState.requirements.isFollowUpConfirmed = false;
      }

      // #4.4: previously we overwrote state.prompt here, destroying the
      // original prompt — which broke the trace and the Evaluator's "User
      // Request" field. Now we keep the original prompt for traceability and
      // stash the new user input in a separate field. Downstream personas that
      // need the LATEST user input read `state.resumedPrompt ?? state.prompt`.
      if (resumedState) {
        resumedState.resumedPrompt = prompt;
        
        // A new user prompt means we must re-evaluate intent. Reset the loop back
        // to the DRAFTER so it can parse the new input and decide what to do.
        resumedState.activePersona = "DRAFTER";
        resumedState.isComplete = false;
        resumedState.isQuestion = false;
        resumedState.reply = undefined;
        resumedState.drafterMessage = undefined;
        resumedState.evaluatorFeedback = undefined;
        resumedState.actionPlan = [];
        resumedState.iterationCount = 1; // Reset iteration count so the loop doesn't instantly exit

        if (resumedState.ticket.status === "RESOLVED") {
          resumedState.ticket.status = "PROCESSING";
        }
      }

      // At this point resumedState is guaranteed non-null if we're resuming
      if (resumedState) {
        state = resumedState;

        // R5: Add the new user prompt to conversation history on resume
        if (resumedState.conversationHistory) {
          state.conversationHistory?.push({
            role: "user",
            content: prompt, // the new prompt from the user
            ticketId: state.ticket.ticketId,
            timestamp: new Date().toISOString(),
          });
        } else {
          state.conversationHistory = [{
            role: "user",
            content: prompt,
            ticketId: state.ticket.ticketId,
            timestamp: new Date().toISOString(),
          }];
        }
      }
    }

    // 2. Initialization if not resuming.
    if (!state) {
      const initialTicket: AgentTicket = {
        ticketId: pendingTicketId,
        stage: "STAGE_1",
        title: "Processing Ticket...",
        prompt,
        sessionId,
        createdAt: new Date().toISOString(),
        status: "PROCESSING",
      };

      state = {
        userId,
        prompt,
        ticket: initialTicket,
        activePersona: "DRAFTER",
        iterationCount: 1,
        maxIterations: 3,
        requirements: {},
        actionPlan: [],
        sandbox: emptySandboxStore(),
        executionTrace: trace,
        conversationHistory: [], // R5: initialize empty conversation history
      };
      addTrace("DRAFTER", `Initiating prompt digestion for: "${prompt}"`);

      // R5: Add initial user prompt to conversation history
      state.conversationHistory?.push({
        role: "user",
        content: prompt,
        ticketId: initialTicket.ticketId,
        timestamp: new Date().toISOString(),
      });
    }

    // At this point `state` is guaranteed non-null but TS cannot infer it
    // across the (possibly null) assignments above. Use a non-null alias.
    const activeState: AgentState = state;
    state = activeState;

// Layer 5: Inject User Profile and Preferences
    if (!state.userContext) {
      try {
        const userDoc = await User.findById(userId).lean();
        if (userDoc) {
          state.userContext = {
            profile: {
              username: userDoc.username,
              email: userDoc.email,
              ...(userDoc.profile || {}),
            },
            preferences: userDoc.preferences || {},
          };
        }
      } catch (e) {
        console.warn(`[agentLoop] failed to fetch userContext for ${userId}`, e);
      }
    }

    // R4: Run Drafter first to classify the request, then acquire appropriate lock
    // Use a short "classification lock" to prevent double-submits during classification
    let classificationLock: AgentLockHandle | null = null;
    try {
      const classificationKey = `agent_lock:classify:${userId}`;
      const ok = await agentRedis.client.set(classificationKey, pendingTicketId, "PX", 5000, "NX");
      if (!ok) throw new AgentBusyError();
      classificationLock = {
        release: async () => {
          const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
          await agentRedis.client.eval(script, 1, classificationKey, pendingTicketId);
        },
        stale: () => false,
      };

      // Run Drafter to classify the request
      state = await runDrafter(state);
      state.executionTrace = trace;
      addTrace(
        state.activePersona,
        `Drafter classified Ticket as [${state.ticket.stage}]: "${state.ticket.title}"`,
        {
          requirements: state.requirements,
          isQuestion: state.isQuestion,
          reply: state.reply,
          llmRawOutput: state.llmRawOutput,
        },
      );
      captureLLMUsage(state, "DRAFTER");
      await persistStateToRedis(state);

      // Handle early returns from Drafter
      if (state.activePersona === "REJECTED" || state.isQuestion || state.isComplete) {
        if (state.isComplete) {
          await markResolved(state);
        }
        return state;
      }

      // R4: Determine if read-only and acquire appropriate lock
      const isReadOnly = READ_ONLY_SKILLS.has(state.requirements.skill || "");
      lock = await acquireAgentLock({ userId, ticketId: pendingTicketId, isReadOnly });

    } finally {
      // Release classification lock
      if (classificationLock) {
        await classificationLock.release();
      }
    }

    try {
      let isLooping = true;
      while (isLooping) {
        // R2.3: budget pre-check before any LLM call in this iteration
        await checkBudget(state);

        // Track planner step ID for actionPlanRef in Executor trace
        let plannerStepId: string | undefined;

        if (onChunk) {
          const currentPersona = state.activePersona;
          state.onChunk = (chunk: string) => onChunk(currentPersona, chunk);
        } else {
          state.onChunk = undefined;
        }

        // Phase 6.3 (#16): simulated-offline is now per-ticket, not global.
        const simOfflineKey = `agent:simulated_offline:${state.ticket.ticketId}`;
        const isSimulatedOffline = (await agentRedis.client.get(simOfflineKey)) === "true";
        if (isSimulatedOffline) {
          throw new Error("Simulated LLM Offline Crash Triggered");
        }

        // Stage 1: Drafter Persona (already run, skip to next persona)
        if (state.activePersona === "DRAFTER") {
          // Should not reach here - Drafter already ran
          state.activePersona = "PLANNER";
        }
        // Stage 2: Planner Persona
        else if (state.activePersona === "PLANNER") {
          if ((await agentRedis.client.get(simOfflineKey)) === "true") {
            throw new Error("Simulated LLM Offline Crash Triggered during Planner");
          }

          addTrace("PLANNER", "Handing context to Planner Persona for Action Plan compilation");
          state = await runPlanner(state);
          state.executionTrace = trace;
          plannerStepId = addTrace("PLANNER", `Planner compiled ${state.actionPlan.length} action step(s)`, state.actionPlan);
          captureLLMUsage(state, "PLANNER");
          await persistStateToRedis(state);
        }
        // Stage 3: Executor Persona (Sandbox Isolation)
        else if (state.activePersona === "EXECUTOR_SANDBOX") {
          addTrace("EXECUTOR_SANDBOX", "Executing Action Plan inside isolated Sandbox Store");
          state = await runExecutor(state);
          state.executionTrace = trace;
          addTrace("EXECUTOR_SANDBOX", "Sandbox Execution finished", undefined, plannerStepId);
          // Executor doesn't call LLM directly, but if it did we'd capture here
          await persistStateToRedis(state);
        }
        // Stage 4: Evaluator Persona (Loop Verification)
        else if (state.activePersona === "EVALUATOR") {
          addTrace("EVALUATOR", "Handing sandbox results to Evaluator Persona for Quality Assurance");
          state = await runEvaluator(state);
          state.executionTrace = trace;
          addTrace(state.activePersona, `Evaluator finished QA check (Iteration ${state.iterationCount}/${state.maxIterations})`, {
            feedback: state.evaluatorFeedback,
          });
          captureLLMUsage(state, "EVALUATOR");
          await persistStateToRedis(state);
        }
        // Stage 5: Communicator Persona (Final Response Generation)
        else if (state.activePersona === "COMMUNICATOR") {
          addTrace("COMMUNICATOR", "Generating final response for the user");
          const latencyMs = Date.now() - turnStartTimeMs;
          state = await runCommunicator(state, latencyMs);
          state.executionTrace = trace;
          addTrace(state.activePersona, `Communicator formulated final reply`, {
            reply: state.reply,
          });
          captureLLMUsage(state, "COMMUNICATOR");

          // R5: Add Communicator's reply to conversation history
          if (state.reply) {
            state.conversationHistory?.push({
              role: "assistant",
              content: state.reply,
              ticketId: state.ticket.ticketId,
              timestamp: new Date().toISOString(),
            });
            // Cap history at MAX_HISTORY turns (user + assistant = 2 messages per turn)
            const maxMessages = MAX_HISTORY * 2;
            if (state.conversationHistory && state.conversationHistory.length > maxMessages) {
              state.conversationHistory = state.conversationHistory.slice(-maxMessages);
            }
          }

          // Phase 6.2 (#22): finalize Mongo + Redis coherently per the Evaluator's
          // verdict instead of the previous "clear Redis but leave Mongo PROCESSING".
          // P2-6: Communicator may set status to LLM_ERROR on offline/failure.
          if (state.ticket.status === "LLM_ERROR") {
            // Offline or error — keep ticket alive for resume, don't mark resolved.
            await persistStateToRedis(state);
          } else if (state.isComplete) {
            await markResolved(state);
          } else {
            // Question / clarification pending — keep state alive for the user.
            await persistStateToRedis(state);
          }
          isLooping = false;
        }
        // The Evaluator may have set AWAITING_USER_APPROVAL directly (Phase
        // 4.1) without routing through the Communicator. We must persist
        // state to Redis here so the user's pending merge intent survives
        // until they click "Confirm & Merge" — without this, the resumed
        // request would have no sandbox cache to merge from.
        else if (state.activePersona === "AWAITING_USER_APPROVAL") {
          await persistStateToRedis(state);
          isLooping = false;
        } else {
          // If we reach a state that is not one of the loop stages, break out
          isLooping = false;
        }
      }

      return state;
    } catch (error) {
      return await handleFailure(error, state);
    }
  } catch (outerError: any) {
    // Phase 6.1: lock-acquire failures (AgentBusyError) and other top-level
    // errors that bubbled before we got an AgentState. We can't form a real
    // AgentState for these — re-throw so the SSE route handler in
    // /api/agent/execute can map to HTTP 409 / 500 appropriately.
    if (outerError instanceof AgentBusyError) {
      // Re-throw to let the route handler craft the 409 response.
      throw outerError;
    }
    // Unknown outer error: surface as a minimal state so the client sees a reply.
    if (state) {
      return handleFailure(outerError, state);
    }
    throw outerError;
  } finally {
    // Phase 6.1: always release the lock — `release` is compare-and-del so
    // we only delete if we still own it. If our lock expired mid-loop we set
    // `stale()` true and the existence-on-disk-of-our-intentions is checked
    // at resume-time by the next loop iteration's `normalizeSandboxStore`.
    if (lock) {
      await lock.release();
      if (lock.stale()) {
        console.warn(
          `[agentLoop] user ${userId} ticket ${state?.ticket?.ticketId} — agent lock expired mid-run. User should retry if state looks stale.`,
        );
      }
    }
  }
}
