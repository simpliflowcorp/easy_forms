import { AgentState, AgentAction } from "../types";
import { retryLLM, LLMOfflineError, LLMParseError } from "@/lib/llmClient";
import { agentToolsSchema } from "../tools";
import { newActionId } from "../helper/id";
import { safeJSON } from "../helper/jsonParse";
import { loadPersonaPrompt } from "../prompts/loader";

const FIELD_TYPES = new Set([1, 2, 3, 4, 5]);
const FILTER_OPS = new Set(["equals", "contains", "gt", "gte", "lt", "lte", "ne"]);

/** Phase 4.2 — minimal parameter validator aligned with guidelines.md.
 *  Returns null if params look acceptable, or a human-readable reason why.
 *  The Drafter already validates intent; this is defense-in-depth so a
 *  hallucinated `create_form` with `elements: [{type: 99}]` is caught before
 *  the executor spends a turn mutating the sandbox with bad data. */
export function validateToolParams(tool: string, params: any): string | null {
  const p = params || {};
  switch (tool) {
    case "create_form":
      if (!p.name || typeof p.name !== "string") return "create_form: 'name' required (string).";
      if (typeof p.description !== "undefined" && typeof p.description !== "string")
        return "create_form: 'description' must be a string.";
      
      let elements = p.elements;
      if (typeof elements === "string") {
        try { elements = JSON.parse(elements); } catch (e) { elements = []; }
      }

      if (!Array.isArray(elements) || elements.length === 0)
        return "create_form: 'elements' required (non-empty array).";
      for (const el of elements) {
        if (!el || typeof el.label !== "string" || !el.label.trim())
          return "create_form.elements[].label required (string).";
        const t = Number(el.type);
        if (!Number.isInteger(t) || !FIELD_TYPES.has(t as any))
          return `create_form.elements[].type must be one of 1..5 (got ${el.type}).`;
        if (el.type === 3 && (!Array.isArray(el.options) || el.options.length === 0))
          return "create_form.elements[].options required for type=3 (select).";
      }
      return null;
    case "update_form":
      if (!p.formId || typeof p.formId !== "string") return "update_form: 'formId' required (string).";
      if (!p.updates || typeof p.updates !== "object") return "update_form: 'updates' required (object).";
      return null;
    case "delete_form":
      if (!p.formId || typeof p.formId !== "string") return "delete_form: 'formId' required (string).";
      return null;
    case "query_responses":
    case "run_database_query": {
      if (tool === "query_responses") {
        if (!p.formId) return `${tool}: 'formId' required.`;
        if (Array.isArray(p.filters)) {
          for (const f of p.filters) {
            if (!f || typeof f.field !== "string")
              return `${tool}.filters[].field required (string).`;
            if (!FILTER_OPS.has(f.operator))
              return `${tool}.filters[].operator '${f.operator}' not in ${[...FILTER_OPS].join("|")}.`;
          }
        }
      } else {
        if (!p.collection || typeof p.collection !== "string")
          return "run_database_query: 'collection' required.";
        if (!p.operation || typeof p.operation !== "string")
          return "run_database_query: 'operation' required.";
        if ((p.query !== undefined && typeof p.query !== "object") && typeof p.query !== "string")
          return "run_database_query: 'query' must be object or string if provided.";
      }
      return null;
    }
    case "generate_analytics":
      if (!p.formId) return "generate_analytics: 'formId' required.";
      return null;
    case "create_custom_view":
    case "update_custom_view":
      if (!p.formId) return `${tool}: 'formId' required.`;
      if (!p.name) return `${tool}: 'name' required.`;
      return null;
    case "delete_custom_view":
    case "get_custom_views":
      if (!p.formId) return `${tool}: 'formId' required.`;
      return null;
    default:
      return null;
  }
}

/** One-line summary of a tool+params tuple, replacing the placeholder
 *  "Dynamically invoked tool: <name>" (#11). The filled description is what
 *  gets shown to the user in their checklist. */
function describeTool(tool: string, params: any): string {
  const p = params || {};
  switch (tool) {
    case "create_form":
      return `Create form "${p.name || "(untitled)"}" with ${(p.elements || []).length || 0} field(s).`;
    case "update_form":
      return `Update form "${p.formId || "?"}" — ${Object.keys(p.updates || {}).join(", ") || "no changes"}.`;
    case "delete_form":
      return `Delete form "${p.formId || "?"}".`;
    case "query_responses":
      return `Query responses for form "${p.formId || "?"}"${(p.filters || []).length ? ` (${(p.filters || []).length} filter(s))` : ""}.`;
    case "run_database_query":
      return `${p.operation || "query"} on ${p.collection || "?"} collection.`;
    case "generate_analytics":
      return `Compute analytics for form "${p.formId || "?"}".`;
    case "create_custom_view":
      return `Save view "${p.name || "?"}" for form "${p.formId || "?"}".`;
    case "update_custom_view":
      return `Update view "${p.name || "?"}" on form "${p.formId || "?"}".`;
    case "delete_custom_view":
      return `Delete custom view for form "${p.formId || "?"}".`;
    case "get_custom_views":
      return `List saved custom views for form "${p.formId || "?"}".`;
    default:
      return `Invoke tool "${tool}".`;
  }
}

export async function runPlanner(state: AgentState): Promise<AgentState> {
  const { prompt, resumedPrompt, drafterMessage } = state;
  const currentPrompt = resumedPrompt ?? prompt;
  const actions: AgentAction[] = [];

  // #4.2 / #23 prep: on retry, surface the Evaluator's feedback so the LLM
  // knows what failed last time. Before this, the loop sent retries blindly
  // back to the Planner with no failure context at all.
  const feedbackPreamble = state.evaluatorFeedback
    ? `Previous plan failed. Feedback: ${state.evaluatorFeedback}. Adjust the action plan accordingly.\n\n`
    : "";

  let tool_calls: any[] | undefined;
  let thoughtProcess = "";
  let rawResponse: any;

  try {
    // R7: Load prompt from versioned file
    const { systemPrompt } = loadPersonaPrompt("planner");
    
    rawResponse = await retryLLM(
      [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `${feedbackPreamble}User Request: ${currentPrompt}\n\nUSER PREFERENCES AND PROFILE:\n${JSON.stringify(
            state.userContext || {},
            null,
            2,
          )}\n\nDrafter Context: ${
            drafterMessage || ""
          }\nExtracted Requirements: ${JSON.stringify(state.requirements || {}, null, 2)}`,
        },
      ],
      {
        tools: agentToolsSchema,
        tool_choice: "auto",
        onChunk: state.onChunk,
      },
    );

    thoughtProcess = rawResponse?.content?.trim() || "No reasoning provided.";
    tool_calls = rawResponse?.tool_calls;

    // R2.2: capture LLM usage for token tracking
    if (rawResponse?.usage) {
      state.lastLLMUsage = rawResponse.usage;
    }

    // Phase 3.3: removed the `<|python_tag|> / True/False/None` Llama-3.1
    // text fallback. That fallback hard-coded Llama-specific syntax quirks
    // into supposedly-generic code AND silently truncated multi-call plans
    // to ONE action. Quarantined to `legacy/llama3Fallback.ts` gated behind
    // LLM_ALLOW_LEGACY_FALLBACK=1 for evaluation purposes; by default we
    // require proper function-calling output and surface a clean
    // LLMParseError otherwise.
    if (process.env.LLM_ALLOW_LEGACY_FALLBACK === "1" && !tool_calls && thoughtProcess) {
      const { parseLlama3PythonTag } = await import("../legacy/llama3Fallback.js");
      tool_calls = parseLlama3PythonTag(thoughtProcess) || undefined;
    }
  } catch (error: any) {
    if (error instanceof LLMOfflineError) {
      // Upstream should not silently fall through; propagate so the loop can
      // save to Mongo as LLM_ERROR (proper status code per #21).
      throw error;
    }
    // Non-fatal: keep going with an empty plan; Evaluator will mark as failed
    // and either retry or surface to the user.
    console.error("Planner LLM Error:", error.message);
    state.llmRawOutput = `Error calling Planner LLM: ${error.message}`;
    return {
      ...state,
      actionPlan: [],
      activePersona: "EXECUTOR_SANDBOX",
    };
  }

  if (tool_calls && tool_calls.length > 0) {
    for (const tc of tool_calls) {
      let toolArgs: any = {};
      try {
        toolArgs = JSON.parse(tc.function.arguments);
      } catch {
        // LLM may emit arguments as a Python-like literal; safe fallback.
        toolArgs = safeJSON(tc.function.arguments) || {};
      }
      const reason = validateToolParams(tc.function.name, toolArgs);
      actions.push({
        id: tc.id || newActionId(),
        tool: tc.function.name,
        description: describeTool(tc.function.name, toolArgs),
        params: toolArgs,
        status: reason ? "error" : "pending",
        error: reason || undefined,
      });
    }
  } else {
    // No tool calls means the LLM didn't follow the function-calling contract.
    // Flag a sentinel action so the Evaluator/loop can decide to retry or ask user.
    actions.push({
      id: newActionId(),
      tool: "_no_tool_call",
      description: "Planner produced no tool calls. Evaluator should retry or surface to user.",
      params: {},
      status: "error",
      error: "Planner LLM did not emit a tool call. (LLM_ALLOW_LEGACY_FALLBACK not set or no <|python_tag|> in response.)",
    });
  }

  state.llmRawOutput = JSON.stringify(
    {
      thoughtProcess,
      tool_calls: tool_calls || [],
    },
    null,
  2,
);

  return {
    ...state,
    actionPlan: actions,
    activePersona: "EXECUTOR_SANDBOX",
  };
}

// Sentinel error kept for callers that attempt full-failure semantics later.
// Currently unused inline but exported so the Evaluator (Phase 4) may dispatch
// on it without importing from llmClient directly.
export { LLMParseError };
