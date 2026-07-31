import { AgentPendingDelete, AgentPendingUpdate, SandboxStoreState, emptySandboxStore } from "../types.js";
import { agentRedis } from "./agentRedis.js";

/**
 * Sandbox stored in Redis under key `sandbox:{userId}` with a 24h TTL.
 *
 * Why Redis (not in-memory Map):
 *   - Survives process restart (the in-memory old store was lost on crash
 *     even though agentLoop advertised crash recovery).
 *   - Shares state across replicas in a horizontal deployment.
 *
 * Read-modify-write calls MUST be made while holding the per-user agent lock
 * (see agentLock.ts) to be atomic. Methods do not acquire the lock themselves.
 */
const SANDBOX_TTL_SECONDS = 24 * 60 * 60;
const idem = (): string => `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const sandboxRedisStore = {
  key(userId: string, ticketId: string): string {
    return `sandbox:${userId}:${ticketId}`;
  },

  async get(userId: string, ticketId: string): Promise<SandboxStoreState> {
    const raw = await agentRedis.client.get(this.key(userId, ticketId));
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

  async _save(userId: string, ticketId: string, store: SandboxStoreState): Promise<void> {
    await agentRedis.client.set(this.key(userId, ticketId), JSON.stringify(store), "EX", SANDBOX_TTL_SECONDS);
  },

  async resetStore(userId: string, ticketId: string): Promise<void> {
    await this._save(userId, ticketId, emptySandboxStore());
  },

  async saveDraftForm(userId: string, ticketId: string, formData: any): Promise<any> {
    const store = await this.get(userId, ticketId);
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
    await this._save(userId, ticketId, store);
    return draftForm;
  },

  async saveDraftView(userId: string, ticketId: string, viewData: any): Promise<any> {
    const store = await this.get(userId, ticketId);
    const draftId = viewData?._id || `draft_view_${Date.now()}`;
    const idempotencyKey = viewData?.idempotencyKey || idem();
    const draftView = {
      ...viewData,
      _id: draftId,
      isSandboxDraft: true,
      idempotencyKey,
    };
    store.customViews[draftId] = draftView;
    await this._save(userId, ticketId, store);
    return draftView;
  },

  async saveUpdateIntention(
    userId: string,
    ticketId: string,
    formId: string,
    updates: any,
    idempotencyKey?: string,
    expectedUpdatedAt?: Date,
  ): Promise<AgentPendingUpdate> {
    const store = await this.get(userId, ticketId);
    const pending: AgentPendingUpdate = {
      id: formId,
      updates,
      idempotencyKey: idempotencyKey || idem(),
      expectedUpdatedAt,
    };
    store.updates.push(pending);
    await this._save(userId, ticketId, store);
    return pending;
  },

  async saveDeleteIntention(
    userId: string,
    ticketId: string,
    formId: string,
    idempotencyKey?: string,
    expectedUpdatedAt?: Date,
  ): Promise<AgentPendingDelete> {
    const store = await this.get(userId, ticketId);
    const pending: AgentPendingDelete = {
      id: formId,
      idempotencyKey: idempotencyKey || idem(),
      expectedUpdatedAt,
    };
    store.deletes.push(pending);
    await this._save(userId, ticketId, store);
    return pending;
  },

  async setQueryResult(userId: string, ticketId: string, resultKey: string, result: any): Promise<void> {
    const store = await this.get(userId, ticketId);
    store.queryResults[resultKey] = result;
    await this._save(userId, ticketId, store);
  },

  async getQueryResult(userId: string, ticketId: string, resultKey: string): Promise<any | undefined> {
    const store = await this.get(userId, ticketId);
    return store.queryResults[resultKey];
  },
};
