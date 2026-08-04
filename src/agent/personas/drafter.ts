import { AgentState, AgentTicket, ExecutionTraceStep } from "../types";
import { newTraceId } from "../helper/id";
import { retryLLM, LLMOfflineError } from "@/lib/llmClient";
import AgentTicketModel from "@/models/agentTicketModel";
import Form from "@/models/formModel";
import { checkPermission, READ_ONLY_SKILLS } from "../policy/permissions";
import { parsePersona, DrafterOutputSchema } from "../helper/validate";
import { loadPersonaPrompt } from "../prompts/loader";
import { resolveSkill } from "./skillRouter.js";
import { logWarn, logInfo } from "@/lib/logger";

// MemoryService is owned by Agent C (src/agent/memory/service.ts).
// In Stage 2, it may not exist yet; we import dynamically and handle gracefully.
let memoryService: any = null;
try {
  memoryService = require("@/agent/memory").memoryService;
} catch {
  // Service not yet implemented — memory hydration will be skipped.
  memoryService = null;
}

export async function runDrafter(state: AgentState): Promise<AgentState> {
  const { userId } = state;
  const prompt = state.resumedPrompt ?? state.prompt;

  // Fetch recent tickets for context (#4.4):
  //   - Exclude the current ticket AND tickets that are no longer recoverable
  //     (REJECTED, LLM_ERROR) so the LLM doesn't try to follow up on dead work.
  //   - Cap to 3 most recent; the previous code bundled all 5 raw entries
  //     which doubled the prompt size AND leaked the user's error history.
  const query: any = {
    userId,
    ticketId: { $ne: state.ticket.ticketId },
    status: { $nin: ["REJECTED", "LLM_ERROR"] },
  };

  if (state.ticket.sessionId) {
    query.sessionId = state.ticket.sessionId;
  }

  const recentTickets = await AgentTicketModel.find(query)
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  const recentContext = recentTickets.map((t: any) => ({
    ticketId: t.ticketId,
    title: t.title,
    originalPrompt: t.prompt,
    agentReply: t.reply || "No reply yet",
    status: t.status,
  }));

  const pendingQuestionContext = state.isQuestion ? state.reply : null;
  state.recentContext = recentContext;

  // R5: Prepare conversation history for context (last 3 turns = 6 messages max)
  const recentConversation = state.conversationHistory
    ? state.conversationHistory.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")
    : "None";

  // Fetch existing form names to help Drafter resolve titles.
  const existingForms = await Form.find({ user: userId }).select("name").limit(20).lean();
  const formNames = existingForms.map((f: any) => f.name).join(", ");

  // A-S2.5: Memory hydration — fetch recurring fields and recent failures
  // Inject into state.userContext for the Planner to use
  if (memoryService) {
    try {
      const recurringFields = await memoryService.getMemory(userId, "recurring_fields");
      const recentFailures = await memoryService.recentFailures(userId, 7 * 24 * 60 * 60 * 1000); // 7 days
      
      state.memory = {
        recurringFields: Array.isArray(recurringFields) ? recurringFields[0]?.value : recurringFields?.value,
        recentFailures: recentFailures.map((f: any) => ({
          promptHash: f.promptHash,
          lastError: f.lastError,
          count: f.count,
          lastAt: f.lastAt,
        })),
      };
      
      // Also merge recurring fields into userContext for the Planner
      if (state.memory.recurringFields) {
        state.userContext = {
          ...state.userContext,
          recurringFields: state.memory.recurringFields,
        };
      }
    } catch (err) {
      logWarn(`[drafter] Memory hydration failed:`, { error: String(err) });
    }
  }

  let llmAnalysis: any = null;
  let rawContent: string = "";
  try {
    // R7: Load prompt from versioned file
    const { systemPrompt } = loadPersonaPrompt("drafter");
    
    const message = await retryLLM(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `CURRENT LOCAL TIME: ${new Date().toLocaleString()}\n\nEXISTING FORMS: [${formNames}]\n\nUSER PREFERENCES AND PROFILE:\n${JSON.stringify(
            state.userContext || {},
            null,
            2,
          )}\n\nRECENT TICKETS CONTEXT:\n${JSON.stringify(
            recentContext,
            null,
            2,
          )}\n\nCONVERSATION HISTORY (last 3 turns):\n${recentConversation}\n\nPENDING QUESTION CONTEXT:\n${pendingQuestionContext || "None"}\n\nUSER PROMPT:\n${prompt}`,
        },
      ],
      {
        response_format: { type: "json_object" },
        onChunk: state.onChunk,
        temperature: 0.7,
      },
    );

    rawContent = message?.content || "";
    logInfo("LLM Raw Output:", { rawContent });

    // R2.2: capture LLM usage for token tracking
    if (message?.usage) {
      state.lastLLMUsage = message.usage;
    }

    // Validate LLM output against Drafter schema
    llmAnalysis = parsePersona(rawContent, DrafterOutputSchema);
  } catch (err: any) {
    // #21: propagate offline/auth errors with typed status so the loop can
    // write `LLM_ERROR` to Mongo and the user can resume. Previously every
    // failure merged into a single "Semantic parsing failed" throw and the
    // user couldn't tell whether the LLM was down, the model rejected auth,
    // or the JSON was just malformed.
    if (err instanceof LLMOfflineError) {
      state.ticket.status = "LLM_ERROR";
      state.reply = "AI is offline right now. You can resume this ticket when the service is back.";
      state.llmRawOutput = `LLMOfflineError: ${err.message}`;
      return { ...state, activePersona: "DRAFTER", isQuestion: true };
    }
    logWarn("LLM Drafter call failed or timed out. Error:", { error: err.message });
    rawContent = `Error: ${err.message}`;
  }

  if (!llmAnalysis) {
    // Replaces the old `throw new Error("Semantic parsing failed...")` which
    // would abort the whole ticket if the LLM ever emitted malformed JSON.
    // Now we surface the failure as a clarifying question so the user can
    // rephrase — they are not punished for a parser bug.
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply:
        "I had trouble parsing the AI's intent output. Could you rephrase your request? " +
        "If the problem persists, the model may be returning a non-JSON response — try again in a moment.",
      llmRawOutput: rawContent,
      ticket: { ...state.ticket, status: "OPEN" },
    };
  }

  // #8: resuscitate the `isFollowUpConfirmed` branch. Previously it set a
  // flag and then fell through to the isVague check below — guaranteeing the
  // user was asked to specify form title and fields all over again even after
  // confirming "yes" to "was that form X?". Now we actually load the linked
  // ticket's previously-classified requirements from Mongo and merge them in,
  // then skip the isVague check entirely.
  if (llmAnalysis.isFollowUpConfirmed && llmAnalysis.followUpTicketId) {
    const linkedTicket = (await AgentTicketModel.findOne({
      ticketId: llmAnalysis.followUpTicketId,
      userId,
    }).lean()) as any;
    if (linkedTicket?.requirements) {
      state.requirements = {
        ...linkedTicket.requirements,
        // Mark the followup flag so downstream personas know we resumed a
        // prior ticket's context, not first-class requirements from scratch.
        linkedTicketId: llmAnalysis.followUpTicketId,
        isFollowUpConfirmed: true,
      };
    }
    state.isQuestion = false;
  }

  // Update ticket stage based on Drafter LLM intent analysis.
  const updatedTicket: AgentTicket = {
    ...state.ticket,
    stage: llmAnalysis.stage || "STAGE_1",
    title: llmAnalysis.title || "Agent Ticket",
  };
  state.ticket = updatedTicket;

  if (llmAnalysis.isTopicChange || llmAnalysis.isCancellation) {
    state.requirements.linkedTicketId = undefined;
    state.requirements.isFollowUpConfirmed = false;
  }

  // If the user explicitly cancelled the previous task without a new directive,
  // we should just acknowledge and stop here, rather than treating it as vague.
  if (llmAnalysis.isCancellation) {
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      isComplete: true,
      reply: llmAnalysis.guideResponse || "No problem, we can skip that. What would you like to do instead?",
      llmRawOutput: rawContent,
    };
  }

  // Handle Product Guide / FAQ questions & General Chat.
  if (llmAnalysis.skill === "product_guide" || llmAnalysis.skill === "general_chat") {
    return {
      ...state,
      // Mark complete so agentLoop clears Redis state (#6.2 prep) instead of
      // leaving the FAQ ticket marked PROCESSING forever in Mongo.
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      isComplete: true,
      reply:
        [llmAnalysis.guideResponse, llmAnalysis.clarifyingQuestion]
          .filter(Boolean)
          .join(" ") ||
        "Hello! I am your Easy Forms AI agent. How can I assist you today?",
      llmRawOutput: rawContent,
    };
  }

  // Handle Unsupported skills or Greetings.
  if (llmAnalysis.skill === "unsupported") {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply: llmAnalysis.clarifyingQuestion || "Hello! How can I assist you with Easy Forms today?",
      llmRawOutput: rawContent,
    };
  }

  // Handle Unsupported skills or Greetings.
  if (llmAnalysis.skill === "unsupported") {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply: llmAnalysis.clarifyingQuestion || "Hello! How can I assist you with Easy Forms today?",
      llmRawOutput: rawContent,
    };
  }


  // R1: Read-only short-circuit — if the skill is a pure read, bypass
  // Planner/Executor/Evaluator and go directly to Communicator.
  // A-S2.3: Route via Skill Router instead of hardcoded dispatch.
  if (READ_ONLY_SKILLS.has(llmAnalysis.skill)) {
    const skillResult = await resolveSkill(llmAnalysis.skill, state.userId);
    if (!skillResult.allowed || !skillResult.skill) {
      return {
        ...state,
        activePersona: "REJECTED",
        isQuestion: true,
        reply: skillResult.reason || `Unknown read-only skill: ${llmAnalysis.skill}`,
        llmRawOutput: rawContent,
      };
    }
    
    // Use the skill's first tool (read-only skills typically have one tool)
    const readTool = skillResult.skill.tools[0]?.tool || llmAnalysis.skill;
    const { executeAgentTool } = await import("../../lib/agentTools.js");
    const toolResult = await executeAgentTool(readTool, llmAnalysis.requirements || {}, state.userId);
    
    // Add trace step for read-only shortcut (D0.10)
    const readTraceStep: ExecutionTraceStep = {
      stepId: newTraceId(),
      timestamp: new Date().toLocaleTimeString(),
      persona: "DRAFTER",
      message: `Read query: ${readTool} (via skill: ${llmAnalysis.skill})`,
      payload: { tool: readTool, params: llmAnalysis.requirements || {}, result: toolResult, skill: llmAnalysis.skill },
    };
    state.executionTrace?.push(readTraceStep);
    
    // Build minimal state for Communicator to render the read result
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isComplete: true,
      isReadOnly: true,
      isQuestion: false,
      actionPlan: [{
        id: "read_1",
        tool: readTool,
        params: llmAnalysis.requirements || {},
        result: toolResult,
        status: "done",
        description: `Read query: ${readTool} (via skill: ${llmAnalysis.skill})`,
        owningSkill: llmAnalysis.skill,
      }],
      requirements: {
        ...state.requirements,
        skill: llmAnalysis.skill,
      },
      drafterMessage: `Drafter classified as read-only: ${llmAnalysis.skill} (via Skill Router).`,
      llmRawOutput: rawContent,
    };
  }
  if (llmAnalysis.isVague || (llmAnalysis.isFollowUp && !llmAnalysis.isFollowUpConfirmed && llmAnalysis.clarifyingQuestion)) {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply:
        llmAnalysis.clarifyingQuestion ||
        (llmAnalysis.skill === "build_form" || llmAnalysis.isVague
          ? "I can help you build a form! To gather all required parameters per guidelines.md, please specify:\n" +
            "1. Form Title\n" +
            "2. What specific fields to include (e.g. Full Name, Email, Star Rating, Comments)\n" +
            "3. Which fields are mandatory"
          : "Could you please clarify your request?"),
      llmRawOutput: rawContent,
    };
  }

  // Phase 2: enforce the configured permission scopes for the chosen skill.
  const perm = checkPermission(llmAnalysis.skill);
  if (!perm.allowed) {
    return {
      ...state,
      activePersona: "REJECTED",
      isQuestion: true,
      reply:
        perm.scope === "_always_allowed" || !perm.scope
          ? perm.reason || "Permission denied."
          : `Permission Denied: '${perm.scope}' is currently disabled in permissions.json.`,
      llmRawOutput: rawContent,
    };
  }


  // Store digested requirements.
  // #19: removed the hardcoded `[Full Name, Email Address]` fallback. The
  // Drafter's system prompt Rule #1 explicitly says "DO NOT assume or invent
  // default form fields if the prompt is vague". The fallback contradicted
  // that trust and produced surprise 2-field forms whenever the LLM happened
  // to omit `requirements.fields` for a non-flagged-as-vague prompt. Now we
  // instead force `isVague` so the user is consulted — never surprised.
  const reqFields = llmAnalysis.requirements?.fields;
  if (llmAnalysis.skill === "build_form" && (!Array.isArray(reqFields) || reqFields.length === 0)) {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply:
        llmAnalysis.clarifyingQuestion ||
        "I can help you build that form — but I need a bit more detail. Please specify:\n" +
          "1. A title for the form\n" +
          "2. The specific fields to include (e.g. Full Name, Email, Star Rating, Comments)\n" +
          "3. Which of those fields are mandatory",
      llmRawOutput: rawContent,
    };
  }

  state.requirements = {
    ...state.requirements,
    skill: llmAnalysis.skill,
    formTitle: llmAnalysis.requirements?.formTitle || prompt.substring(0, 30),
    formDescription: prompt,
    fields: reqFields || undefined,
  };

  return {
    ...state,
    activePersona: "PLANNER",
    isQuestion: false,
    drafterMessage: `Drafter Persona digested prompt intent as ${llmAnalysis.skill}. Requirements ready for Planner.`,
    llmRawOutput: rawContent,
  };
}
