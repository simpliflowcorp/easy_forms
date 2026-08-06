import { AgentState } from "../types";
import { sandboxRedisStore } from "../sandbox/sandboxRedisStore";
import { ALLOWED_TOOLS, checkToolPermission } from "../policy/permissions";
import { newIdempotencyKey } from "../helper/id";
import mongoose from "mongoose";
import Form from "../../models/formModel.js";
import CustomView from "../../models/customViewModel.js";
import User from "../../models/userModel.js";
import { logInfo } from "@/lib/logger";

/**
 * B-S2.1: Compute the updated elements array for element-level mutations.
 * Each tool type (add/update/remove/reorder) produces a replacement elements array.
 */
function computeElementUpdate(
  tool: string,
  params: Record<string, any>,
  existingElements: any[],
): { elements: any[] } {
  if (tool === "add_form_element") {
    const el = params.element;
    const maxPos = existingElements.reduce((m: number, e: any) => Math.max(m, e.position || 0), 0);
    const newElements = [...existingElements, {
      elementId: el.elementId || `element_${Date.now()}`,
      type: el.type ?? 1,
      label: el.label,
      required: Boolean(el.required),
      unique: Boolean(el.unique),
      options: el.options || [],
      position: maxPos + 1,
      column: el.column ?? 1,
    }];
    return { elements: newElements };
  }

  if (tool === "remove_form_element") {
    const eid = params.elementId;
    const lbl = params.label;
    const filtered = existingElements.filter((e: any) => {
      if (eid) return e.elementId !== eid;
      if (lbl) return e.label !== lbl;
      return false;
    });
    return { elements: filtered };
  }

  if (tool === "update_form_element") {
    const eid = params.elementId;
    const lbl = params.label;
    const updated = existingElements.map((e: any) => {
      const matches = eid ? e.elementId === eid : lbl ? e.label === lbl : false;
      return matches ? { ...e, ...params.updates } : e;
    });
    return { elements: updated };
  }

  // reorder_form_elements
  const orderMap = new Map<string, number>();
  for (const o of params.order || []) {
    orderMap.set(o.elementId, o.newPosition);
  }
  const reordered = existingElements
    .map((e: any) => ({
      ...e,
      position: orderMap.has(e.elementId) ? orderMap.get(e.elementId)! : e.position,
    }))
    .sort((a: any, b: any) => a.position - b.position);
  return { elements: reordered };
}

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
    logInfo(`[Executor] retrying with Evaluator feedback`, {
      feedback: lastFeedback,
      iteration: `${state.iterationCount}/${state.maxIterations}`,
    });
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
      if (["create_form", "update_form", "delete_form", "create_custom_view", "update_custom_view", "delete_custom_view", "add_form_element", "update_form_element", "remove_form_element", "reorder_form_elements", "set_form_status", "update_form_metadata_settings", "update_user_profile", "update_user_preferences", "update_notification_settings"].includes(act.tool)) {
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
        } else if (act.tool === "create_custom_view") {
          // create_custom_view: save a draft custom view to the sandbox
          const idempotencyKey = act.params.idempotencyKey || newIdempotencyKey();
          const viewData = {
            ...act.params,
            idempotencyKey,
            _id: act.id, // Tie the draft ID to the action ID
            isSandboxDraft: true,
          };
          const draftView = await sandboxRedisStore.saveDraftView(state.userId, state.ticket.ticketId, viewData);
          act.result = { view: draftView, isSandbox: true, idempotencyKey };
          act.status = "done";
        } else {
          // Unified handler for mutations: form updates, element ops, lifecycle, user tools
          const isCustomView = act.tool.startsWith("update_custom_view") || act.tool.startsWith("delete_custom_view");
          const isUserTool = ["update_user_profile", "update_user_preferences", "update_notification_settings"].includes(act.tool);

          let model: any;
          let targetId: string;

          if (isUserTool) {
            model = User;
            targetId = state.userId;
          } else {
            model = isCustomView ? CustomView : Form;
            targetId = act.params.formId || act.params.viewId;
            if (!targetId || typeof targetId !== "string") {
              throw new Error(`${act.tool}: '${isCustomView ? "viewId" : "formId"}' is required.`);
            }
          }

          const findSpec: Record<string, any> = { user: state.userId };
          if (!isUserTool) {
            if (mongoose.Types.ObjectId.isValid(targetId)) {
              findSpec._id = new mongoose.Types.ObjectId(targetId);
            } else {
              findSpec[isCustomView ? "viewId" : "formId"] = targetId;
            }
          } else {
            findSpec._id = new mongoose.Types.ObjectId(targetId);
          }

          const selectFields = isUserTool ? "_id username updatedAt" : "_id name updatedAt elements";
          const existing = await model.findOne(findSpec).select(selectFields).lean();
          if (!existing) {
            throw new Error(`${isUserTool ? "User" : isCustomView ? "CustomView" : "Form"} '${targetId}' not found or access denied.`);
          }

          const expectedUpdatedAt = existing.updatedAt;
          const idempotencyKey = act.params.idempotencyKey || newIdempotencyKey();

          // Compute updates based on tool type
          let updatesParam = act.params.updates;

          if (["add_form_element", "update_form_element", "remove_form_element", "reorder_form_elements"].includes(act.tool)) {
            updatesParam = computeElementUpdate(act.tool, act.params, (existing as any).elements || []);
          } else if (act.tool === "set_form_status") {
            updatesParam = { status: act.params.status };
          } else if (act.tool === "update_form_metadata_settings") {
            updatesParam = { metadataSettings: act.params.settings };
          } else if (act.tool === "update_user_profile") {
            updatesParam = { profile: act.params.profile };
          } else if (act.tool === "update_user_preferences") {
            updatesParam = { preferences: act.params.preferences };
          } else if (act.tool === "update_notification_settings") {
            updatesParam = { notificationSettings: act.params.settings };
          }

          if (["delete_form", "delete_custom_view"].includes(act.tool)) {
            await sandboxRedisStore.saveDeleteIntention(
              state.userId, state.ticket.ticketId,
              String(existing._id), idempotencyKey, expectedUpdatedAt,
            );
          } else {
            let mergeKind = "form_update";
            if (isCustomView) mergeKind = "view_update";
            else if (isUserTool) mergeKind = "user_update";
            else if (act.tool === "set_form_status") mergeKind = "form_status";
            else if (act.tool === "update_form_metadata_settings") mergeKind = "form_metadata";

            await sandboxRedisStore.saveUpdateIntention(
              state.userId, state.ticket.ticketId,
              String(existing._id),
              { ...updatesParam, _mergeKind: mergeKind },
              idempotencyKey, expectedUpdatedAt,
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
