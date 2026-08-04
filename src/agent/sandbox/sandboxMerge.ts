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
import mongoose from "mongoose";
import { sandboxRedisStore } from "./sandboxRedisStore.js";
import AgentAuditEvent from "@/models/agentAuditEventModel";
import PendingMerge from "@/models/PendingMerge";
import type { MergeStats } from "./types.js";

// Re-export the frozen contract for existing importers of sandboxMerge.
export type { MergeStats } from "./types.js";

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

  // 2. Updates — apply with optimistic concurrency.
  for (const upd of store.updates) {
    const filter: Record<string, any> = {
      _id: new mongoose.Types.ObjectId(upd.id),
      user: userId,
    };
    if (upd.expectedUpdatedAt) {
      filter.updatedAt = upd.expectedUpdatedAt;
    }
    const updateOp = { $set: upd.updates };
    const res = await Form.updateOne(filter, updateOp, { session });
    if (res.matchedCount > 0) {
      stats.updatesApplied++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(upd.id),
        action: "update_form",
        serverDiff: upd.updates,
        outcome: "success"
      }], { session });
    } else {
      // Optimistic-concurrency check failed: form was modified between
      // sandbox snapshot and merge. Track as missed and audit.
      stats.updatesMissed++;
      await AgentAuditEvent.create([{
        ticketId,
        userId,
        resourceId: String(upd.id),
        action: "update_form",
        serverDiff: upd.updates,
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
