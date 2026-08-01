import { AgentState } from "../types";
import { retryLLM, LLMOfflineError } from "@/lib/llmClient";
import { parsePersona, EvaluatorOutputSchema } from "../helper/validate";
import { redactPII } from "../helper/redact";

const EVALUATOR_SYSTEM_PROMPT = `You are the EVALUATOR PERSONA of the Easy Forms AI Agent System.

YOUR ROLE:
You perform Quality Assurance on the sandbox output against the user's initial prompt goals.

RULES:
1. Compare sandbox output results against requirements.
2. If actions succeeded and match user goals: Set "isComplete": true. DO NOT defer this decision to a human. You must make the decision yourself based on the results.
3. CRITICAL: If a database query returns an empty array '[]', this is a valid successful result! It simply means no records matched the filters (e.g. there are no active forms). DO NOT set "shouldRetry" just because results are empty. Set "isComplete": true and let the Communicator tell the user there were no results.
4. If an action failed with an error message (like a JSON parse error or unauthorized error) and loop budget remains (iterations < maxIterations): Set "shouldRetry": true and put specific, actionable feedback in "feedback".
5. If max iterations (3) reached without full match: Set "isComplete": false and "shouldRetry": false with feedback explaining the recovery needed.

OUTPUT FORMAT (JSON ONLY):
{
  "thoughtProcess": "step-by-step reasoning",
  "isComplete": boolean,
  "shouldRetry": boolean,
  "feedback": "Detailed evaluation report or instructions for the next iteration"
}`;

interface EvaluatorVerdict {
  thoughtProcess?: string;
  isComplete?: boolean;
  shouldRetry?: boolean;
  feedback?: string;
}

/** True if any action in the plan mutates form/view state and therefore
 *  requires explicit human "Confirm & Merge" approval before touching prod. */
function planRequiresMergeApproval(state: AgentState): boolean {
  const MUTATING_TOOLS = new Set(["create_form", "update_form", "delete_form"]);
  return state.actionPlan.some((a) => MUTATING_TOOLS.has(a.tool));
}

export async function runEvaluator(state: AgentState): Promise<AgentState> {
  // Pass 1: deterministic pre-checks. If any action errored, we don't even
  // need the LLM — short-circuit to retry against Executor.
  const failedActions = state.actionPlan.filter((a) => a.status === "error");
  if (failedActions.length > 0) {
    const feedback = failedActions
      .map((a) => `Action ${a.id} (${a.tool}) failed: ${a.error}`)
      .join("; ");
    if (state.iterationCount < state.maxIterations) {
      return {
        ...state,
        iterationCount: state.iterationCount + 1,
        activePersona: "EXECUTOR_SANDBOX",
        evaluatorFeedback: feedback,
      };
    }
    // Iterations exhausted: ask the human for plan adjustments.
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      isComplete: false,
      reply:
        `Execution failed after ${state.maxIterations} attempts. ` +
        `Last error: ${failedActions[0].error || "unknown"}. ` +
        `Could you rephrase the request or provide more detail so I can build a fresh plan?`,
      evaluatorFeedback: feedback,
    };
  }

  // Pass 2: LLM-based semantic QA. Verify that the results actually satisfy
  // the user's request — i.e., that an `isComplete` true from the executor
  // isn't lying to us. Previously the Evaluator just summarized results
  // without any quality check and unconditionally moved to COMMUNICATOR,
  // meaning the "compare sandbox output against requirements" job in the spec
  // was never actually performed (#1).
  let verdict: EvaluatorVerdict = {};
  let rawContent = "";
  try {
    const summaryPayload = state.actionPlan.map((a) => ({
      tool: a.tool,
      params: redactPII(a.params),
      result: redactPII(a.result),
    }));
    const response = await retryLLM(
      [
        { role: "system", content: EVALUATOR_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `User Request: ${state.resumedPrompt ?? state.prompt}\n\n` +
            `Drafter Requirements: ${JSON.stringify(state.requirements || {}, null, 2)}\n\n` +
            `Iteration: ${state.iterationCount}/${state.maxIterations}\n\n` +
            `Tool Execution Results:\n${JSON.stringify(summaryPayload, null, 2)}`,
        },
      ],
      { response_format: { type: "json_object" } },
    );
    rawContent = response?.content || "";
    const parsedVerdict = parsePersona(rawContent, EvaluatorOutputSchema);
    verdict = parsedVerdict || {};
  } catch (err: any) {
    // Network failures during the QA pass should not silently approve. If we
    // can't contact the LLM we treat the QA as inconclusive: route back to
    // Executor with explicit feedback so the loop tries once more instead of
    // signing off without checks. Offline-type fail exhausts the budget.
    if (err instanceof LLMOfflineError) {
      return {
        ...state,
        activePersona: "COMMUNICATOR",
        isQuestion: true,
        reply: "AI is offline right now. You can resume this ticket when the service is back.",
        evaluatorFeedback: `LLMOfflineError: ${err.message}`,
        llmRawOutput: rawContent,
      };
    }
    // Unknown envelope-type failure — route back to Executor with the failed
    // QA pass described, only if iterations remain.
    if (state.iterationCount < state.maxIterations) {
      return {
        ...state,
        iterationCount: state.iterationCount + 1,
        activePersona: "EXECUTOR_SANDBOX",
        evaluatorFeedback: `Evaluator QA pass failed unexpectedly: ${err.message}`,
      };
    }
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      reply: "I ran into trouble verifying the result and have run out of retry attempts. Please rephrase or try again.",
      evaluatorFeedback: `Evaluator QA pass failed: ${err.message}`,
      llmRawOutput: rawContent,
    };
  }

  const feedback = verdict.feedback?.trim() || "Execution looks good.";

  // Retry request from the LLM with budget remaining → back to Executor with
  // the LLM's specific feedback so the next execution actually knows what to
  // fix. Previously the Executor never saw the Evaluator's diagnosis (#23).
  if (verdict.shouldRetry && !verdict.isComplete && state.iterationCount < state.maxIterations) {
    return {
      ...state,
      iterationCount: state.iterationCount + 1,
      activePersona: "EXECUTOR_SANDBOX",
      evaluatorFeedback: feedback,
      llmRawOutput: rawContent,
    };
  }

  // LLM says it's NOT complete and budget is exhausted → human recovery.
  if (!verdict.isComplete && state.iterationCount >= state.maxIterations) {
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      reply:
        "I wasn't confident after several attempts that the result matches your request. " +
        "Can you rephrase or add more detail? " +
        `Reason: ${feedback}`,
      evaluatorFeedback: feedback,
      llmRawOutput: rawContent,
    };
  }

  // LLM signs off. Per Agent.md, the Evaluator transitions to
  // AWAITING_USER_APPROVAL when the plan mutated state — NOT the
  // Communicator. Previously the Communicator stole this job (#1, #14).
  if (verdict.isComplete && planRequiresMergeApproval(state)) {
    return {
      ...state,
      activePersona: "AWAITING_USER_APPROVAL",
      isComplete: true,
      evaluatorFeedback: feedback,
      llmRawOutput: rawContent,
    };
  }

  // Either completed with no mutations (pure read query) or LLM marked not
  // complete without retry — hand to Communicator for the user-facing reply.
  return {
    ...state,
    activePersona: "COMMUNICATOR",
    isComplete: Boolean(verdict.isComplete),
    evaluatorFeedback: feedback,
    llmRawOutput: rawContent,
  };
}
