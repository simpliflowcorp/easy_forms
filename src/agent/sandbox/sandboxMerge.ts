/**
 * Transactional + idempotent merge of the Redis-backed sandbox into Mongo.
 *
 * Replaces the previous non-atomic merge which:
 *   - Called `Form.create` / `Form.updateOne` / `Form.deleteOne` directly
 *     in a plain for-loop with no `session` — a partial mid-loop throw
 *     would abandon the remaining drafts in `state.forms` even though
 *     `resetStore` still ran unconditionally at the end (silent data loss).
 *   - Had no idempotency keys, so a double-click on "Confirm & Merge" (or a
 *     network retry) would create duplicate production forms.
 *
 * Behavior:
 *   - Each draft / pending-intention carries an `idempotencyKey` (Phase 1).
 *   - Sparse unique index on `Form.agentIdempotencyKey` ensures re-merges of
 *     the same draft are no-ops via `findOneAndUpdate(... $setOnInsert ...)`.
 *   - Updates / deletes use optimistic concurrency with `expectedUpdatedAt`
 *     so a form mutated between the Executor snapshot and the merge is
 *     applied (logged, not silently overwritten).
 *   - The whole merge runs inside `session.withTransaction`. If anything
 *     throws, the transaction aborts, the sandbox is NOT reset, and the user
 *     can retry without losing their draft state.
 *
 * Cutover note: requires Mongo replica set (or a sharded cluster) so that
 * sessions are available. If the production MONGODB_URI points to a
 * standalone, the transaction is going to fail at runtime; we fall back to
 * a two-phase merge via the `PendingMerge` collection for idempotent safety.
 */
import Form from "@/models/formModel";
import CustomView from "@/models/customViewModel";
import User from "@/models/userModel";
import mongoose from "mongoose";
import { sandboxRedisStore } from "./sandboxRedisStore.js";
import AgentAuditEvent from "@/models/agentAuditEventModel";
import PendingMerge from "@/models/PendingMerge";
import type { MergeStats, MergeableKind } from "./types.js";
import { USER_SAFE_FIELDS, UserUnsafeFieldError } from "./types.js";

// Re-export the frozen contract for existing importers of sandboxMerge.
export type { MergeStats, MergeableKind } from "./types.js";
export { USER_SAFE_FIELDS, UserUnsafeFieldError } from "./types.js";
export type { MergeRequest } from "./types.js";

/** Error thrown when a feature is not yet implemented. */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not yet implemented.`);
    this.name = "NotImplementedError";
  }
}

/**
 * B-S3.4: Apply a skill merge (create/update/soft-delete) to AgentSkillModel.
 * Gated by skill_authoring scope. Uses $setOnInsert idempotency on (userId, name, version).
 */
async function applySkillMerge(
  userId: string,
  ticketId: string,
  upd: { id: string; idempotencyKey: string; expectedUpdatedAt?: Date },
  updates: Record<string, any>,
  mergeKind: MergeableKind,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  // B-S3.4: AgentSkillModel is owned by Agent C — not yet deployed.
  // When Agent C ships it, replace this with the import and merge logic below.
  // The try/catch pattern used in loader.ts allows runtime resolution.
  let AgentSkillModel: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AgentSkillModel = (await Function('return import("@/models/AgentSkillModel")')() as any).default;
  } catch {
    throw new NotImplementedError("AgentSkillModel (Agent C's model) is not yet available for skill merge.");
  }

  if (mergeKind === "skill_create") {
    const filter: Record<string, any> = {
      user: userId,
      name: updates.name,
      version: updates.version,
    };
    // $setOnInsert idempotency
    await AgentSkillModel.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          ...updates,
          user: userId,
          agentIdempotencyKey: upd.idempotencyKey,
        },
      },
      { upsert: true, session, new: true },
    );
    stats.mergedForms++;
    await AgentAuditEvent.create([{
      ticketId, userId,
      resourceId: upd.idempotencyKey,
      action: "create_skill",
      serverDiff: updates,
      outcome: "success",
    }], { session });
  } else if (mergeKind === "skill_update") {
    const filter: Record<string, any> = { _id: new mongoose.Types.ObjectId(upd.id), user: userId };
    if (upd.expectedUpdatedAt) filter.updatedAt = upd.expectedUpdatedAt;
    const res = await AgentSkillModel.updateOne(filter, { $set: updates }, { session });
    if (res.matchedCount > 0) {
      stats.updatesApplied++;
      await AgentAuditEvent.create([{
        ticketId, userId, resourceId: String(upd.id),
        action: "update_skill", serverDiff: updates, outcome: "success",
      }], { session });
    } else {
      stats.updatesMissed++;
      await AgentAuditEvent.create([{
        ticketId, userId, resourceId: String(upd.id),
        action: "update_skill", serverDiff: updates, outcome: "concurrency_miss",
      }], { session });
    }
  } else {
    // skill_soft_delete
    const filter: Record<string, any> = { _id: new mongoose.Types.ObjectId(upd.id), user: userId };
    const res = await AgentSkillModel.updateOne(filter, { $set: { deleted: true, deletedAt: new Date() } }, { session });
    if (res.matchedCount > 0) stats.deletesApplied++;
    else stats.deletesMissed++;
    await AgentAuditEvent.create([{
      ticketId, userId, resourceId: String(upd.id),
      action: "soft_delete_skill", serverDiff: null, outcome: res.matchedCount > 0 ? "success" : "concurrency_miss",
    }], { session });
  }
}

async function applyUserUpdate(
  userId: string,
  ticketId: string,
  upd: { id: string; idempotencyKey: string; expectedUpdatedAt?: Date },
  updates: Record<string, any>,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  // Flatten dot-path keys from the updates to validate each leaf
  const unsafeFields: string[] = [];
  const topKeys = Object.keys(updates);
  for (const k of topKeys) {
    if (USER_SAFE_FIELDS.has(k)) continue;
    // For nested objects (profile, preferences, notificationSettings), check sub-keys
    if (typeof updates[k] === "object" && updates[k] !== null) {
      const subObj = updates[k];
      for (const sk of Object.keys(subObj)) {
        const dotted = `${k}.${sk}`;
        if (!USER_SAFE_FIELDS.has(dotted)) {
          // Check one level deeper (e.g., notificationSettings.popup.formExpired)
          if (typeof subObj[sk] === "object" && subObj[sk] !== null) {
            for (const dk of Object.keys(subObj[sk])) {
              const deepDotted = `${k}.${sk}.${dk}`;
              if (!USER_SAFE_FIELDS.has(deepDotted)) {
                unsafeFields.push(deepDotted);
              }
            }
          } else {
            unsafeFields.push(dotted);
          }
        }
      }
    } else {
      // Direct unsafe field (e.g., password, isAdmin)
      unsafeFields.push(k);
    }
  }

  if (unsafeFields.length > 0) {
    throw new UserUnsafeFieldError(unsafeFields);
  }

  // Apply the safe update to User
  const filter: Record<string, any> = { _id: new mongoose.Types.ObjectId(upd.id) };
  if (upd.expectedUpdatedAt) filter.updatedAt = upd.expectedUpdatedAt;

  // Flatten nested updates into dot-notation for $set
  const flatUpdates: Record<string, any> = {};
  for (const k of topKeys) {
    if (typeof updates[k] === "object" && updates[k] !== null && USER_SAFE_FIELDS.has(k)) {
      for (const sk of Object.keys(updates[k])) {
        flatUpdates[`${k}.${sk}`] = updates[k][sk];
      }
    } else {
      flatUpdates[k] = updates[k];
    }
  }

  const res = await User.updateOne(filter, { $set: flatUpdates }, { session });
  if (res.matchedCount > 0) {
    stats.updatesApplied++;
    await AgentAuditEvent.create([{
      ticketId,
      userId,
      resourceId: String(upd.id),
      action: "update_user",
      serverDiff: flatUpdates,
      outcome: "success",
    }], { session });
  } else {
    stats.updatesMissed++;
    await AgentAuditEvent.create([{
      ticketId,
      userId,
      resourceId: String(upd.id),
      action: "update_user",
      serverDiff: flatUpdates,
      outcome: "concurrency_miss",
    }], { session });
  }
}

async function mergeFormsAndIntents(
  userId: string,
  ticketId: string,
  snapshot: Awaited<ReturnType<typeof sandboxRedisStore.get>>,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  const store = snapshot;

  // 1. Create drafts.
  for (const draft of Object.values(store.forms)) {
    const { isSandboxDraft: _omit, _id: _dropDraftId, ...rest } = draft as any;
    // $setOnInsert means a re-merge with the same idempotency key is a no-op
    // (no overwrite). The unique index in formModel.ts guarantees at most one
    // production form per key.
    await Form.findOneAndUpdate(
      {
        user: userId,
        agentIdempotencyKey: draft.idempotencyKey,
      },
      {
        $setOnInsert: {
          ...rest,
          user: userId,
          // Strip any draft-shaped IDs so a fresh ObjectId/_id is generated.
          _id: undefined,
        },
      },
      { upsert: true, session, new: true },
    );
    if (draft.idempotencyKey) {
      stats.mergedForms++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(draft._id || "NEW_FORM"),
        action: "create_form",
        serverDiff: rest,
        outcome: "success"
      }], { session });
    }
  }

  // 2. Updates — apply with optimistic concurrency, routed by _mergeKind.
  for (const upd of store.updates) {
    const mergeKind: MergeableKind = (upd.updates as any)?._mergeKind || "form_update";
    const cleanUpdates = { ...upd.updates };
    delete (cleanUpdates as any)._mergeKind;

    // B-S2.8: Route by merge kind
    if (mergeKind === "user_update") {
      await applyUserUpdate(userId, ticketId, upd, cleanUpdates, session, stats);
      continue;
    }

    // B-S3.4: Skill merge — gated by skill_authoring scope
    if (mergeKind === "skill_create" || mergeKind === "skill_update" || mergeKind === "skill_soft_delete") {
      await applySkillMerge(userId, ticketId, upd, cleanUpdates, mergeKind, session, stats);
      continue;
    }

    let model: mongoose.Model<any>;
    let actionLabel: string;
    if (mergeKind === "view_update") {
      model = CustomView;
      actionLabel = "update_view";
    } else {
      model = Form;
      actionLabel = mergeKind === "form_status" ? "set_form_status"
        : mergeKind === "form_metadata" ? "update_form_metadata"
        : "update_form";
    }

    const filter: Record<string, any> = {
      _id: new mongoose.Types.ObjectId(upd.id),
      user: userId,
    };
    if (upd.expectedUpdatedAt) {
      filter.updatedAt = upd.expectedUpdatedAt;
    }
    const updateOp = { $set: cleanUpdates };
    const res = await model.updateOne(filter, updateOp, { session });
    if (res.matchedCount > 0) {
      stats.updatesApplied++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(upd.id),
        action: actionLabel,
        serverDiff: cleanUpdates,
        outcome: "success"
      }], { session });
    } else {
      stats.updatesMissed++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(upd.id),
        action: actionLabel,
        serverDiff: cleanUpdates,
        outcome: "concurrency_miss"
      }], { session });
    }
  }

  // 3. Deletes.
  for (const del of store.deletes) {
    const filter: Record<string, any> = {
      _id: new mongoose.Types.ObjectId(del.id),
      user: userId,
    };
    if (del.expectedUpdatedAt) {
      filter.updatedAt = del.expectedUpdatedAt;
    }
    const res = await Form.deleteOne(filter, { session });
    if (res.deletedCount > 0) {
      stats.deletesApplied++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(del.id),
        action: "delete_form",
        serverDiff: null,
        outcome: "success"
      }], { session });
    } else {
      // Optimistic-concurrency check failed: form was modified between
      // sandbox snapshot and merge. Track as missed and audit.
      stats.deletesMissed++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(del.id),
        action: "delete_form",
        serverDiff: null,
        outcome: "concurrency_miss"
      }], { session });
    }
  }
}

async function mergeViews(
  userId: string,
  ticketId: string,
  snapshot: Awaited<ReturnType<typeof sandboxRedisStore.get>>,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  const store = snapshot;
  for (const draft of Object.values(store.customViews)) {
    const { isSandboxDraft: _omit, _id: _dropDraftId, ...rest } = draft as any;
    const doc = await CustomView.findOneAndUpdate(
      {
        user: userId,
        agentIdempotencyKey: draft.idempotencyKey,
      },
      {
        $setOnInsert: {
          ...rest,
          user: userId,
          _id: undefined,
        },
      },
      { upsert: true, session, new: true },
    );
    
    if (draft.idempotencyKey) {
      stats.mergedViews++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(doc?._id || "NEW_VIEW"),
        action: "create_view",
        serverDiff: rest,
        outcome: "success"
      }], { session });
    }
  }
}

/**
 * Standalone MongoDB fallback: two-phase merge using PendingMerge collection.
 * Used when replica set is not available (transactions not supported).
 * Provides idempotency via unique index on (ticketId, userId).
 */
async function mergeSandboxToProductionStandalone(
  userId: string,
  ticketId: string,
): Promise<{ mergedForms: number; mergedViews: number; updatesApplied: number; updatesMissed: number; deletesApplied: number; deletesMissed: number }> {
  const stats: MergeStats = { mergedForms: 0, mergedViews: 0, updatesApplied: 0, updatesMissed: 0, deletesApplied: 0, deletesMissed: 0 };
  
  const snapshot = await sandboxRedisStore.get(userId, ticketId);
  
  // Phase 1: Reserve merge slot with idempotency
  const existing = await PendingMerge.findOneAndUpdate(
    { ticketId, userId },
    { 
      $setOnInsert: { 
        ticketId, 
        userId, 
        snapshot,
        status: "PROCESSING"
      }
    },
    { upsert: true, new: true }
  ).lean();
  
  // If another merge already completed, return its stats
  if (existing && existing.status === "COMPLETED") {
    return existing.snapshot as any; // cached stats
  }
  
  // If another merge is in progress, wait or fail
  if (existing && existing.status === "PROCESSING") {
    throw new Error("Merge already in progress for this ticket");
  }
  
  try {
    // Phase 2: Execute merge without transaction (best effort)
    // Note: without transactions, partial failure can leave inconsistent state
    // but idempotency keys prevent duplicates on retry
    
    // 1. Create drafts
    for (const draft of Object.values(snapshot.forms)) {
      const { isSandboxDraft: _omit, _id: _dropDraftId, ...rest } = draft as any;
      await Form.findOneAndUpdate(
        { user: userId, agentIdempotencyKey: draft.idempotencyKey },
        { $setOnInsert: { ...rest, user: userId, _id: undefined } },
        { upsert: true, new: true }
      );
      if (draft.idempotencyKey) {
        stats.mergedForms++;
        await AgentAuditEvent.create([{
          ticketId, userId,
          resourceId: String(draft._id || "NEW_FORM"),
          action: "create_form",
          serverDiff: rest,
          outcome: "success"
        }]);
      }
    }
    
    // 2. Updates
    for (const upd of snapshot.updates) {
      const filter: Record<string, any> = {
        _id: new mongoose.Types.ObjectId(upd.id),
        user: userId,
      };
      if (upd.expectedUpdatedAt) filter.updatedAt = upd.expectedUpdatedAt;
      const res = await Form.updateOne(filter, { $set: upd.updates });
      if (res.matchedCount > 0) {
        stats.updatesApplied++;
        await AgentAuditEvent.create([{ ticketId, userId, resourceId: String(upd.id), action: "update_form", serverDiff: upd.updates, outcome: "success" }]);
      } else {
        stats.updatesMissed++;
        await AgentAuditEvent.create([{ ticketId, userId, resourceId: String(upd.id), action: "update_form", serverDiff: upd.updates, outcome: "concurrency_miss" }]);
      }
    }
    
    // 3. Deletes
    for (const del of snapshot.deletes) {
      const filter: Record<string, any> = {
        _id: new mongoose.Types.ObjectId(del.id),
        user: userId,
      };
      if (del.expectedUpdatedAt) filter.updatedAt = del.expectedUpdatedAt;
      const res = await Form.deleteOne(filter);
      if (res.deletedCount > 0) {
        stats.deletesApplied++;
        await AgentAuditEvent.create([{ ticketId, userId, resourceId: String(del.id), action: "delete_form", serverDiff: null, outcome: "success" }]);
      } else {
        stats.deletesMissed++;
        await AgentAuditEvent.create([{ ticketId, userId, resourceId: String(del.id), action: "delete_form", serverDiff: null, outcome: "concurrency_miss" }]);
      }
    }
    
    // 4. Custom Views
    for (const draft of Object.values(snapshot.customViews)) {
      const { isSandboxDraft: _omit, _id: _dropDraftId, ...rest } = draft as any;
      const doc = await CustomView.findOneAndUpdate(
        { user: userId, agentIdempotencyKey: draft.idempotencyKey },
        { $setOnInsert: { ...rest, user: userId, _id: undefined } },
        { upsert: true, new: true }
      );
      
      if (draft.idempotencyKey) {
        stats.mergedViews++;
        await AgentAuditEvent.create([{
          ticketId,
          userId,
          resourceId: String(doc?._id || "NEW_VIEW"),
          action: "create_view",
          serverDiff: rest,
          outcome: "success"
        }]);
      }
    }
    
    // Mark merge as completed
    await PendingMerge.findOneAndUpdate(
      { ticketId, userId },
      { 
        $set: { 
          status: "COMPLETED",
          snapshot: {
            mergedForms: stats.mergedForms,
            mergedViews: stats.mergedViews,
            updatesApplied: stats.updatesApplied,
            updatesMissed: stats.updatesMissed,
            deletesApplied: stats.deletesApplied,
            deletesMissed: stats.deletesMissed,
          }
        }
      }
    );
    
    await sandboxRedisStore.resetStore(userId, ticketId);
    
    return {
      mergedForms: stats.mergedForms,
      mergedViews: stats.mergedViews,
      updatesApplied: stats.updatesApplied,
      updatesMissed: stats.updatesMissed,
      deletesApplied: stats.deletesApplied,
      deletesMissed: stats.deletesMissed,
    };
  } catch (err: any) {
    await PendingMerge.findOneAndUpdate(
      { ticketId, userId },
      { $set: { status: "FAILED", error: err?.message || String(err) } }
    );
    throw new Error(`mergeSandboxToProductionStandalone failed: ${err?.message || err}. Sandbox preserved for retry.`);
  }
}

export async function mergeSandboxToProduction(
  userId: string,
  ticketId: string,
): Promise<{ mergedForms: number; mergedViews: number; updatesApplied: number; updatesMissed: number; deletesApplied: number; deletesMissed: number }> {
  const stats: MergeStats = { mergedForms: 0, mergedViews: 0, updatesApplied: 0, updatesMissed: 0, deletesApplied: 0, deletesMissed: 0 };

  // Read the sandbox snapshot ONCE before the transaction to avoid drift from
  // a concurrent sandbox write mid-transaction and remove a Redis round-trip
  // from the critical section.
  const snapshot = await sandboxRedisStore.get(userId, ticketId);

  // Note: this is invoked directly in agentLoop's
  // `mergeApproved` branch. The returned shape is exactly `MergeStats` —
  // six raw counters with no cross-counter aggregation (D0.4). Unlike the
  // previous shape, `mergedForms` does NOT include updates or deletes.
  
  // Try transactional merge first (requires replica set)
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await mergeFormsAndIntents(userId, ticketId, snapshot, session, stats);
      await mergeViews(userId, ticketId, snapshot, session, stats);
    });
    // Commit succeeded — now safe to clear the sandbox.
    await sandboxRedisStore.resetStore(userId, ticketId);

    return {
      mergedForms: stats.mergedForms,
      mergedViews: stats.mergedViews,
      updatesApplied: stats.updatesApplied,
      updatesMissed: stats.updatesMissed,
      deletesApplied: stats.deletesApplied,
      deletesMissed: stats.deletesMissed,
    };
  } catch (err: any) {
    // Check if error is due to standalone MongoDB (no replica set)
    const isStandaloneError = 
      err?.message?.includes("Transaction") ||
      err?.message?.includes("replica set") ||
      err?.message?.includes("not supported") ||
      err?.code === 20 || // IllegalOperation
      err?.codeName === "IllegalOperation";
    
    if (isStandaloneError) {
      console.warn("[sandboxMerge] Transaction failed, falling back to standalone merge:", err.message);
      await session.endSession();
      // Fall back to standalone two-phase merge
      return mergeSandboxToProductionStandalone(userId, ticketId);
    }
    
    // Do not reset the sandbox — the user can retry.
    // Re-throw so agentLoop's handler marks the ticket LLM_ERROR.
    throw new Error(
      `mergeSandboxToProduction failed: ${err?.message || err}. Sandbox preserved for retry.`,
    );
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}
