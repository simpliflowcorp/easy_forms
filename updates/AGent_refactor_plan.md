# Agent Implementation Plan — Correctness, Security & Integrity Fixes (v1.1)

**Purpose**: This plan is the *execution-ready* companion to `AGENT_REFACTOR_PLAN.md`. Where
that document is aspirational (16-week WebSocket migration, CI eval harness, prompt A/B), this one
fixes the bugs that exist **today** in the agent loop — live correctness, cross-tenant, and
data-integrity gaps surfaced by the architecture review. It is scoped so it can land *before* (or
alongside) the larger refactor with zero dependency on it.

**Philosophy**: every task names the exact file(s), the precise change, why it's needed, and a
verifiable acceptance test. No item depends on a new infrastructure component (no WebSocket, no
eval harness, no prompt versioning). Each closes a concrete gap and stands on its own.

**Scope guidance**:
- **P0** = ship-stopper: a remaining cross-tenant vector, a secret in source, or silent data loss. Do first.
- **P1** = correctness / correctness-fairness: the system lies or silently misbehaves. Do next.
- **P2** = robustness / hygiene: prevents future regressions; reduces drift surface.
- **P3** = maintainability / DX.

**Estimated effort**: P0+P1 ≈ 1 engineering week; all phases ≈ 2-2.5 weeks. Far smaller than the
refactor plan because the hardening work in `revamp_1.1` already did most of the heavy lifting —
what remains is cleaning up the leftovers and the few spots where the remodel didn't fully match
its own spec.

**Relationship to `AGENT_REFACTOR_PLAN.md`**:
- The refactor plan's Phase 1 (read shortcut) assumes the read path is correct. Items **R2** and **R3**
  below must land first — the refactor will accelerate a buggy read path otherwise.
- The refactor plan's Phase 0.1 (replica set verification) is a *prerequisite* for **M1** being safe
  (transactions need a replica set). If standalone Mongo is in prod, **M1**'s transaction will throw
  at runtime; the fallback documented in the refactor plan must exist first.
- This plan reconciles the **Evaluator retry-target divergence** with the refactor plan's
  assumptions (see task **E1**) so neither document contradicts the other.

---

## Status legend

- `-` not started
- `~` in progress
- `x` done
- `!` blocked (note blocker)

---

## P0 — Ship-stoppers (do first, in order)

### P0-1 Remove the committed API key from `llmHealthMonitor.ts`

**File**: `src/lib/llmHealthMonitor.ts`
**Lines**: ~22-23 (`const apiKey = process.env.NVIDIA_API_KEY || "nvapi-..."`)

**Problem**: A literal NVIDIA API key is committed to source as a fallback. Even if it's "just" a
health-check key, it is a credential in version control and a security incident.

**Change**:
1. Delete the inline fallback string. Replace with:
   ```ts
   const apiKey = process.env.NVIDIA_API_KEY;
   if (!apiKey) {
     if (global._llmHealthLastStatus !== "unknown") {
       global._llmHealthLastStatus = "unknown";
       await pubClient.publish("agent:llm_health", JSON.stringify({ status: "unknown", reason: "NVIDIA_API_KEY not configured" }));
     }
     return;
   }
   ```
   Health status becomes `"unknown"` (not `"online"`) when the key is missing — fail closed, not fakely online.
2. Rotate the exposed key in the NVIDIA console immediately (out of band; not a code task but a required follow-up).
3. Add a `.env.example` entry if missing: `NVIDIA_API_KEY=` (no value).
4. Add a grep guard to CI/pre-commit: `git-secrets` or a `.github/workflows/secret-scan.yml` step
   that fails on `nvapi-[A-Za-z0-9_]{20,}`. (If no secret-scanning exists today, file an issue and
   do it as part of P2-3.)

**Acceptance**:
- `grep -rn "nvapi-" src/` returns nothing.
- With `NVIDIA_API_KEY` unset, `GET /api/agent/health-stream` emits `{ status: "unknown" }` and the
  health check short-circuits (no outbound fetch attempted).
- CI secret-scan passes.

**Status**: `-`

---

### P0-2 Fix the `Form` / `CustomView` `form_id` intersect guard in `run_database_query`

**File**: `src/lib/agentTools.ts`
**Lines**: ~144-152 (the `Form`/`CustomView` intersect guard block)

**Problem**: The Response branch intersect is correct because `Response.form_id` stores the Mongo
`_id`. But for the `Form`/`CustomView` branch, `userForms.map(f => f._id)` collects Mongo `_id`s,
then the intersect compares with `query.form_id` via `$eq: query.form_id`. If the LLM (or the
schema) supplies the *hashed* `formId` string (a distinct field), the `$eq` never matches and the
guard is dead weight — it silently returns empty results for legitimate user requests, AND it
doesn't actually defend against a forged `_id` because the types don't line up.

The intent (per the `#24` comment) is right; the comparison key is inconsistent with what callers
actually pass.

**Change**:
1. Resolve the caller's intended key once. Add a helper:
   ```ts
   function resolveFormIdFilter(userId: string, queryFormId: any): { $in: any[]; $eq?: any } | { $in: any[] } { ... }
   ```
   that, given `queryFormId`:
   - If it's a valid ObjectId → collect user's form `_id`s; return `{ $in: ids, $eq: new ObjectId(queryFormId) }`.
   - Else (hashed `formId` string) → collect user's form hashed `formId`s; return `{ $in: hashedIds, $eq: queryFormId }`.
   - If `queryFormId` is absent → `{ $in: allUserFormIds }` (current behavior preserved).
2. Apply the resolved filter to whichever field the *target collection* uses (`Response.form_id` =
   Mongo `_id`; `Form` filters by `_id` OR `formId` field). For `Form`/`CustomView`, instead of
   overwriting `secureQuery.form_id` (which is not even a field on those documents in the
   `run_database_query` find path), set `secureQuery` so that:
   - `secureQuery.user = userId` (already set) stays, AND
   - an `_id` or `formId` clause is added depending on the resolved type.
3. Use the same helper in the `Response` branch so all three branches share one identity-resolution
   codepath. Delete the duplicated `Form.find(...).select("_id")` queries.

**Acceptance**:
- Unit test `agentTools.run_database_query`:
  - User A owns form `{_id:"a1", formId:"hashA"}`, user B owns `{_id:"b1", formId:"hashB"}`.
  - User A queries `Form` with `query.form_id = "b1"` → returns `[]` (not B's form).
  - User A queries `Form` with `query.form_id = "hashA"` → returns A's form (previously returned `[]`).
  - User A queries `Form` with `query.form_id = "a1"` (ObjectId) → returns A's form.
  - Same matrix for `Response` collection.
- The duplicated `Form.find` user-form lookup appears exactly once per request (in the helper), not 2×.

**Status**: `-`

---

### P0-3 Remove the global `agent:simulated_offline` honoring path

**Files**: `src/agent/agentLoop.ts` (the `legacy` global-key read, ~the main while-loop top);
`src/app/api/agent/simulate-offline/route.ts` (the legacy global-key toggling branch).

**Problem**: Per-ticket simulated-offline exists (`agent:simulated_offline:{ticketId}`), but the loop
still *honors* the global `agent:simulated_offline` key and only logs a deprecation warning. A
leftover global key (operator forgot to clear it, or stale state) silently crashes *every* agent
invocation across the deployment. This is a production footgun masquerading as back-compat.

**Change**:
1. In `agentLoop.ts`, delete the `legacy` global-key read block entirely. Keep *only* the per-ticket
   check. Remove the `console.warn` deprecation note (no longer relevant — the path is gone).
2. In `simulate-offline/route.ts`, delete the `else` branch that toggles the global key. Require
   `ticketId` in the body: if absent, return `400 { error: "ticketId required" }`. This makes the
   endpoint honest — it can only target one ticket at a time.
3. Update `Agent.md` "Simulated offline" section to drop the global-key back-compat sentence.

**Acceptance**:
- Setting `agent:simulated_offline` (global) to `"true"` has **no effect** on any ticket.
- Setting `agent:simulated_offline:<ticketId>` to `"true"` crashes only that ticket's loop.
- `POST /api/agent/simulate-offline` with no `ticketId` returns 400.
- No reference to the bare `agent:simulated_offline` key remains in `src/`.

**Status**: `-`

---

## P1 — Correctness: stop the system from lying

### R1 Surface merge optimistic-concurrency / no-op failures to the user

**Files**: `src/agent/sandbox/sandboxMerge.ts` (return rich stats already computed),
`src/agent/agentLoop.ts` (consume them), `src/agent/personas/communicator.ts` / a new helper
(render the user-facing message).

**Problem**: `mergeSandboxToProduction` *computes* `updatesApplied` and `deletesApplied` but
`agentLoop` only reads `mergedForms`/`mergedViews` and always claims
"Successfully merged sandbox changes to production DB!". If a form was edited elsewhere between the
sandbox snapshot and the merge, the update `matchedCount === 0` → silently dropped, but the user
sees success. The documented "logged, not silently overwritten" intent is broken because the log
never reaches the user.

**Change**:
1. Type the return properly. In `sandboxMerge.ts` change the exported signature to return
   `{ mergedForms, mergedViews, updatesApplied, updatesMissed, deletesApplied, deletesMissed }`.
   Compute `*Missed` from `store.updates.length - updatesApplied` (and same for deletes).
2. In `agentLoop.ts` `mergeApproved` branch, read the full stats. If `updatesMissed + deletesMissed > 0`,
   set `state.reply` to a warning that lists the counts and explains the likely cause
   ("N change(s) couldn't be applied because the form was modified elsewhere after you previewed
   it. Please re-open the form and try again.").
3. Still mark the ticket `RESOLVED` (the *successful* parts committed), but include the warning so
   the user isn't falsely reassured.
4. (Optional, small) Write an `AgentAuditEvent` row per *missed* update/delete with
   `outcome: "concurrency_miss"` so there's a durable record in addition to the user toast.

**Acceptance**:
- Manual/integration test: build a form, snapshot intent, then edit the same form in another tab,
  then click "Confirm & Merge". The reply contains the concurrency warning and the audit collection
  has an `outcome:"concurrency_miss"` row.
- Clean-path merge (no concurrent edit) → no warning, behavior unchanged.

**Status**: `-`

---

### R2 Delete the production-write branches from `executeAgentTool`

**File**: `src/lib/agentTools.ts`
**Lines**: the `create_form`, `update_form`, `delete_form` switch cases (~lines 8-72).

**Problem**: The Executor never calls these for mutations (it queues into the sandbox instead), but
the production-write code still exists and still uses the legacy
`$or:[{ formId }, { _id: ObjectId.isValid(formId) ? formId : null }]` lookup. Any future caller (a
new route, a test, a refactor) that does `executeAgentTool("create_form", ...)` bypasses the entire
sandbox + idempotency-key + transaction safety model. Dead production-write code is a latent
footgun and contradicts guardrail #2 ("Direct production mutation is prohibited").

**Change**:
1. Remove the `create_form` / `update_form` / `delete_form` cases from `executeAgentTool`'s switch.
   Throw a clear error for them:
   ```ts
   case "create_form":
   case "update_form":
   case "delete_form":
     throw new Error(`${tool} must go through the sandbox → mergeSandboxToProduction path, not executeAgentTool.`);
   ```
2. Rename the function to `executeReadTool` (and the file to `readTools.ts`? — optional; keep the
   export name aliased for back-compat: `export { executeReadTool as executeAgentTool }`).
3. The only remaining cases: `run_database_query`. (And `query_responses` / `generate_analytics` /
   custom-view reads if those are still routed here — confirm each is read-only.)
4. Grep for any caller of `executeAgentTool("create_form"...)`. If found, rewrite to the sandbox
   path; if none, no call-site changes.

**Acceptance**:
- `grep -rn 'executeAgentTool("create_form"\|executeAgentTool("update_form"\|executeAgentTool("delete_form"' src/` → none.
- Calling `executeAgentTool("create_form", {...})` throws the explicit error.
- The read path (`run_database_query`) still works — golden read prompts return unchanged results.

**Status**: `-`

---

### E1 Reconcile the Evaluator retry target with its documented behavior

**Files**: `src/agent/personas/evaluator.ts` (the two `activePersona:"PLANNER"` retry returns);
`src/agent/Agent.md` (the "Evaluator" remodel note).

**Problem**: The Evaluator's comments claim failed-action retries route to `EXECUTOR_SANDBOX`
("short-circuit to retry against Executor (NOT Planner per Agent.md:100-119)"). The code sets
`activePersona: "PLANNER"` in both the deterministic-precheck retry (line ~55) **and** the LLM-QA
`shouldRetry` branch (line ~147). This (a) contradicts the docstring, (b) costs a Planner LLM call
on every retry, and (c) lets the Planner re-compile a *different* plan with no knowledge of the
sandbox draft that already exists — so a "fix the near-miss" retry can diverge from the prior
partial result.

Two of the three paths disagree:
- Deterministic pre-check failure → code: PLANNER, comment: Executor.
- LLM `shouldRetry` → code: PLANNER, doc (Agent.md): Executor.

**Change**: Pick one model and apply it to *both* retry paths, then make docs agree. Recommended
model (matches `Agent.md` semantics and is cheaper):

1. **Deterministic-precheck retry** (`failedActions.length > 0`):
   - Set `activePersona: "EXECUTOR_SANDBOX"` (re-run the *same* failed action with the same params
     and the `evaluatorFeedback` attached — the Planner isn't needed because the params are already
     known; the Executor already consumes `evaluatorFeedback` per-action).
   - This matches the inline comment and consumes zero extra LLM calls.
2. **LLM-QA `shouldRetry`**:
   - Set `activePersona: "EXECUTOR_SANDBOX"` and pass `evaluatorFeedback` describing *what* the LLM
     judged wrong. The Executor re-runs the existing plan with the feedback as a breadcrumb (it
     already logs this). **Rationale**: the plan already exists in `state.actionPlan`; re-planning
     from scratch discards the sandbox draft and risks divergence. Only if the Evaluator explicitly
     says "the *plan itself* is wrong" should we re-plan — and there's no such signal today.
   - Optional refinement: add `state.replanRequested` flag set when the Evaluator's `feedback`
     contains a sentinel like `"[replan]"`. Only then route to PLANNER. (Skip if you want to keep
     this task small — just align everything to EXECUTOR_SANDBOX.)
3. Update `Agent.md` "Evaluator" remodel bullet to state the final contract:
   "Both deterministic and LLM-driven retries route to EXECUTOR_SANDBOX with prior plan + feedback
   intact. The Planner is only re-engaged on a fresh ticket (post-Drafter) or an explicit
   `[replan]` signal."
4. Remove the now-misleading "NOT Planner per Agent.md:100-119" inline comment in favor of the
   corrected contract statement.

**Acceptance**:
- One retry path, one target. A failed action retries produce a trace entry
  `EVALUATOR → EXECUTOR_SANDBOX`, NOT `EVALUATOR → PLANNER`.
- Token usage per retry drops by one Planner LLM call (verifiable via the refactor plan's Phase 2
  usage tracking, or temporarily via a `console.log` count in the Evaluator).
- `Agent.md` no longer contradicts `evaluator.ts`.
- Golden test: an action that fails once then succeeds on retry completes in exactly one extra
  Executor pass, with no Planner call between.

**Note on cross-plan reconciliation**: This contradicts nothing in `AGENT_REFACTOR_PLAN.md`
(Phase 1's read shortcut assumes the Evaluator doesn't run at all on reads; Phase 6's eval harness
will assert against this contract — flagging it now pre-empts a CI red herring later).

**Status**: `-`

---

### M1 Capture the sandbox snapshot before the merge transaction

**File**: `src/agent/sandbox/sandboxMerge.ts`

**Problem**: `mergeFormsAndIntents` and `mergeViews` each call `sandboxRedisStore.get(userId, ticketId)` *inside* `session.withTransaction`. The per-user write lock makes same-user concurrency safe, but capturing the snapshot outside the transaction is clearer and removes any doubt about a concurrent sandbox write (e.g. a second ticket for the same user via a different code path, or a future lock relaxation from the refactor plan's Phase 4) drifting what's merged mid-transaction. It's also one fewer Redis round-trip inside the critical section.

**Change**:
1. Read the sandbox once, before `session.withTransaction`:
   ```ts
   const snapshot = await sandboxRedisStore.get(userId, ticketId);
   ```
2. Pass `snapshot` into `mergeFormsAndIntents(userId, ticketId, snapshot, session, stats)` and
   `mergeViews(userId, ticketId, snapshot, session, stats)`. Delete the in-function `get` calls.
3. After a successful transaction commit, the existing `sandboxRedisStore.resetStore` runs (already
   correct). If the transaction aborts, the snapshot is preserved (already correct) — now the
   preserved snapshot is the *same* object that was attempted, which is what we want.

**Acceptance**:
- `sandboxRedisStore.get` is called exactly once per merge (was two).
- Integration test: kick off a merge; mid-transaction it sees the pre-merge snapshot, not whatever
  Redis currently holds (assertable by stubbing `sandboxStore.get` to return a mutating object and
  asserting the merge used the original value).

**Status**: `-`

---

## P2 — Robustness & data integrity

### D1 Validate LLM JSON output with per-persona schemas (zod)

**Files**: `src/agent/personas/drafter.ts`, `src/agent/personas/evaluator.ts`,
`src/agent/helper/jsonParse.ts` (or a new `src/agent/helper/validate.ts`).

**Problem**: `safeJSON<any>` returns unvalidated objects. The Drafter then does
`llmAnalysis.stage === "STAGE_1"` against a free-form LLM string enum and trusts
`llmAnalysis.requirements.fields[].type` as a number. A hallucinated `type: 99` slips past the
Drafter and only gets caught later at the Planner's `validateToolParams` — wasting a turn. The
contract between persona prompts and the consuming code is implicit.

**Change**:
1. Add `zod` to `package.json` (already present in many Next stacks — check first).
2. Define schemas:
   - `DrafterOutputSchema`: `{ stage: z.enum(["STAGE_1","STAGE_2","STAGE_3"]), skill: z.enum([...7 skills]), title, isVague, isFollowUp, isFollowUpConfirmed, followUpTicketId, isCancellation, isTopicChange, guideResponse, clarifyingQuestion, requirements: { formTitle, fields: { label, type: z.union([z.literal(1)...z.literal(5)]), required, options }[] } }`. Make all soft-optional fields `.optional().default(undefined)` so a missing field doesn't throw — a *wrong* field does.
   - `EvaluatorOutputSchema`: `{ thoughtProcess, isComplete, shouldRetry, feedback }` (all the LLM is allowed to say).
3. Replace `safeJSON<any>(rawContent)` with `parsePersona<DrafterOutput>(rawContent, DrafterOutputSchema)`:
   - On parse failure (wrong enum, missing required key, type-99 field) → return the existing
     "I had trouble parsing — could you rephrase?" branch (Drafter already does this on a `null`
     parse). So validation failure is *not* a regression — it's a cleaner trigger of an existing
     safe fallback.
4. The Planner doesn't need this (function-calling output is structured by the API).

**Acceptance**:
- An LLM returning `{ "stage":"STAGE_99", "skill":"build_form" }` is caught at the Drafter (no longer
  proceeds to the Planner as if `stage` were ignored).
- An LLM returning `{ ..., "fields":[{"label":"Email","type":99}] }` triggers the Drafter's vague
  branch instead of reaching the Planner's param validator.
- `z.enum` mismatches surface in the trace's `llmRawOutput` so debugging is easier.

**Status**: `-`

---

### D2 Make Redis↔Mongo persistence order consistent and Mongo-authoritative

**File**: `src/agent/agentLoop.ts` (`persistStateToRedis`, `markResolved`).

**Problem**: `persistStateToRedis` writes Redis first, then Mongo. If the Mongo write fails after
Redis succeeds, the stores disagree; on resume, Redis wins and the Mongo ticket is stuck
`PROCESSING`. `markResolved` writes Mongo first then `clearState` Redis — the opposite order. Two
helpers, two orders, one class of split-brain bugs.

**Change**:
1. Standardize on **Mongo-first, then Redis** in both helpers (Mongo is the durable source of
   truth; Redis is the fast resume cache).
2. In `persistStateToRedis`: swap the calls — `findOneAndUpdate` Mongo first, then `agentRedis.saveState`.
   If the Mongo write throws, Redis is never updated and the throw propagates (good — the loop's
   `handleFailure` will mark `LLM_ERROR` consistently across both stores).
3. In `markResolved`: it's already Mongo-first-then-`clearState` — confirm and leave. Document the
   invariant in a comment on both helpers: "Mongo is authoritative; Redis is a resume cache."
4. (Optional hardening) If the Redis write throws after Mongo succeeds in `persistStateToRedis`,
   log a warning but don't fail the loop — Mongo already has the state, the stale Redis copy will be
   overwritten on the next `persistStateToRedis` or ignored on resume (Mongo is checked second and
   wins on schema mismatch via `normalizeSandboxStore`).

**Acceptance**:
- A fault-injected Mongo failure during `persistStateToRedis` (e.g. force `findOneAndUpdate` to
  throw) leaves the Mongo ticket absent/`PROCESSING` AND Redis un-updated — not the current
  Redis-updated-but-Mongo-absent split.
- Comments in both helpers document the ordering rule.

**Status**: `-`

---

### D3 Persist sandbox/trace to Mongo only at key transitions, not every persona turn

**File**: `src/agent/agentLoop.ts` (`persistStateToRedis`).

**Problem**: Every persona transition calls `persistStateToRedis`, which does Redis `set` *and*
`AgentTicketModel.findOneAndUpdate(... { ...state } ...)`. The `AgentTicket` doc therefore stores
the full `executionTrace` (capped 50 × payload 4 KB = up to ~200 KB) *and* the full `sandbox`
snapshot on every transition. The collection grows fast with no TTL. Redis already has the trace;
Mongo only needs the recoverable resume state — not the high-churn intermediate snapshots.

**Change**:
1. Split persistence: keep Redis `saveState` on every transition (it's the live resume cache + UI
   stream source); throttle Mongo writes to **key transitions only**:
   - `DRAFTER` → first persistence (initial ticket record).
   - `AWAITING_USER_APPROVAL` (the durable "come back later and merge" state).
   - `LLM_ERROR` / `REJECTED` (durable failure record for resume).
   - `RESOLVED` (via `markResolved` — already correct).
   - Skipping `EXECUTOR_SANDBOX` and `EVALUATOR` intermediate Mongo writes is the point — those
     are high-churn and recoverable from Redis.
2. Implement with a `shouldPersistToMongo(persona)` predicate. On the throttled transitions, also
   store a *compressed* version of the trace (e.g. only `stepId`, `persona`, `message`, no
   `payload`) — full payload stays in Redis. This matches the resume path which already pulls
   trace from Redis first and only falls back to Mongo's reduced copy.
3. Add a TTL index on `AgentTicketModel`: `createdAt` with `expireAfterSeconds: 30 * 24 * 3600`
   (30 days) for non-`RESOLVED`/non-`AWAITING_USER_APPROVAL` tickets. Keep `RESOLVED` and
   `AWAITING_USER_APPROVAL` indefinitely (or with a longer TTL) so users can resume. If the model
   doesn't support partial TTLs, add a separate `expiresAt` field set only on transient tickets
   and indexed with `{ expireAfterSeconds: 0 }` partial-filter style. (Confirm Mongoose support;
   simplest is a scheduled cleanup job if partial TTL is unavailable — note as a sub-task.)

**Acceptance**:
- A normal form-build run produces **at most 2** Mongo writes for the `AgentTicket` (init +
  `AWAITING_USER_APPROVAL`), down from ~5 (one per persona pass).
- Redis still gets every transition (UI stream unaffected).
- Trace payloads live in Mongo only at the durable transitions; intermediate Mongo docs lack the
  heavy `payload` blobs.
- `AgentTicket` count for a 100-turn load test grows at half the previous rate.

**Status**: `-`

---

### P2-4 Add a per-user rate limit on `/api/agent/execute`

**File**: `src/app/api/agent/execute/route.ts` (or a new `src/lib/agentRateLimit.ts`).

**Problem**: The SSE endpoint authenticates a user (cookie token OR next-auth session) and streams
up to ~15 upstream LLM calls per request (3 iterations × up to 5 persona calls).
`LLMRateLimitError` handles the downstream 429, but nothing prevents a single authenticated user
from hammering this endpoint and exhausting the NVIDIA/Gemini quota for everyone.

**Change**:
1. Add a Redis token bucket keyed by `userId` (reuse `agentRedis.client`). Allow e.g.
   `AGENT_RATE_LIMIT_PER_MIN = 10` agent-loop starts per user per minute (configurable via env).
2. In `execute/route.ts` `GET`, before starting the stream: `INCR agent:ratelimit:{userId}` with
   `EXPIRE 60` (sliding). If the value > limit → return `429 { error: "Too many agent requests,
   please slow down." }` *before* opening the SSE stream (so the frontend can show a toast, not a
   silent stream-abort).
3. Don't count `mergeApproved` resumes against the limit (they're cheap) — or give them a separate,
   higher bucket.
4. Optional: a daily cap (bucket size in seconds = 86400) for runaway prevention.

**Acceptance**:
- 11th request in a minute from the same user returns 429 (before any LLM call is made).
- A normal interactive cadence (~1 prompt / 10s) never hits the limit.
- The limit is configurable without a deploy (`AGENT_RATE_LIMIT_PER_MIN` env).

**Status**: `-`

---

### P2-5 Broaden PII redaction to response-body fields

**File**: `src/agent/personas/evaluator.ts` and `src/agent/personas/communicator.ts` (the shared
`redactPII` helper — extract to `src/agent/helper/redact.ts`).

**Problem**: `redactPII` only strips `ip_address` and `user_agent`. `run_database_query` on
`Response` returns the full `data` object (user-submitted form answers, which may contain emails,
phones, names). Those flow into the Evaluator/Communicator prompts unredacted. The redactor is
narrowly scoped to metadata, not the actual user-content payload.

**Change**:
1. Move `redactPII` to `src/agent/helper/redact.ts` and share it across both personas (currently
   duplicated — delete the copies).
2. Extend the redaction key list with named-PII fields commonly submitted in forms: `email`,
   `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`, `zip`, `postcode`. Map them to
   `"[redacted]"`. This is conservative (subset matching) — it won't catch a field literally named
   `"User Email Address"` unless the key exactly matches. Document this limitation: this is a
   *best-effort, key-name-based* redactor, not full PII classification.
3. Optional: regex-based value redaction for email/phone *values* (not just keys) inside
   `data.*` string values. This is more aggressive and catches "Please email me at x@y.com" in a
   free-text field, but risks false positives in legitimate content — gate behind an env flag
   `AGENT_REDACT_VALUES=1` default off. (If you skip this, the key-based redactor still strictly
   improves on today.)
4. Add a unit test covering each redacted key and a passthrough for unknown keys.

**Acceptance**:
- Evaluator/Communicator prompts no longer contain `data.email` or `data.phone` plaintext from
  `Response` query results (replaced with `"[redacted]"`).
- Unknown keys pass through (e.g. `data.feedback`) so functional content is preserved.
- The two `redactPII` copies are replaced by one shared module.

**Status**: `-`

---

### P2-6 Wire `LLMOfflineError` handling into the Communicator

**File**: `src/agent/personas/communicator.ts`.

**Problem**: `runCommunicator`'s `catch` is generic — it returns "I encountered an error while
generating a final response" but still preserves `state.isComplete` from the Evaluator. So a user
can see a success-flagged reply with an error message, and the ticket stays RESOLVED even though the
final step failed. The Drafter and Evaluator handle `LLMOfflineError` explicitly; the Communicator
doesn't.

**Change**:
1. In the `catch`, distinguish `err instanceof LLMOfflineError`: set `state.ticket.status =
   "LLM_ERROR"`, return the offline reply ("AI is offline right now. You can resume this ticket
   when the service is back."), and clear `isComplete` so the loop's post-Communicator persistence
   keeps the ticket alive for resume.
2. For other errors (parse, generic): keep the current message but also clear `isComplete` and set
   `status: "LLM_ERROR"` so the ticket reflects reality (a failed final reply, not a clean success).
3. Have `agentLoop`'s post-Communicator branch check `state.ticket.status === "LLM_ERROR"` and call
   `persistStateToRedis` (not `markResolved`) in that case so the user can resume.

**Acceptance**:
- A Communicator LLM outage (simulate via `LLMOfflineError` stub) → reply says offline, ticket is
  `LLM_ERROR` and resumable, NOT marked complete.
- A normal Communicator success → `RESOLVED` path unchanged.

**Status**: `-`

---

### P2-7 Add a secret-scan CI gate

**File**: `.github/workflows/secret-scan.yml` (new); possibly `.gitignore` for local.

**Problem**: A literal key landed in `llmHealthMonitor.ts` and shipped to the repo. Without a
scanner, the next one will too. This is the CI follow-up from P0-1.

**Change**:
1. Add a `trufflesecurity/trufflehog` or `gitleaks` GitHub Action step on PR + push:
   ```yaml
   - uses: gitleaks/gitleaks-action@v2
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```
2. Pin a rule that matches `nvapi-` and any common provider key patterns.
3. Add it to the repo's required checks (out of band).

**Acceptance**:
- A PR adding a line `const k = "nvapi-abc..."` is blocked by CI.

**Status**: `-`

---

## P3 — Maintainability & DX

### M2 Replace `state!` non-null assertions with the `activeState` alias

**File**: `src/agent/agentLoop.ts`.

**Problem**: After the explicit `const activeState: AgentState = state;` alias, the loop still uses
`state!` ~25 times (`state!.activePersona`, `state!.ticket`, etc.). The alias exists precisely to
avoid these, so the `!` are leftovers that defeat both the alias's purpose and TypeScript's null
safety in the while-loop body.

**Change**:
1. Replace every `state!` reference inside the `while (isLooping)` block and below with `state`
   (which is now `activeState: AgentState`, non-nullable). Delete the now-unused `activeState`
   alias OR keep `state` typed as `AgentState` via the alias and drop `!`.
2. Keep `state: AgentState | null = null` at the top (it's genuinely nullable between resume init
   and the alias point) — only the post-alias code changes.
3. Run `tsc --noEmit` to confirm no new type errors.

**Acceptance**:
- `grep -c "state!" src/agent/agentLoop.ts` reports 0 (or only those in the genuinely-nullable
  region before the alias, if any remain by necessity).
- `tsc --noEmit` passes.

**Status**: `-`

---

### M3 Fix the `sandboxStore` façade signature drift

**File**: `src/agent/sandbox/sandboxStore.ts`.

**Problem**: The façade `saveUpdateIntention` / `saveDeleteIntention` omit the `idempotencyKey` and
`expectedUpdatedAt` params that the real Redis store and the Executor pass. The Executor already
calls `sandboxRedisStore` directly, but anyone using the façade silently loses idempotency + optimistic
concurrency — a correctness downgrade hiding behind a "back-compat" interface.

**Change** (pick one):
- **Option A (recommended)**: Delete the `sandboxStore` façade entirely. Update the (few) callers
  to use `sandboxRedisStore` directly. Keep the deprecated `getStore` for one cycle? No — delete it
  too; it returns an empty store and is a trap.
- **Option B (if deletion is too disruptive)**: Fix the signatures to forward all params including
  `idempotencyKey?` and `expectedUpdatedAt?`. Remove the `@deprecated getStore` (or make it throw).

**Acceptance**:
- No code path can save an update/delete intention without an `idempotencyKey`.
- `grep -rn "sandboxStore\." src/` shows either no usage (Option A) or only fully-parameterized
  calls (Option B).
- `sandboxStore.getStore` (the always-empty sync accessor) is gone.

**Status**: `-`

---

### M4 Standardize merge-stats return typing

**File**: `src/agent/sandbox/sandboxStore.ts` (`mergeToProduction` signature),
`src/agent/sandbox/sandboxMerge.ts` (export type), `src/agent/agentLoop.ts` (consumption).

**Problem**: `sandboxStore.mergeToProduction` declares `Promise<{ mergedForms: number; mergedViews: number }>`
but returns `{ mergedForms, mergedViews, updatesApplied, deletesApplied }`. agentLoop only reads
two keys. The interface lies; the richer return is silently discarded. (P0-3 / R1 above already
make `agentLoop` consume the full stats — this task makes the type honest about it.)

**Change** depends on R1:
1. After R1 lands, `agentLoop` reads `updatesMissed`/`deletesMissed` too. Export a single
   `MergeStats` interface from `sandboxMerge.ts` and make `sandboxStore.mergeToProduction` return
   `Promise<MergeStats>`.
2. Import `MergeStats` in `agentLoop.ts` rather than redeclaring inline.

**Acceptance**:
- `sandboxStore.mergeToProduction` return type matches its actual return.
- `agentLoop` consumes all four+ counters (via R1) with correct types; `tsc` clean.

**Status**: `-`

---

### M5 Make `getAuthUserId` failure observable

**File**: `src/app/api/agent/execute/route.ts`.

**Problem**: `getAuthUserId` swallows JWT verification errors silently (`catch (err) {}`) and falls
through to the next-auth session lookup. Intentional fallback, but a *tampered* token looks
identical to "no token" — there's no signal that an invalid token was presented. Observability gap.

**Change**:
1. In the `catch`, log a structured warning (not the token) — e.g.
   `console.warn("[agent] JWT verification failed", err?.name, err?.message)`. Do NOT throw or
   change behavior; this is purely observability.
2. Similarly, if both token and session paths return null, log `[agent] no auth identity resolved`
   before returning the 401.
3. (Optional) Wire to the refactor plan's Phase 2 pino logging when that lands.

**Acceptance**:
- A request with a tampered JWT produces a server log line; the response is still 401 (unchanged).
- A request with no token + no session produces a distinct log line.

**Status**: `-`

---

## Sequencing & dependencies

```
[P0-1] secret ──► [P2-7] secret-scan CI   (do P0-1 first so the scanner has a clean baseline)
[P0-2] cross-tenant intersect              (independent)
[P0-3] global sim-offline removal          (independent)
[R2]  delete prod-write branches           (independent; verify no caller first)
[E1]  Evaluator retry target               (independent)
[M1]  snapshot-before-transaction          (independent)
[R1]  surface merge no-ops ──► [M4] type honesty   (R1 first)
[D1]  zod persona schemas                  (independent)
[D2]  Redis/Mongo persistence order         (independent)
[D3]  throttle Mongo writes + TTL          (independent; light integration with D2)
[P2-4] per-user rate limit                 (independent)
[P2-5] PII redaction broaden               (independent)
[P2-6] Communicator LLMOfflineError        (independent)
[M2]  state! cleanup                       (independent; pure refactor)
[M3]  drop sandboxStore façade             (independent)
[M5]  getAuthUserId observability          (independent)
```

**Suggested order (1-2 engineers, ~2 weeks):**
1. **Week 1**: P0-1, P0-2, P0-3, R2, E1 (clear all P0 + the cheapest P1 correctness items).
2. **Week 1 end / Week 2**: R1 → M4, M1, P2-6 (integrity + honesty).
3. **Week 2**: D1, D2, D3 (robustness), then P2-5, P2-4, P2-7, M2, M3, M5.

All items are independently shippable, individually revertable, and have a unit/integration test.
None require the WebSocket migration, eval harness, or prompt versioning from
`AGENT_REFACTOR_PLAN.md` — but several remove blockers that would otherwise make those phases land
on top of latent bugs (see "Relationship to AGENT_REFACTOR_PLAN.md" at top).

---

## Test strategy (no new infra required)

Where a task above says "unit/integration test", use the existing project conventions. If none
exist yet, the *minimal* harness this plan requires:

- `tests/agent/agentTools.test.ts` — stub Mongoose models with an in-memory record set; assert
  `run_database_query` tenant isolation + identity resolution (covers P0-2, R2).
- `tests/agent/sandboxMerge.test.ts` — stub `sandboxRedisStore` + `Form`/`CustomView`/`AgentAuditEvent`
  with a fake session; assert idempotent re-merge, optimistic-concurrency miss, snapshot-before-txn
  (M1, R1).
- `tests/agent/evaluator.test.ts` — call `runEvaluator` with an injected fake `retryLLM`; assert
  retry routes to `EXECUTOR_SANDBOX` not `PLANNER` (E1), LLMOfflineError → LLM_ERROR (P2-6 overlap).
- `tests/agent/redact.test.ts` — assert redaction of named keys (P2-5).

Do *not* build the full golden-set CI harness from the refactor plan's Phase 0.3/6 — that's a larger,
separate investment. These tests prove the specific behavior changes in this plan and nothing more.

---

## Definition of Done (this plan)

- [ ] All P0 items: no `nvapi-` in source; `Form`/`CustomView` intersect operative for both id
      shapes; global sim-offline path removed.
- [ ] All P1 items: merge no-ops surface to user; `executeAgentTool` cannot mutate prod; Evaluator
      retry target aligned to one contract; merge snapshot is pre-transaction.
- [ ] P2 items: zod validation on Drafter/Evaluator output; Mongo-first persistence; throttled
      Mongo writes + TTL; per-user rate limit; broader PII redaction; Communicator offline handling;
      secret-scan CI.
- [ ] P3 items: no `state!` post-alias; no drifted `sandboxStore` façade; honest `MergeStats` type;
      `getAuthUserId` failures observable.
- [ ] `tsc --noEmit` clean. `npm run lint` clean. New tests green.
- [ ] `Agent.md` "Remodel notes" section matches the code (specifically the Evaluator-retry bullet
      updated per E1, and the simulated-offline bullet updated per P0-3).
- [ ] No new runtime dependencies except `zod` (verify it isn't already a transitive dep first).
      Nothing from the refactor plan's `ws`/`pino`/`prom-client` is required by this plan.

---

## Out of scope (explicitly deferred to AGENT_REFACTOR_PLAN.md)

The following were *identified* in the architecture review but are deliberately left to the larger
refactor because they need new infrastructure, not just code hygiene:

- WebSocket transport + token streaming (refactor Phase 3)
- Token-cost tracking + per-user daily budget UI (refactor Phase 2 + 8)
- Parallel read path / Drafter short-circuit (refactor Phase 1) — note: this *could* be a cheap
  win done now, but it amplifies any read-path bug, so P0-2/R2 should land first
- Multi-turn `conversationHistory` (refactor Phase 5)
- Full golden-set evaluation harness + nightly drift (refactor Phase 6)
- Prompt versioning + A/B (refactor Phase 7)
- Lock read/write separation (refactor Phase 4) — needs the parallel read path from Phase 1

This plan closes the correctness/security/integrity holes the refactor will sit on top of.
