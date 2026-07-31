import { SandboxStoreState as CanonicalSandboxStoreState, emptySandboxStore } from "../types.js";
import { sandboxRedisStore } from "./sandboxRedisStore.js";

/**
 * Backward-compatible façade over the new Redis-backed sandbox store.
 *
 * The legacy in-memory Map was lost on process restart and did not scale to
 * multiple replicas. All state now lives in Redis under `sandbox:{userId}`
 * (see sandboxRedisStore.ts).
 *
 * Merge semantics remain `TODO` until Phase 5.3 wires Mongo transactions +
 * idempotency keys; until then we keep a `mergeToProduction` stub that
 * matches the old signature but is replaced in Phase 5.3.
 */
export interface SandboxStoreState {
  forms: Record<string, any>;
  customViews: Record<string, any>;
  queryResults: Record<string, any>;
  updates: Array<{ id: string; data: any }>;
  deletes: Array<string>;
}

/**
 * Legacy synchronous accessor that callers previously used to read the in-memory
 * store. The new backend is async (Redis), so callers must use `getStoreAsync`
 * or the dedicated mutation methods. Where old call sites pass `sandbox:
 * sandboxStore.getStore(userId)` (e.g. agentLoop initialization), update those
 * to use `emptySandboxStore()` for the initial value and let the personas pull
 * asynchronously when they need it.
 */
export const sandboxStore = {
  /** @deprecated use emptySandboxStore() + lazy async reads instead. */
  getStore(_userId: string): SandboxStoreState {
    return emptySandboxStore() as unknown as SandboxStoreState;
  },

  async getStoreAsync(userId: string, ticketId: string): Promise<SandboxStoreState> {
    const s: CanonicalSandboxStoreState = await sandboxRedisStore.get(userId, ticketId);
    return {
      forms: s.forms,
      customViews: s.customViews,
      queryResults: s.queryResults,
      // Flatten canonical pending types back into the legacy shape.
      updates: s.updates.map((u) => ({ id: u.id, data: u.updates })),
      deletes: s.deletes.map((d) => d.id),
    };
  },

  async resetStore(userId: string, ticketId: string): Promise<void> {
    await sandboxRedisStore.resetStore(userId, ticketId);
  },

  async saveDraftForm(userId: string, ticketId: string, formData: any): Promise<any> {
    return sandboxRedisStore.saveDraftForm(userId, ticketId, formData);
  },

  async saveDraftView(userId: string, ticketId: string, viewData: any): Promise<any> {
    return sandboxRedisStore.saveDraftView(userId, ticketId, viewData);
  },

  async saveUpdateIntention(userId: string, ticketId: string, formId: string, updates: any): Promise<void> {
    await sandboxRedisStore.saveUpdateIntention(userId, ticketId, formId, updates);
  },

  async saveDeleteIntention(userId: string, ticketId: string, formId: string): Promise<void> {
    await sandboxRedisStore.saveDeleteIntention(userId, ticketId, formId);
  },

  /**
   * Merge isolated sandbox drafts into production MongoDB.
   * Rewritten in Phase 5.3 with Mongo transaction + idempotency keys.
   */
  async mergeToProduction(userId: string, ticketId: string): Promise<{ mergedForms: number; mergedViews: number }> {
    // Delegate to the transactional implementation when available.
    const { mergeSandboxToProduction } = await import("./sandboxMerge.js");
    return mergeSandboxToProduction(userId, ticketId);
  },
};
