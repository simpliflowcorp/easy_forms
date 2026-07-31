# Implementation Plan: Agent Core Remodel

**Scope.** Rewrite the Easy Forms agent core (`src/agent/`, `src/lib/`, `src/models/`) to fix the 24 defects cataloged during code review. Preserve the existing 5-persona pipeline shape and the public SSE API (`POST /api/agent/execute`); only internals change.

**Decisions locked with the user.**
- Full rewrite of agent core (not just critical fixes).
- Sandbox persistence: **move to Redis** (`sandbox:{userId}`, 24h TTL).
- Merge atomicity: **Mongo transaction + idempotency keys** (replica set required; fallback path documented).
- Evaluator: **LLM-based semantic QA**.
- Concurrency: **Redis SETNX per-user lock**.
- Type-drift migration: **migrate existing in-flight tickets** via one-time script.

## Phase 1 — Foundations (no runtime behavior change)

### 1.1 Unify `SandboxStoreState` and fix type drift (#17, #20)
- `src/agent/types.ts`: extend `SandboxStoreState` with `updates: AgentPendingUpdate[]`, `deletes: AgentPendingDelete[]`, `queryResults: Record<string, any>`. Define `AgentPendingUpdate { id; updates; expectedUpdatedAt?; idempotencyKey }` and `AgentPendingDelete { id; expectedUpdatedAt?; idempotencyKey }`.
- Delete the duplicate type in `sandbox/sandboxStore.ts:5-11`; import from `types.ts`.
- Update `models/agentTicketModel.ts` default factory for `sandbox`.

### 1.2 Redis sandbox store (#3)
- New file `src/agent/sandbox/sandboxRedisStore.ts`. Keys `sandbox:{userId}` → JSON, 24h TTL. Atomic RMW inside the per-user lock (Phase 5).
- Keep `sandboxStore.ts` as a thin re-export façade so call sites don't change in this phase.

### 1.3 Redis per-user lock (#9)
- New file `src/agent/sandbox/agentLock.ts`. `acquireAgentLock(userId)` using `SET agent_lock:{userId} <ticketId> NX PX 60000`; release via Lua compare-and-del. Return `release()` no-op if not held.
- `agentLoop.ts` acquires before any work; throws `AgentBusyError` (added to `types.ts`).

### 1.4 UUID generator for action IDs (#15)
- New `src/agent/helper/id.ts` exporting `newActionId()` and `newTicketId()`.
- Replace `Date.now()+Math.random()` in `personas/planner.ts:63` and trace steps in `agentLoop.ts:23`.

### 1.5 Idempotency keys for merge (#4)
- Extend pending types with `idempotencyKey: string`.
- Add sparse unique compound index on `Form` for `(user, agentIdempotencyKey)` in `models/formModel.ts`.

### 1.6 Migration script (#17 migration)
- New `scripts/migrate-agent-tickets.mjs` (or `.ts` if `tsx` exists). Defaults to dry-run; `--apply` to commit. Coerces legacy sandbox objects to the new schema; marks unrecoverable tickets `LLM_ERROR`.
- Add `npm run agent:migrate` script.

**Exit gate.** `npx tsc --noEmit` clean; migration script reports counts in dry-run.

## Phase 2 — Permission enforcement layer (#6, partial #24)

### 2.1 Single permission gate
- New `src/agent/policy/permissions.ts` — `checkPermission(skill, perms)`. Maps each skill in `skills.md` to a scope; returns deny reason on failure.
- Wire into `personas/drafter.ts` BEFORE stage branches; wire again in `executor.ts` as defense-in-depth.

### 2.2 Tool whitelist at execution (#20)
- `personas/executor.ts`: drop `"delete_forms"` (plural); allow only the tools in `tools.ts`. Hallucinated tools become clean error actions for the loop to retry.

**Exit gate.** Flipping `permissions.json` `form_management:false` causes the build flow to reject at runtime; hallucinated `delete_forms` yields a clean error action.

## Phase 3 — Robust LLM handling (#5, #13, #21)

### 3.1 Safe JSON extractor
- New `src/agent/helper/jsonParse.ts` — `safeJSON(raw)`: direct parse → balanced-brace scan → last-resort nullable return. Replaces greedy regex in `drafter.ts:46-48`.

### 3.2 LLM client wrapper with retry/backoff
- `src/lib/llmClient.ts`: add `retryLLM(messages, options, {retries=3, baseMs=500})` exponential + jitter on `429/5xx/network/Abort`.
- Error classes: `LLMOfflineError`, `LLMRateLimitError`, `LLMParseError`, `LLMTimeoutError`.
- Cap `AbortController` timeout at `LLM_TIMEOUT_MS` env (default 30,000 ms; current 100-min is a bug).

### 3.3 Remove Llama-specific hack from Planner (#13)
- `personas/planner.ts:35-57`: delete the `<|python_tag|>` fallback. Quarantine to `legacy/llama3Fallback.ts` gated by `LLM_ALLOW_LEGACY_FALLBACK=1`.

**Exit gate.** Unit tests for `safeJSON` (nested braces, code blocks, malformed); LLM `429` triggers 3 deterministic retries on a mock.

## Phase 4 — Persona correctness (#1, #8, #11, #23, #19)

### 4.1 Evaluator: real LLM-based QA (#1, #23)
- `personas/evaluator.ts` rewrite. LLM system prompt derived from `Agent.md:100-119` returns JSON `{isComplete, shouldRetry, feedback}` via `safeJSON`.
- Retry target: **EXECUTOR_SANDBOX** (not Planner). Append `evaluatorFeedback` to Executor's next user message so it actually knows what failed.
- Increment `iterationCount` only here.
- Evaluator (not Communicator) sets `AWAITING_USER_APPROVAL` when a mutate action succeeded.
- On `maxIterations`, transition to `COMMUNICATOR` with recovery message.

### 4.2 Planner reads feedback (#11, #23)
- `personas/planner.ts`: conditionally prepend `evaluatorFeedback` into the user message on retry.
- Replace placeholder `description` with concrete sentences; validate `params` against parsed `guidelines.md`.

### 4.3 Drafter: kill hardcoded defaults (#19, #8)
- `personas/drafter.ts:144-148`: remove the `[Full Name, Email]` fallback; return `isVague:true` instead.
- `isFollowUpConfirmed` branch (`drafter.ts:60-67`): load linked ticket's `requirements` from Mongo and merge; otherwise the branch is dead code.
- Add `guideResponse` to the DRAFTER JSON schema in `prompts.ts` so the `product_guide` branch has content.

### 4.4 Follow-up context hygiene
- `drafter.ts:12-15`: exclude `REJECTED`/`LLM_ERROR`; cap to 3 recent with `{ticketId, title, originalPrompt}`.
- `agentLoop.ts:87` on resume: do not overwrite `state.prompt`; store a separate `state.resumedPrompt` if needed.

**Exit gate.** Integration tests: (a) failed Executor action retries against Executor (not Planner), exactly 1 iteration consumed; (b) `"build a form"` returns clarifying question (no 2-field surprise form); (c) `product_guide` returns LLM-generated content.

## Phase 5 — Sandbox isolation reworked (#2, #4, #10, #17, #24)

### 5.1 Executor never writes prod for non-readonly flows
- `personas/executor.ts`: `update_form`/`delete_form` read prod only to snapshot existence + `updatedAt` for optimistic concurrency; store the snapshot in the pending types. No raw regex against `name`. No `delete_forms`.
- `run_database_query`: cache results in `state.sandbox.queryResults[actionId]` for deterministic re-runs.

### 5.2 Fix tenant leak in `agentTools.ts` (#24)
- `src/lib/agentTools.ts:122-124`: intersect LLM-supplied `form_id` with userFormIds (never overwrite). Same for `Form`/`CustomView` `form_id` filters.

### 5.3 mergeToProduction: Mongo transaction + idempotency (#4)
- `sandbox/sandboxRedisStore.ts` `mergeToProduction`: wrap in `session.withTransaction`; `findOneAndUpdate $setOnInsert` keyed on `(user, agentIdempotencyKey)`; `updateOne` with `{_id, user, updatedAt:expectedUpdatedAt}` for optimistic concurrency; `deleteOne` scoped by `{_id, user}`. `resetStore` only after commit.
- If production Mongo is standalone, fall back to idempotency-key + conditional-resetStore. Documented upgrade path.

### 5.4 Trace bloat cap (#18)
- `agentLoop.ts:33`: cap trace at 50 rolling entries; cap each `payload` at 4 KB (truncate with marker).

**Exit gate.** Mock-mongoose tests: merge runs in a session; re-merge creates 0 new forms; throw leaves sandbox intact; forged `form_id` returns empty (not cross-tenant).

## Phase 6 — Resilience, concurrency, telemetry (#7, #10, #16, #22)

### 6.1 Wire per-user lock into the loop (#9, #10)
- `agentLoop.ts`: `acquireAgentLock` in try/finally; detect TTL-expired mid-loop via GET before release → `LLM_ERROR` with "lock expired" reply. Route returns `409 {"error":"Agent busy for this user"}` on `AgentBusyError`.

### 6.2 Crash recovery hygiene (#7, #22)
- Non-merge success: mark Mongo `RESOLVED` AND clear Redis (`agentLoop.ts:201-202` currently only clears Redis).
- On resume from Mongo, reset `state.requirements.linkedTicketId` to avoid stale cross-linking.

### 6.3 Simulated offline: per-ticket (not global) (#16)
- `agentLoop.ts:134-137, 160-162`: `agent:simulated_offline:{ticketId}` set only on the ticket under test. Replace dynamic `await import("./sandbox/agentRedis.js")` with typed import.

### 6.4 Trace PII redaction
- `evaluator.ts`, `communicator.ts`: redact known-PII (`ip_address`, `user_agent`) from `summaryPayload` before LLM call or trace emit.

**Exit gate.** Concurrent `runAgentLoop` calls → exactly one succeeds, one 409; `simulate-offline` route scoped to a ticketId.

## Phase 7 — Cleanup & docs (#12, #14, dead code)
- Remove duplicate `AgentAction` in `lib/agentTools.ts:6-15`.
- Update `Agent.md`: Evaluator sets `AWAITING_USER_APPROVAL`, retries target Executor.
- Update `guardrails.md`: document Redis sandbox + per-user lock.
- Extend `Agent.md` with new state lifecycle + retry budget.

## Cross-phase verification gate
1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run lint`
3. `npm run agent:migrate` (post-Phase 1, dry-run)
4. New agent unit tests: `npm test -- --grep agent`
5. Manual smoke: "build me a feedback form with rating, email, comments", then "yes" follow-up.

## Sequencing
Phases 2/3/5 can proceed in parallel after Phase 1. Phase 4 depends on Phase 3. Phase 6 depends on Phases 4 and 5. Phase 7 is fast-follow.

## Open items
1. Migration script runner — confirmed at Phase 1.6 (default `.mjs` if no `tsx`).
2. Mongo replica set check at Phase 5.
3. Frontend `409 busy` envelope — typed event vs. existing error envelope (decide in execution).
