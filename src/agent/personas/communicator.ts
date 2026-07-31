import { AgentState } from "../types";
import { retryLLM } from "@/lib/llmClient";

export async function runCommunicator(state: AgentState): Promise<AgentState> {
  /** Phase 4.1 (#1, #14): the Communicator no longer transitions to
   *  AWAITING_USER_APPROVAL. That decision is owned by the Evaluator, which
   *  has the QA verdict on hand. We arrived here either because the Evaluator
   *  signed off (already sets isComplete / activePersona appropriately) or
   *  because the Evaluator routed to us to ask the human a question (its
   *  retry-budget-exhausted branch). In both cases our job is purely to
   *  render the user-facing reply text — preserve the activePersona given to
   *  us by the Evaluator instead of mutating it back. */

  try {
    const summaryPayload = state.actionPlan.map((a) => ({
      tool: a.tool,
      params: redactPII(a.params),
      result: redactPII(a.result),
    }));

    const response = await retryLLM([
      {
        role: "system",
        content:
          "You are the AI Communicator for Easy Forms.\n" +
          "Your persona is kind, conversational, and extremely concise.\n" +
          "You are speaking directly to the user in a chat interface.\n" +
          "Read the User's Request, the Tool Execution Results, and the Evaluator's Assessment.\n" +
          "Your job is to reply directly with ONLY the requested information or a short one-liner confirming the action taken. " +
          "Do NOT output large headers, summaries, or notification-like structures.",
      },
      {
        role: "user",
        content:
          `User Request: ${state.prompt}\n\n` +
          `Evaluator Assessment: ${state.evaluatorFeedback || "n/a"}\n\n` +
          `Tool Execution Results:\n${JSON.stringify(summaryPayload, null, 2)}`,
      },
    ]);

    return {
      ...state,
      reply:
        response?.content || "Task completed successfully. No further details provided.",
      isComplete: state.isComplete ?? false,
    };
  } catch (error: any) {
    console.error("Communicator LLM Error:", error.message);
    return {
      ...state,
      reply:
        "The task was executed, but I encountered an error while generating a final response.",
      isComplete: state.isComplete ?? false,
    };
  }
}

function redactPII<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  try {
    return JSON.parse(
      JSON.stringify(payload, (key, value) => {
        if (key === "ip_address" || key === "user_agent") return "[redacted]";
        return value;
      }),
    ) as T;
  } catch {
    return payload;
  }
}
