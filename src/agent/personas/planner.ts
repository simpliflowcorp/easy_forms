import { AgentState, AgentAction } from "../types";
import { callLLM } from "@/lib/llmClient";
import { agentToolsSchema } from "../tools";

export async function runPlanner(state: AgentState): Promise<AgentState> {
  const { prompt, drafterMessage } = state;
  const actions: AgentAction[] = [];

  try {
    const response = await callLLM(
      [
        {
          role: "system",
          content: `You are the AI Planner for Easy Forms. 
          Your job is to read the user's request and the Drafter's context, and decide which tool(s) to call to satisfy the request.
          You MUST use the provided tools. Do not answer conversationally, just call the tools.`
        },
        {
          role: "user",
          content: `User Request: ${prompt}\nDrafter Context: ${drafterMessage || ""}\nExtracted Requirements: ${JSON.stringify(state.requirements || {}, null, 2)}`
        }
      ],
      {
        tools: agentToolsSchema,
        tool_choice: "auto",
      }
    );

    if (response?.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        const toolArgs = JSON.parse(tc.function.arguments);
        actions.push({
          id: tc.id || `act_${Date.now()}_${Math.random()}`,
          tool: tc.function.name,
          description: `Dynamically invoked tool: ${tc.function.name}`,
          params: toolArgs,
          status: "pending",
        });
      }
    }
    
    state.llmRawOutput = JSON.stringify(response?.tool_calls || [], null, 2);
  } catch (error: any) {
    console.error("Planner LLM Error:", error.message);
    state.llmRawOutput = `Error calling Planner LLM: ${error.message}`;
  }

  return {
    ...state,
    actionPlan: actions,
    activePersona: "EXECUTOR_SANDBOX",
  };
}
