import { AgentState } from "../types";
import { retryLLM, LLMOfflineError } from "@/lib/llmClient";
import { parsePersona, EvaluatorOutputSchema, EvaluatorOutput } from "../helper/validate";
import { redactPII } from "../helper/redact";
import { loadPersonaPrompt } from "../prompts/loader";
import { resolveSkill } from "./skillRouter.js";

type EvaluatorVerdict = EvaluatorOutput;

export type EvaluatorDecision = "retry" | "replan" | "ask_user" | "complete";

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
      // Determine decision: 1st retry = retry, 2nd = replan, 3rd = ask_user
      const decision: EvaluatorDecision = state.iterationCount === 1 ? "retry" :
        state.iterationCount === 2 ? "replan" : "ask_user";
      return {
        ...state,
        iterationCount: state.iterationCount + 1,
        activePersona: decision === "replan" ? "PLANNER" : "EXECUTOR_SANDBOX",
        evaluatorFeedback: feedback,
        evaluatorDecision: decision,
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
      evaluatorDecision: "ask_user",
    };
  }

  // A-S2.6: Negative-test mode — pre-execution deterministic checks from skill.negativeTests[]
  // Run before LLM QA to catch structural issues early.
  const firstAction = state.actionPlan[0];
  const owningSkillName = firstAction?.owningSkill || state.requirements.skill;
  if (owningSkillName) {
    const skillResult = await resolveSkill(owningSkillName, state.userId);
    if (skillResult.allowed && skillResult.skill && skillResult.skill.negativeTests) {
      for (const test of skillResult.skill.negativeTests) {
        try {
          // Evaluate the assertion in a safe context
          // The assertion can reference actionPlan, state, etc.
          const actionPlan = state.actionPlan;
          const state_ = state; // alias for assertion context
          // eslint-disable-next-line no-eval
          const pass = eval(test.assert);
          if (!pass) {
            const failMsg = test.description
              ? `Negative test failed: ${test.description} (assert: ${test.assert})`
              : `Negative test failed: ${test.assert}`;
            if (state.iterationCount < state.maxIterations) {
              const decision: EvaluatorDecision = state.iterationCount === 1 ? "retry" :
                state.iterationCount === 2 ? "replan" : "ask_user";
              return {
                ...state,
                iterationCount: state.iterationCount + 1,
                activePersona: decision === "replan" ? "PLANNER" : "EXECUTOR_SANDBOX",
                evaluatorFeedback: failMsg,
                evaluatorDecision: decision,
                llmRawOutput: `Negative test failed: ${test.assert}`,
              };
            }
            // Iterations exhausted
            return {
              ...state,
              activePersona: "COMMUNICATOR",
              isQuestion: true,
              isComplete: false,
              reply: `Validation failed: ${failMsg}. Please adjust your request.`,
              evaluatorFeedback: failMsg,
              evaluatorDecision: "ask_user",
              llmRawOutput: `Negative test failed: ${test.assert}`,
            };
          }
        } catch (evalErr) {
          // If eval fails, log and continue (don't block on test syntax errors)
          console.warn(`[evaluator] Negative test eval error: ${test.assert}`, evalErr);
        }
      }
    }
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
    const { systemPrompt } = loadPersonaPrompt("evaluator");
    const summaryPayload = state.actionPlan.map((a) => ({
      tool: a.tool,
      params: redactPII(a.params),
      result: redactPII(a.result),
    }));
    const response = await retryLLM(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `User Request: ${state.resumedPrompt ?? state.prompt}\n\n` +
            `Drafter Requirements: ${JSON.stringify(state.requirements || {}, null, 2)}\n\n` +
            `Iteration: ${state.iterationCount}/${state.maxIterations}\n\n` +
            `Tool Execution Results:\n${JSON.stringify(summaryPayload, null, 2)}`,
        },
      ],
      { response_format: { type: "json_object" }, onChunk: state.onChunk },
    );
    rawContent = response?.content || "";

    // R2.2: capture LLM usage for token tracking
    if (response?.usage) {
      state.lastLLMUsage = response.usage;
    }

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
        evaluatorDecision: "ask_user",
      };
    }
    // Unknown envelope-type failure — route back to Executor with the failed
    // QA pass described, only if iterations remain.
    if (state.iterationCount < state.maxIterations) {
      const decision: EvaluatorDecision = state.iterationCount === 1 ? "retry" :
        state.iterationCount === 2 ? "replan" : "ask_user";
      return {
        ...state,
        iterationCount: state.iterationCount + 1,
        activePersona: decision === "replan" ? "PLANNER" : "EXECUTOR_SANDBOX",
        evaluatorFeedback: `Evaluator QA pass failed unexpectedly: ${err.message}`,
        evaluatorDecision: decision,
      };
    }
    return {
      ...state,
      activePersona: "COMMUNICATOR",
      isQuestion: true,
      reply: "I ran into trouble verifying the result and have run out of retry attempts. Please rephrase or try again.",
      evaluatorFeedback: `Evaluator QA pass failed: ${err.message}`,
      llmRawOutput: rawContent,
      evaluatorDecision: "ask_user",
    };
  }

  const feedback = verdict.feedback?.trim() || "Execution looks good.";

  // Determine the decision based on LLM verdict and iteration count
  let decision: EvaluatorDecision;
  let nextPersona: AgentState["activePersona"];

  if (verdict.isComplete && planRequiresMergeApproval(state)) {
    decision = "complete";
    nextPersona = "AWAITING_USER_APPROVAL";
  } else if (verdict.isComplete) {
    decision = "complete";
    nextPersona = "COMMUNICATOR";
  } else if (verdict.shouldRetry && state.iterationCount < state.maxIterations) {
    // 1st retry -> retry (EXECUTOR), 2nd -> replan (PLANNER), 3rd -> ask_user (COMMUNICATOR)
    if (state.iterationCount === 1) {
      decision = "retry";
      nextPersona = "EXECUTOR_SANDBOX";
    } else if (state.iterationCount === 2) {
      decision = "replan";
      nextPersona = "PLANNER";
    } else {
      decision = "ask_user";
      nextPersona = "COMMUNICATOR";
    }
  } else if (!verdict.isComplete && state.iterationCount >= state.maxIterations) {
    decision = "ask_user";
    nextPersona = "COMMUNICATOR";
  } else {
    // Default: if not complete and no retry requested, ask user
    decision = "ask_user";
    nextPersona = "COMMUNICATOR";
  }

  // Cache the failed plan for replan context
  const priorPlans = state.priorPlans || [];
  if (decision === "replan" || decision === "retry") {
    priorPlans.push({
      iteration: state.iterationCount,
      actionPlan: state.actionPlan,
      feedback: feedback,
    });
  }

  return {
    ...state,
    iterationCount: state.iterationCount + (decision !== "complete" ? 1 : 0),
    activePersona: nextPersona,
    evaluatorFeedback: feedback,
    evaluatorDecision: decision,
    llmRawOutput: rawContent,
    priorPlans,
    isComplete: decision === "complete",
    isQuestion: decision === "ask_user",
    reply: decision === "ask_user"
      ? "I wasn't confident after several attempts that the result matches your request. Can you rephrase or add more detail? Reason: " + feedback
      : undefined,
  };
}