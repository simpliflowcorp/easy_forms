import { AgentState } from "../types";
import { retryLLM, LLMOfflineError } from "@/lib/llmClient";
import { redactPII } from "../helper/redact";
import { loadPersonaPrompt } from "../prompts/loader";

/** Format read-only tool results for direct display without LLM call. */
function formatReadOnlyResults(state: AgentState): string {
  if (!state.actionPlan.length) return "No results found.";
  
  const action = state.actionPlan[0];
  if (!action.result) return "No results found.";
  
  const results = action.result?.results || action.result;
  if (!results || (Array.isArray(results) && results.length === 0)) {
    return "No results found.";
  }
  
  // Handle run_database_query results
  const items = Array.isArray(results) ? results : [results];
  
  if (items.length <= 5) {
    // Format as markdown table
    const keys = Object.keys(items[0] || {});
    if (keys.length === 0) return "No results found.";
    
    const header = "| " + keys.join(" | ") + " |";
    const separator = "| " + keys.map(() => "---").join(" | ") + " |";
    const rows = items.map(item => "| " + keys.map(k => String(item[k] ?? "")).join(" | ") + " |").join("\n");
    return header + "\n" + separator + "\n" + rows;
  } else {
    // CSV download for >5 items
    const keys = Object.keys(items[0] || {});
    const csvHeader = keys.join(",");
    const csvRows = items.map(item => keys.map(k => String(item[k] ?? "")).join(",")).join("\n");
    const csv = csvHeader + "\n" + csvRows;
    const encoded = encodeURIComponent(csv);
    return `[Download CSV (${items.length} results)](data:text/csv;charset=utf-8,${encoded})`;
  }
}

export async function runCommunicator(state: AgentState, latencyMs?: number): Promise<AgentState> {
  // R1: Read-only mode — format results directly without LLM call
  if (state.isReadOnly) {
    const reply = formatReadOnlyResults(state);
    return {
      ...state,
      reply,
      isComplete: true,
    };
  }
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

    let latencyPrompt = "";
    if (latencyMs && latencyMs > 10000) {
      latencyPrompt = "\nSERVER LOAD NOTE: This request took an unusually long time to process (high server latency/traffic). Playfully weave this into your response (e.g. 'Sorry for the wait, the traffic to the server is pretty heavy right now!' or 'It took some time to travel from the server, but...').";
    }

    let prewrittenPrompt = "";
    if (state.reply) {
      prewrittenPrompt = `\nThe Drafter has already provided a pre-written response: "${state.reply}". You MUST use this response as the foundation of your reply. You may polish it slightly or append the latency apology if needed, but do not hallucinate a completely different response.`;
    }

    const response = await retryLLM([
      {
        role: "system",
        content: (() => {
          const { systemPrompt } = loadPersonaPrompt("communicator");
          return systemPrompt + latencyPrompt + prewrittenPrompt;
        })(),
      },
      {
        role: "user",
        content:
          `User Request: ${state.resumedPrompt ?? state.prompt}\n\n` +
          `USER PREFERENCES AND PROFILE:\n${JSON.stringify(state.userContext || {}, null, 2)}\n\n` +
          `RECENT TICKETS CONTEXT:\n${JSON.stringify(state.recentContext || [], null, 2)}\n\n` +
          `Evaluator Assessment: ${state.evaluatorFeedback || "n/a"}\n\n` +
          `Tool Execution Results:\n${JSON.stringify(summaryPayload, null, 2)}`,
      },
    ], { onChunk: state.onChunk, temperature: 0.7 });

    // R2.2: capture LLM usage for token tracking
    if (response?.usage) {
      state.lastLLMUsage = response.usage;
    }

    return {
      ...state,
      reply:
        response?.content || "Task completed successfully. No further details provided.",
      isComplete: state.isComplete ?? false,
    };
  } catch (error: any) {
    console.error("Communicator LLM Error:", error.message);
    
    // Handle LLMOfflineError explicitly - set ticket status to LLM_ERROR
    // and clear isComplete so the loop's post-Communicator persistence
    // keeps the ticket alive for resume.
    if (error instanceof LLMOfflineError) {
      state.ticket.status = "LLM_ERROR";
      return {
        ...state,
        isComplete: false,
        reply: "AI is offline right now. You can resume this ticket when the service is back.",
      };
    }
    
    // For other errors: keep the message but clear isComplete and set
    // status: "LLM_ERROR" so the ticket reflects reality.
    state.ticket.status = "LLM_ERROR";
    return {
      ...state,
      isComplete: false,
      reply:
        "The task was executed, but I encountered an error while generating a final response.",
    };
  }
}
