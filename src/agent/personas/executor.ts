import { AgentState } from "../types";
import { sandboxStore } from "../sandbox/sandboxStore";
import { executeAgentTool } from "@/lib/agentTools";

export async function runExecutor(state: AgentState): Promise<AgentState> {
  const updatedPlan = [...state.actionPlan];

  for (let i = 0; i < updatedPlan.length; i++) {
    const act = updatedPlan[i];
    act.status = "in_progress";

    try {
      // Intercept mutations for Sandbox Isolation
      if (["create_form", "update_form", "delete_form"].includes(act.tool)) {
        if (act.tool === "create_form") {
          let elements = act.params.elements || [];
          if (typeof elements === "string") {
            try { elements = JSON.parse(elements); } catch (e) { elements = []; }
          }
          const normalizedParams = {
            ...act.params,
            expiry: act.params.expiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            elements: elements.map((el: any, idx: number) => ({
              elementId: el.elementId || `field_${Date.now()}_${idx}`,
              type: el.type ?? 1,
              label: el.label || `Field ${idx + 1}`,
              required: Boolean(el.required),
              unique: Boolean(el.unique),
              options: el.options || [],
              position: idx + 1,
              column: el.column ?? 1,
            }))
          };
          const draftForm = sandboxStore.saveDraftForm(state.userId, normalizedParams);
          act.result = { form: draftForm, isSandbox: true };
        } else {
          act.result = { status: "sandbox_mock_success", tool: act.tool, params: act.params, isSandbox: true };
        }
        act.status = "done";
      } else {
        // Run query/analytics tools via helper dynamically
        const res = await executeAgentTool(act.tool, act.params, state.userId);
        act.result = res;
        act.status = "done";
      }
    } catch (err: any) {
      act.status = "error";
      act.error = err.message;
    }
  }

  return {
    ...state,
    actionPlan: updatedPlan,
    activePersona: "EVALUATOR",
  };
}
