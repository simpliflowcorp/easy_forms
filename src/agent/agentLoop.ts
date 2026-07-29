import { AgentState, AgentTicket, ExecutionTraceStep } from "./types";
import { runDrafter } from "./personas/drafter";
import { runPlanner } from "./personas/planner";
import { runExecutor } from "./personas/executor";
import { runEvaluator } from "./personas/evaluator";
import { sandboxStore } from "./sandbox/sandboxStore";
import { agentRedis } from "./sandbox/agentRedis";
import AgentTicketModel from "@/models/agentTicketModel";

export async function runAgentLoop(
  userId: string,
  prompt: string,
  mergeApproved: boolean = false,
  resumeTicketId?: string
): Promise<AgentState> {
  const trace: ExecutionTraceStep[] = [];

  const addTrace = (persona: AgentState["activePersona"], message: string, payload?: any) => {
    trace.push({
      stepId: `trc_${Date.now()}_${trace.length + 1}`,
      timestamp: new Date().toLocaleTimeString(),
      persona,
      message,
      payload,
    });
  };

  // If user clicked final approval to merge sandbox -> production DB
  if (mergeApproved) {
    addTrace("MERGED_TO_PRODUCTION", "User approved merging Sandbox Store draft to production DB");
    const mergeStats = await sandboxStore.mergeToProduction(userId);
    addTrace("MERGED_TO_PRODUCTION", `Merged ${mergeStats.mergedForms} form(s) and ${mergeStats.mergedViews} view(s)`);
    
    if (resumeTicketId) {
      await agentRedis.clearState(resumeTicketId);
      await AgentTicketModel.findOneAndUpdate({ ticketId: resumeTicketId, userId }, { status: "RESOLVED", isComplete: true });
    }

    return {
      userId,
      prompt,
      ticket: {
        ticketId: resumeTicketId || `tkt_${Date.now()}`,
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
      sandbox: { forms: {}, customViews: {}, queryResults: {} },
      executionTrace: trace,
      reply: `Successfully merged sandbox changes to production DB! (Forms created: ${mergeStats.mergedForms}, Views created: ${mergeStats.mergedViews})`,
      isComplete: true,
    };
  }

  let state: AgentState | null = null;

  // 1. Resume Logic: Check Redis, then MongoDB
  if (resumeTicketId) {
    state = await agentRedis.getState(resumeTicketId);
    if (!state) {
      const dbTicket = await AgentTicketModel.findOne({ ticketId: resumeTicketId, userId }).lean();
      if (dbTicket) {
        state = dbTicket as unknown as AgentState;
        state.executionTrace?.forEach(t => trace.push(t));
        addTrace("DRAFTER", "Resumed ticket from MongoDB backup.");
      }
    } else {
      state.executionTrace?.forEach(t => trace.push(t));
      addTrace("DRAFTER", "Resumed ticket from Redis cache.");
    }
  }

  // 2. Initialization if not resuming
  if (!state) {
    const initialTicket: AgentTicket = {
      ticketId: `tkt_${Date.now()}`,
      stage: "STAGE_1",
      title: "Processing Ticket...",
      prompt,
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
      sandbox: sandboxStore.getStore(userId),
      executionTrace: trace,
    };
    addTrace("DRAFTER", `Initiating prompt digestion for: "${prompt}"`);
  }

  // Helper to handle failure fallback
  const handleFailure = async (err: any, currentState: AgentState) => {
    addTrace(currentState.activePersona, `Execution error: ${err.message}`);
    currentState.executionTrace = trace;
    currentState.ticket.status = "LLM_ERROR";
    currentState.reply = "AI processing interrupted due to a server error. You can resume this ticket when the server is back online.";
    
    // Save to MongoDB on failure
    await AgentTicketModel.findOneAndUpdate(
      { ticketId: currentState.ticket.ticketId, userId: currentState.userId },
      { ...currentState },
      { upsert: true }
    );
    return currentState;
  };

  try {
    // Check if we are simulating an offline crash for testing
    const isSimulatedOffline = await agentRedis.getState("simulated_offline") || await (await import("./sandbox/agentRedis.js")).redisClient.get("agent:simulated_offline");
    if (isSimulatedOffline === "true") {
      throw new Error("Simulated LLM Offline Crash Triggered");
    }

    // Stage 1: Drafter Persona
    if (state.activePersona === "DRAFTER") {
      state = await runDrafter(state);
      state.executionTrace = trace;
      addTrace(state.activePersona, `Drafter classified Ticket as [${state.ticket.stage}]: "${state.ticket.title}"`, {
        requirements: state.requirements,
        isQuestion: state.isQuestion,
        reply: state.reply,
        llmRawOutput: state.llmRawOutput,
      });
      await agentRedis.saveState(state);

      if (state.activePersona === "REJECTED" || state.isQuestion || state.isComplete) {
        if (state.isComplete) await agentRedis.clearState(state.ticket.ticketId);
        return state;
      }
    }

    // Stage 2: Planner Persona
    if (state.activePersona === "PLANNER") {
      // Re-check simulation flag to allow crashing mid-loop
      if (await (await import("./sandbox/agentRedis.js")).redisClient.get("agent:simulated_offline") === "true") {
        throw new Error("Simulated LLM Offline Crash Triggered during Planner");
      }
      
      addTrace("PLANNER", "Handing context to Planner Persona for Action Plan compilation");
      state = await runPlanner(state);
      state.executionTrace = trace;
      addTrace("PLANNER", `Planner compiled ${state.actionPlan.length} action step(s)`, state.actionPlan);
      await agentRedis.saveState(state);
    }

    // Stage 3: Executor Persona (Sandbox Isolation)
    if (state.activePersona === "EXECUTOR_SANDBOX") {
      addTrace("EXECUTOR_SANDBOX", "Executing Action Plan inside isolated Sandbox Store");
      state = await runExecutor(state);
      state.executionTrace = trace;
      addTrace("EXECUTOR_SANDBOX", "Sandbox Execution finished", state.actionPlan);
      await agentRedis.saveState(state);
    }

    // Stage 4: Evaluator Persona (Loop Verification)
    if (state.activePersona === "EVALUATOR") {
      addTrace("EVALUATOR", "Handing sandbox results to Evaluator Persona for Quality Assurance");
      state = await runEvaluator(state);
      state.executionTrace = trace;
      addTrace(state.activePersona, `Evaluator finished QA check (Iteration ${state.iterationCount}/${state.maxIterations})`, {
        isComplete: state.isComplete,
        feedback: state.evaluatorFeedback,
      });
      
      if (state.isComplete && state.activePersona !== "AWAITING_USER_APPROVAL") {
        await agentRedis.clearState(state.ticket.ticketId);
      } else {
        await agentRedis.saveState(state);
      }
    }

    return state;
  } catch (error) {
    return await handleFailure(error, state);
  }
}
