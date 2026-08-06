import { AgentPendingDelete, AgentPendingUpdate, SandboxStoreState, emptySandboxStore } from "../types.js";
import { agentRedis } from "./agentRedis.js";

/**
 * Sandbox stored in Redis with two namespacing modes:
 *   - Legacy: `sandbox:{userId}:{ticketId}` (for in-flight Stage 2 tickets)
 *   - Stage 3: `sandbox:{userId}:{executionId}` (for multi-intent Orchestrator executions)
 * 
 * Both have 24h TTL. Read-modify-write MUST hold the appropriate lock.
 */
const SANDBOX_TTL_SECONDS = 24 * 60 * 60;
const idem = (): string => `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

/** Build the Redis key, defaulting to legacy ticketId mode. */
function buildKey(userId: string, ticketId: string, executionId?: string): string {
  if (executionId) {
    return `sandbox:${userId}:${executionId}`;
  }
  return `sandbox:${userId}:${ticketId}`;
}

export const sandboxRedisStore = {
  /** @deprecated Use keyWithExecutionId for Stage 3 */
  key(userId: string, ticketId: string): string {
    return buildKey(userId, ticketId);
  },

  /** Stage 3: namespaced by executionId for multi-intent parallelism. */
  keyWithExecutionId(userId: string, executionId: string): string {
    return `sandbox:${userId}:${executionId}`;
  },

  /** Get sandbox by ticketId (legacy) or executionId (Stage 3). */
  async get(userId: string, ticketId: string, executionId?: string): Promise<SandboxStoreState> {
    const key = buildKey(userId, ticketId, executionId);
    const raw = await agentRedis.client.get(key);
    if (!raw) return emptySandboxStore();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptySandboxStore();
      return {
        forms: parsed.forms && typeof parsed.forms === "object" ? parsed.forms : {},
        customViews:
          parsed.customViews && typeof parsed.customViews === "object" ? parsed.customViews : {},
        queryResults:
          parsed.queryResults && typeof parsed.queryResults === "object"
            ? parsed.queryResults
            : {},
        updates: Array.isArray(parsed.updates) ? parsed.updates : [],
        deletes: Array.isArray(parsed.deletes) ? parsed.deletes : [],
      };
    } catch {
      return emptySandboxStore();
    }
  },

  async _save(userId: string, ticketId: string, store: SandboxStoreState, executionId?: string): Promise<void> {
    const key = buildKey(userId, ticketId, executionId);
    await agentRedis.client.set(key, JSON.stringify(store), "EX", SANDBOX_TTL_SECONDS);
  },

  async resetStore(userId: string, ticketId: string, executionId?: string): Promise<void> {
    await this._save(userId, ticketId, emptySandboxStore(), executionId);
  },

  async saveDraftForm(userId: string, ticketId: string, formData: any, executionId?: string): Promise<any> {
    const store = await this.get(userId, ticketId, executionId);
    const draftId = formData?.formId || `draft_form_${Date.now()}`;
    const idempotencyKey = formData?.idempotencyKey || idem();
    const draftForm = {
      ...formData,
      _id: draftId,
      formId: draftId,
      isSandboxDraft: true,
      idempotencyKey,
    };
    store.forms[draftId] = draftForm;
    await this._save(userId, ticketId, store, executionId);
    return draftForm;
  },

  async saveDraftView(userId: string, ticketId: string, viewData: any, executionId?: string): Promise<any> {
    const store = await this.get(userId, ticketId, executionId);
    const draftId = viewData?._id || `draft_view_${Date.now()}`;
    const idempotencyKey = viewData?.idempotencyKey || idem();
    const draftView = {
      ...viewData,
      _id: draftId,
      isSandboxDraft: true,
      idempotencyKey,
    };
    store.customViews[draftId] = draftView;
    await this._save(userId, ticketId, store, executionId);
    return draftView;
  },

  async saveUpdateIntention(
    userId: string,
    ticketId: string,
    formId: string,
    updates: any,
    idempotencyKey?: string,
    expectedUpdatedAt?: Date,
    executionId?: string
  ): Promise<AgentPendingUpdate> {
    const store = await this.get(userId, ticketId, executionId);
    const pending: AgentPendingUpdate = {
      id: formId,
      updates,
      idempotencyKey: idempotencyKey || idem(),
      expectedUpdatedAt,
    };
    store.updates.push(pending);
    await this._save(userId, ticketId, store, executionId);
    return pending;
  },

  async saveDeleteIntention(
    userId: string,
    ticketId: string,
    formId: string,
    idempotencyKey?: string,
    expectedUpdatedAt?: Date,
    executionId?: string
  ): Promise<AgentPendingDelete> {
    const store = await this.get(userId, ticketId, executionId);
    const pending: AgentPendingDelete = {
      id: formId,
      idempotencyKey: idempotencyKey || idem(),
      expectedUpdatedAt,
    };
    store.deletes.push(pending);
    await this._save(userId, ticketId, store, executionId);
    return pending;
  },

  async setQueryResult(userId: string, ticketId: string, resultKey: string, result: any, executionId?: string): Promise<void> {
    const store = await this.get(userId, ticketId, executionId);
    store.queryResults[resultKey] = result;
    await this._save(userId, ticketId, store, executionId);
  },

  /** Alias for _save for compatibility with executor calls. */
  async set(userId: string, ticketId: string, store: SandboxStoreState, executionId?: string): Promise<void> {
    await this._save(userId, ticketId, store, executionId);
  },

  async getQueryResult(userId: string, ticketId: string, resultKey: string, executionId?: string): Promise<any | undefined> {
    const store = await this.get(userId, ticketId, executionId);
    return store.queryResults[resultKey];
  },
};
