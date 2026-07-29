import { AgentState } from "../types";
import { callLLM } from "@/lib/llmClient";

export async function runEvaluator(state: AgentState): Promise<AgentState> {
  const failedActions = state.actionPlan.filter((a) => a.status === "error");

  // Check 1: If an action failed and loop budget remains, loop back to Executor
  if (failedActions.length > 0) {
    if (state.iterationCount < state.maxIterations) {
      return {
        ...state,
        iterationCount: state.iterationCount + 1,
        activePersona: "EXECUTOR_SANDBOX",
        evaluatorFeedback: `Action failed: ${failedActions[0].error}. Retrying...`,
      };
    } else {
      return {
        ...state,
        activePersona: "AWAITING_USER_APPROVAL",
        isQuestion: true,
        reply: `Execution failed after ${state.maxIterations} attempts. Error: ${failedActions[0].error}`,
      };
    }
  }

  // Pass results to LLM to generate the final response
  try {
    const summaryPayload = state.actionPlan.map(a => ({
      tool: a.tool,
      params: a.params,
      result: a.result
    }));

    const response = await callLLM([
      {
        role: "system",
        content: `You are the AI Evaluator for Easy Forms.
        The system has executed tools on behalf of the user. 
        Read the User's Request and the Tool Execution Results.
        Your job is to generate a helpful, Markdown-formatted reply to the user summarizing the outcome.`
      },
      {
        role: "user",
        content: `User Request: ${state.prompt}\n\nTool Execution Results:\n${JSON.stringify(summaryPayload, null, 2)}`
      }
    ]);

    // Check if any actions require explicit user confirmation to merge from Sandbox to DB
    const requiresConfirmation = state.actionPlan.some(a => ["create_form", "update_form", "delete_form"].includes(a.tool));

    return {
      ...state,
      activePersona: requiresConfirmation ? "AWAITING_USER_APPROVAL" : "EVALUATOR",
      isComplete: true,
      reply: response?.content || "Task completed successfully.",
      evaluatorFeedback: "Evaluator LLM verified results and generated response.",
      llmRawOutput: response?.content
    };
  } catch (error: any) {
    console.error("Evaluator LLM Error:", error.message);
    return {
      ...state,
      activePersona: "AWAITING_USER_APPROVAL",
      isComplete: true,
      reply: "The task was executed successfully, but I failed to generate a summary response.",
      evaluatorFeedback: `Task complete, but Evaluator LLM failed: ${error.message}`,
      llmRawOutput: `Error: ${error.message}`
    };
  }
}
