import { AgentState } from "../types";
import { sandboxRedisStore } from "../sandbox/sandboxRedisStore";
import { ALLOWED_TOOLS, checkToolPermission } from "../policy/permissions";
import { newIdempotencyKey } from "../helper/id";
import mongoose from "mongoose";
import Form from "@/models/formModel";

export async function runExecutor(state: AgentState): Promise<AgentState> {
  const updatedPlan = [...state.actionPlan];

  // #23: on a retry, the Evaluator's "what failed and why" lands in
  // state.evaluatorFeedback. Previously the Executor never saw this field
  // — so retries ran blind against the same params with no knowledge of the
  // previous failure. We surface it here so retries at least have the
  // diagnosis attached per-action (and the Communicator/Evaluator can show
  // the user what changed). Phase 5 rewrites the sandbox mutation block
  // itself; here we only consume the feedback as a logged breadcrumb.
  const lastFeedback = state.evaluatorFeedback || "";
  if (lastFeedback) {
    console.log(
      `[Executor] retrying with Evaluator feedback: ${lastFeedback} (iteration ${state.iterationCount}/${state.maxIterations})`,
    );
  }

  for (let i = 0; i < updatedPlan.length; i++) {
    const act = updatedPlan[i];

    // Phase 2: enforce allow-list + permissions BEFORE dispatch.
    if (!ALLOWED_TOOLS.includes(act.tool)) {
      act.status = "error";
      act.error = `Unknown or hallucinated tool: '${act.tool}'. Allowed: ${ALLOWED_TOOLS.join(", ")}`;
      continue;
    }
    const toolPerm = checkToolPermission(act.tool);
    if (!toolPerm.allowed) {
      act.status = "error";
      act.error = toolPerm.reason || `Permission denied for tool '${act.tool}'.`;
      continue;
    }

    // Skip actions that the Planner's validator (Phase 4.2) already flagged.
    if (act.status === "error") {
      if (lastFeedback && !act.error?.includes("(prior feedback:")) {
        act.error = `${act.error} (prior feedback: ${lastFeedback})`;
      }
      continue;
    }

    act.status = "in_progress";

    try {
      // Phase 5.1: Mutations (create_form / update_form / delete_form) no
      // longer touch production directly ever — they only queue an idempotent
      // pending intention against an existence snapshot. The actual prod
      // write happens in `mergeSandboxToProduction` (Phase 5.3), gated by the
      // user clicking "Confirm & Merge".
      //
      // The previous code did a `run_database_query` against prod to verify
      // existence AND recorded an intention — the existence check is fine
      // (it's read-only), but the regex against the raw `formId` was a
      // ReDoS and a cross-tenant leak vector (#24). We:
      //   - Use strict ObjectId / field-id lookup only (no user-supplied regex).
      //   - Snapshot `updatedAt` for optimistic concurrency at merge time.
      //   - Stamp an `idempotencyKey` so a re-merge of the same intention is a no-op.
      if (["create_form", "update_form", "delete_form"].includes(act.tool)) {
        if (act.tool === "create_form") {
          let elements = act.params.elements || [];
          if (typeof elements === "string") {
            try { elements = JSON.parse(elements); } catch (e) { elements = []; }
          }
          const idempotencyKey = act.params.idempotencyKey || newIdempotencyKey();
          
          // Use act.params.expiryDays if provided, else default to 30
          const lifetimeDays = act.params.expiryDays ? Number(act.params.expiryDays) : 30;

          const normalizedParams = {
            ...act.params,
            formId: act.id, // Tie the draft ID to the action ID to prevent duplicates on iteration retries
            idempotencyKey,
            expiry: new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1000),
            elements: elements.map((el: any, idx: number) => ({
              elementId: el.elementId || `field_${Date.now()}_${idx}`,
              type: el.type ?? 1,
              label: el.label || `Field ${idx + 1}`,
              required: Boolean(el.required),
              unique: Boolean(el.unique),
              options: el.options || [],
              position: idx + 1,
              column: el.column ?? 1,
            })),
          };
          const draftForm = await sandboxRedisStore.saveDraftForm(state.userId, state.ticket.ticketId, normalizedParams);
          act.result = { form: draftForm, isSandbox: true, idempotencyKey };
          act.status = "done";
        } else {
          // update_form / delete_form: existence snapshot from production.
          const formId = act.params.formId;
          if (!formId || typeof formId !== "string") {
            throw new Error(`${act.tool}: 'formId' is required.`);
          }

          const findSpec: Record<string, any> = { user: state.userId };
          if (mongoose.Types.ObjectId.isValid(formId)) {
            findSpec._id = new mongoose.Types.ObjectId(formId);
          } else {
            // The legacy `formId` (hashid-style string) is also tolerated.
            findSpec.formId = formId;
          }
          const existing = await Form.findOne(findSpec).select("_id name updatedAt").lean();
          if (!existing) {
            throw new Error(`Form '${formId}' not found or access denied.`);
          }

          const expectedUpdatedAt = existing.updatedAt;
          const idempotencyKey = act.params.idempotencyKey || newIdempotencyKey();

          if (act.tool === "update_form") {
            await sandboxRedisStore.saveUpdateIntention(
              state.userId,
              state.ticket.ticketId,
              String(existing._id),
              act.params.updates,
              idempotencyKey,
              expectedUpdatedAt,
            );
          } else {
            await sandboxRedisStore.saveDeleteIntention(
              state.userId,
              state.ticket.ticketId,
              String(existing._id),
              idempotencyKey,
              expectedUpdatedAt,
            );
          }

          act.result = {
            status: "sandbox_mock_success",
            tool: act.tool,
            target: existing.name,
            expectedUpdatedAt,
            idempotencyKey,
            isSandbox: true,
          };
          act.status = "done";
        }
      } else {
        // Read / analytics tools dispatch via the helper. Phase 5.1 also
        // caches their outputs into the sandbox so a retry iteration re-runs
        // the SAME query deterministically against prod (no LLM
        // nondeterminism drifting over the same prompt twice). For now, no
        // cache invalidation TTL — if the user merges between iterations,
        // they'll see the new state on the very next loop iteration.
        const cached = await sandboxRedisStore.getQueryResult(state.userId, state.ticket.ticketId, act.id);
        if (cached && state.iterationCount > 1) {
          act.result = cached;
          act.status = "done";
        } else {
          const { executeAgentTool } = await import("../../lib/agentTools.js");
          const res = await executeAgentTool(act.tool, act.params, state.userId);
          act.result = res;
          await sandboxRedisStore.setQueryResult(state.userId, state.ticket.ticketId, act.id, res);
          act.status = "done";
        }
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
