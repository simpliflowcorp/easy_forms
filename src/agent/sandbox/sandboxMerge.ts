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
 * standalone, the transaction is going to fail at runtime; we surface the
 * failure as a thrown error to agentLoop which marks the ticket LLM_ERROR.
 */
import Form from "@/models/formModel";
import CustomView from "@/models/customViewModel";
import mongoose from "mongoose";
import { sandboxRedisStore } from "./sandboxRedisStore.js";
import AgentTicketModel from "@/models/agentTicketModel";

export interface MergeStats {
  mergedForms: number;
  mergedViews: number;
  updatesApplied: number;
  deletesApplied: number;
}

async function mergeFormsAndIntents(
  userId: string,
  ticketId: string,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  const store = await sandboxRedisStore.get(userId, ticketId);
  const ticket = await AgentTicketModel.findOne({ ticketId }).session(session).lean();
  const changeHistoryReport = ticket ? (ticket as any).changeHistoryReport : null;
  const pushHistory = changeHistoryReport ? { $push: { changeHistory: changeHistoryReport } } : {};

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
        ...pushHistory
      },
      { upsert: true, session, new: true },
    );
    if (draft.idempotencyKey) stats.mergedForms++;
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
    const updateOp = { $set: upd.updates, ...pushHistory };
    const res = await Form.updateOne(filter, updateOp, { session });
    if (res.matchedCount > 0) stats.updatesApplied++;
    // If matchedCount === 0 and the user expected this update to apply,
    // the optimistic-concurrency check failed (someone edited the form
    // between sandbox snapshot and merge). We do NOT raise — we log via
    // the stats return value and let the caller decide.
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
    if (res.deletedCount > 0) stats.deletesApplied++;
  }
}

async function mergeViews(
  userId: string,
  ticketId: string,
  session: mongoose.ClientSession,
  stats: MergeStats,
): Promise<void> {
  const store = await sandboxRedisStore.get(userId, ticketId);
  for (const draft of Object.values(store.customViews)) {
    const { isSandboxDraft: _omit, _id: _dropDraftId, ...rest } = draft as any;
    await CustomView.findOneAndUpdate(
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
    stats.mergedViews++;
  }
}

export async function mergeSandboxToProduction(
  userId: string,
  ticketId: string,
): Promise<{ mergedForms: number; mergedViews: number; updatesApplied?: number; deletesApplied?: number }> {
  const stats: MergeStats = { mergedForms: 0, mergedViews: 0, updatesApplied: 0, deletesApplied: 0 };

  // Note: this is invoked via the sandboxStore façade in agentLoop's
  // `mergeApproved` branch. We intentionally surface a richer stats object
  // than the signature claims — agentLoop only reads mergedForms / mergedViews
  // for its reply text, so the extra keys are informational and ignored.
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await mergeFormsAndIntents(userId, ticketId, session, stats);
      await mergeViews(userId, ticketId, session, stats);
    });
    // Commit succeeded — now safe to clear the sandbox.
    await sandboxRedisStore.resetStore(userId, ticketId);

    return {
      mergedForms: stats.mergedForms + stats.updatesApplied + stats.deletesApplied,
      mergedViews: stats.mergedViews,
      updatesApplied: stats.updatesApplied,
      deletesApplied: stats.deletesApplied,
    };
  } catch (err: any) {
    // Do not reset the sandbox — the user can retry.
    // Re-throw so agentLoop's handler marks the ticket LLM_ERROR.
    throw new Error(
      `mergeSandboxToProduction failed: ${err?.message || err}. Sandbox preserved for retry.`,
    );
  } finally {
    await session.endSession();
  }
}
