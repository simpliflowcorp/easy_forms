# Easy Forms Agent — Implementation Plan

This document consolidates the two planning artifacts in `updates/` into a single, sequenced,
execution-ready implementation plan:

- **`updates/AGENT_REFACTOR_PLAN.md`** — the aspirational 16-week refactor (WebSocket transport,
  token/cost tracking, eval harness, prompt versioning, conversation state, etc.).
- **`updates/AGent_refactor_plan.md`** — the execution-ready correctness/security/integrity fixes
  (P0–P3) that must land *before* or *alongside* the larger refactor, because the refactor builds
  on top of the read path, merge path, and auth path that those fixes repair.

**Why both in one place**: the refactor plan's Phase 1 (read shortcut) accelerates the read path —
but `AGent_refactor_plan.md` items **P0-2** and **R2** show that read path has a cross-tenant
intersect bug and dead production-write branches. Shipping Phase 1 first would amplify a latent
bug. Similarly, refactor Phase 0.1 (replica-set verification) is a prerequisite for the merge
transaction in **M1** to be safe. The two plans are interlocked; this document makes the
dependency explicit and gives a single critical path.

---

## Guiding principles

1. **Fix the bugs that exist today before accelerating the system that runs them.** All P0/P1
   hardening lands first (or in lockstep with refactor Phase 0/1).
2. **Every task names exact file(s), the precise change, why, and a verifiable acceptance test.**
   No task depends on infrastructure that doesn't exist yet unless explicitly noted
   (refactor phases 2/3/4/6/7/8 are infra-heavy; P0–P3 are pure code hygiene).
3. **Independently shippable, individually revertable.** Each task has a unit/integration test
   and no cross-task coupling except where called out.
4. **Mongo is authoritative; Redis is a resume cache.** Persistence ordering, snapshot capture,
   and resume all follow this invariant once D2/M1 land.

---

## Priority legend

- **P0** — ship-stopper: cross-tenant vector, secret in source, or silent data loss. Do first.
- **P1** — correctness: the system lies or silently misbehaves. Do next.
- **P2** — robustness/data integrity + refactor-readiness infra.
- **P3** — maintainability / DX.
- **R0–R10** — refactor phases (R0 = foundation, R1 = read shortcut, R2 = cost tracking, …).

Status: `-` not started · `~` in progress · `x` done · `!` blocked.

---

# Part A — Hardening (execute first, ~Week 1–2)

This part is the "before the refactor" work. None of it requires new runtime infrastructure
(no `ws`, no `pino`, no `prom-client`, no eval harness). The only optional new dep is `zod` (verify
it isn't already transitive before adding). Estimated effort: **P0+P1 ≈ 1 engineering week; all of
Part A ≈ 2–2.5 weeks** with 1–2 engineers.

## P0 — Ship-stoppers (in order)

### P0-1 Remove the committed API key from `llmHealthMonitor.ts`
- **File**: `src/lib/llmHealthMonitor.ts` (~lines 22–23)
- **Problem**: A literal NVIDIA key (`nvapi-...`) is committed as a fallback — a credential in VCS.
- **Change**:
  1. Delete the inline fallback. Use `const apiKey = process.env.NVIDIA_API_KEY;` and fail closed
     (set status `"unknown"`, short-circuit, no outbound fetch) when missing — not fakely `"online"`.
  2. Rotate the exposed key out-of-band (NVIDIA console). Not a code task, but a required follow-up.
  3. Ensure `.env.example` has `NVIDIA_API_KEY=` (no value).
  4. Grep guard: `grep -rn "nvapi-" src/` returns nothing. (CI gate lands in **P2-7**.)
- **Acceptance**: With `NVIDIA_API_KEY` unset, `GET /api/agent/health-stream` emits
  `{ status: "unknown" }` and no fetch is attempted; `grep -rn "nvapi-" src/` empty.
- **Status**: `-`

### P0-2 Fix the `Form` / `CustomView` `form_id` intersect guard in `run_database_query`
- **File**: `src/lib/agentTools.ts` (~lines 144–152)
- **Problem**: The `Response` branch intersect is correct (`Response.form_id` stores Mongo `_id`),
  but the `Form`/`CustomView` branch collects Mongo `_id`s then compares against `query.form_id`
  via `$eq`. If the caller passes the *hashed* `formId` string, the `$eq` never matches — the guard
  is dead weight, silently returns empty for legit requests, and doesn't defend against forged `_id`s.
- **Change**:
  1. Add one helper `resolveFormIdFilter(userId, queryFormId)` that:
     - if `queryFormId` is a valid ObjectId → collects user's form `_id`s; returns
       `{ $in: ids, $eq: new ObjectId(queryFormId) }`.
     - else (hashed `formId` string) → collects user's hashed `formId`s; returns
       `{ $in: hashedIds, $eq: queryFormId }`.
     - if absent → `{ $in: allUserFormIds }` (current behavior preserved).
  2. Apply the resolved filter to whichever field the target collection uses
     (`Response.form_id` = Mongo `_id`; `Form` filters by `_id` OR `formId`). Keep
     `secureQuery.user = userId`.
  3. Share the helper across all three branches; delete the duplicated `Form.find(...).select("_id")`.
- **Acceptance**: Unit test matrix (user A owns `{_id:"a1", formId:"hashA"}`, B owns `{_id:"b1"}`):
  A queries `Form` with `form_id="b1"` → `[]`; with `"hashA"` → A's form (was `[]`); with `"a1"` →
  A's form. Same matrix for `Response`. User-form lookup runs once per request, not 2×.
- **Status**: `-`

### P0-3 Remove the global `agent:simulated_offline` honoring path
- **Files**: `src/agent/agentLoop.ts` (legacy global-key read at the while-loop top);
  `src/app/api/agent/simulate-offline/route.ts` (legacy global toggling branch)
- **Problem**: Per-ticket offline simulation exists
  (`agent:simulated_offline:<ticketId>`), but the loop still honors the *global* key with only a
  deprecation warning. A stale global key silently crashes *every* agent invocation deployment-wide.
- **Change**:
  1. Delete the global-key read block in `agentLoop.ts`; keep only the per-ticket check; drop the
     `console.warn`.
  2. In `simulate-offline/route.ts`, delete the global `else` branch; require `ticketId` in the body
     → 400 `{ error: "ticketId required" }` if absent.
  3. Update `Agent.md` "Simulated offline" section to drop the global-key back-compat sentence.
- **Acceptance**: Setting global `agent:simulated_offline` `"true"` affects no ticket; per-ticket key
  crashes only that ticket; `POST /api/agent/simulate-offline` without `ticketId` → 400; no bare
  `agent:simulated_offline` reference remains in `src/`.
- **Status**: `-`

## P1 — Correctness: stop the system from lying

### P1-R1 Surface merge optimistic-concurrency / no-op failures to the user
- **Files**: `src/agent/sandbox/sandboxMerge.ts`; `src/agent/agentLoop.ts` (`mergeApproved` branch);
  personas/communicator or a new helper
- **Problem**: `mergeSandboxToProduction` *computes* `updatesApplied`/`deletesApplied` but
  `agentLoop` only reads `mergedForms`/`mergedViews` and always claims success. A form edited
  elsewhere between snapshot and merge → `matchedCount === 0` silently dropped; user sees success.
- **Change**:
  1. Type the return as `{ mergedForms, mergedViews, updatesApplied, updatesMissed,
     deletesApplied, deletesMissed }`; compute `*Missed` from queued counts − applied.
  2. In the `mergeApproved` branch, if `updatesMissed + deletesMissed > 0` set `state.reply` to a
     warning ("N change(s) couldn't be applied because the form was modified elsewhere after you
     previewed it. Please re-open the form and try again.").
  3. Still mark `RESOLVED` (successful parts committed) but include the warning.
  4. (Optional) Write an `AgentAuditEvent` row per *missed* update/delete with
     `outcome: "concurrency_miss"`.
- **Acceptance**: Concurrent-edit-then-merge → reply contains the warning and audit has a
  `concurrency_miss` row; clean-path merge unchanged.
- **Status**: `-`

### P1-R2 Delete the production-write branches from `executeAgentTool`
- **File**: `src/lib/agentTools.ts` (`create_form`/`update_form`/`delete_form` switch cases,
  ~lines 8–72)
- **Problem**: The Executor never calls these for mutations (it queues into the sandbox), but the
  prod-write code still exists and uses the legacy `$or:[{ formId }, { _id }]` lookup. Any future
  caller bypasses the sandbox + idempotency-key + transaction safety. Dead prod-write code is a
  latent footgun contradicting guardrail #2.
- **Change**:
  1. Remove the three cases; throw a clear error for them
     (`${tool} must go through the sandbox → mergeSandboxToProduction path, not executeAgentTool.`).
  2. Optionally rename to `executeReadTool` (alias `executeReadTool as executeAgentTool` for
     back-compat); relocate file to `readTools.ts` optional.
  3. Only read-only cases remain (`run_database_query`; confirm `query_responses` /
     `generate_analytics` / custom-view reads routed here are read-only).
  4. Grep callers of `executeAgentTool("create_form" ...)`; rewrite any to the sandbox path.
- **Acceptance**: `grep -rn 'executeAgentTool("(create|update|delete)_form"' src/` → none; calling
  `create_form` throws the explicit error; golden read prompts return unchanged results.
- **Status**: `-`

### P1-E1 Reconcile the Evaluator retry target with its documented behavior
- **Files**: `src/agent/personas/evaluator.ts` (two `activePersona:"PLANNER"` retry returns ~L55,
  ~L147); `src/agent/Agent.md`
- **Problem**: Evaluator comments say failed-action retries route to `EXECUTOR_SANDBOX`, but code
  sets `activePersona: "PLANNER"` in both the deterministic-precheck retry and the LLM-QA
  `shouldRetry` branch. This contradicts the docstring, costs a Planner LLM call per retry, and lets
  the Planner re-compile a *different* plan with no knowledge of the existing sandbox draft
  (divergence risk).
- **Change**: Pick one model and apply to both paths; make docs agree. Recommended (matches
  `Agent.md`, cheaper):
  1. **Deterministic-precheck retry**: set `activePersona: "EXECUTOR_SANDBOX"`, re-run the same failed
     action with same params + `evaluatorFeedback` (Executor already consumes feedback per-action).
     Zero extra LLM calls.
  2. **LLM-QA `shouldRetry`**: set `activePersona: "EXECUTOR_SANDBOX"` with `evaluatorFeedback`
     describing what the LLM judged wrong; re-run the existing plan (`state.actionPlan`) with the
     feedback as breadcrumb. Only re-engage Planner on an explicit `[replan]` sentinel
     (`state.replanRequested` flag) — optional refinement to keep the task small.
  3. Update `Agent.md` "Evaluator" bullet to state the final contract: "Both deterministic and
     LLM-driven retries route to EXECUTOR_SANDBOX with prior plan + feedback intact. Planner is
     re-engaged only on a fresh ticket (post-Drafter) or an explicit `[replan]` signal."
  4. Remove the misleading "NOT Planner per Agent.md:100-119" inline comment.
- **Acceptance**: Retry trace shows `EVALUATOR → EXECUTOR_SANDBOX`, not `→ PLANNER`; one retry costs
  no extra Planner call; `Agent.md` no longer contradicts `evaluator.ts`; golden test: a
  once-failing-then-succeeding action completes in one extra Executor pass with no Planner call
  between.
- **Status**: `-`

### P1-M1 Capture the sandbox snapshot before the merge transaction
- **File**: `src/agent/sandbox/sandboxMerge.ts`
- **Problem**: `mergeFormsAndIntents` and `mergeViews` each call `sandboxRedisStore.get(...)`
  *inside* `session.withTransaction`. The per-user write lock makes same-user concurrency safe, but
  capturing the snapshot outside the transaction is clearer, avoids any drift from a concurrent
  sandbox write mid-transaction, and removes a Redis round-trip from the critical section.
- **Change**:
  1. Read the sandbox once before `session.withTransaction`:
     `const snapshot = await sandboxRedisStore.get(userId, ticketId);`
  2. Pass `snapshot` into `mergeFormsAndIntents(userId, ticketId, snapshot, session, stats)` and
     `mergeViews(...)`. Delete the in-function `get` calls.
  3. On commit, existing `resetStore` runs (correct). On abort, the preserved snapshot is the same
     object attempted (correct).
- **Acceptance**: `sandboxRedisStore.get` called exactly once per merge (was two); integration test
  stubs `sandboxStore.get` to return a mutating object and asserts the merge used the original value.
- **Status**: `-`

## P2 — Robustness & data integrity

### P2-D1 Validate LLM JSON output with per-persona schemas (zod)
- **Files**: `src/agent/personas/drafter.ts`; `src/agent/personas/evaluator.ts`;
  `src/agent/helper/jsonParse.ts` (or new `src/agent/helper/validate.ts`)
- **Problem**: `safeJSON<any>` returns unvalidated objects. Drafter trusts
  `llmAnalysis.stage === "STAGE_1"` against a free-form enum and `requirements.fields[].type` as a
  number. A hallucinated `type: 99` slips past the Drafter and only fails at the Planner's
  `validateToolParams` — wasting a turn.
- **Change**:
  1. Add `zod` to `package.json` (check if already transitive first).
  2. Define `DrafterOutputSchema` (stage enum of the 3 stages; skill enum of 7 skills; title;
     isVague; isFollowUp; isFollowUpConfirmed; followUpTicketId; isCancellation; isTopicChange;
     guideResponse; clarifyingQuestion; requirements with formTitle and fields of
     `{ label, type: z.union([z.literal(1)..z.literal(5)]), required, options }[]}`). Soft-optional
     fields `.optional().default(undefined)` — a *missing* field doesn't throw, a *wrong* field does.
  3. Define `EvaluatorOutputSchema`: `{ thoughtProcess, isComplete, shouldRetry, feedback }`.
  4. Replace `safeJSON<any>(raw)` with `parsePersona<T>(raw, schema)`; on parse failure, route to
     the existing "I had trouble parsing — could you rephrase?" branch (Drafter already does this on
     a `null` parse) — validation failure is a cleaner trigger of an existing safe fallback.
  5. Planner needs no schema (function-calling output is structured by the API).
- **Acceptance**: LLM returning `{"stage":"STAGE_99",...}` caught at Drafter; `type:99` field
  triggers the Drafter's vague branch instead of reaching the Planner validator; enum mismatches
  surface in the trace's `llmRawOutput`.
- **Status**: `-`

### P2-D2 Make Redis↔Mongo persistence order consistent and Mongo-authoritative
- **File**: `src/agent/agentLoop.ts` (`persistStateToRedis`, `markResolved`)
- **Problem**: `persistStateToRedis` writes Redis first, then Mongo — if Mongo fails after Redis
  succeeds, stores disagree and on resume Redis wins (Mongo ticket stuck `PROCESSING`).
  `markResolved` does the opposite order (Mongo-first-then-`clearState`). Two helpers, two orders,
  one class of split-brain.
- **Change**:
  1. Standardize on **Mongo-first, then Redis** in both helpers.
  2. In `persistStateToRedis`: `findOneAndUpdate` Mongo first, then `agentRedis.saveState`. If Mongo
     throws, Redis is never updated and the throw propagates (loop's `handleFailure` marks
     `LLM_ERROR` consistently across both stores).
  3. In `markResolved`: already Mongo-first-then-`clearState` — confirm and leave. Add a comment to
     both: "Mongo is authoritative; Redis is a resume cache."
  4. (Optional) If Redis throws after Mongo succeeds in `persistStateToRedis`, log a warning but
     don't fail the loop — Mongo has the state; stale Redis gets overwritten on the next persist or
     ignored on resume (Mongo checked second and wins via `normalizeSandboxStore`).
- **Acceptance**: Fault-injected Mongo failure during `persistStateToRedis` leaves Mongo
  absent/`PROCESSING` AND Redis un-updated — not the current Redis-updated-but-Mongo-absent split;
  comments present on both helpers.
- **Status**: `-`

### P2-D3 Persist sandbox/trace to Mongo only at key transitions
- **File**: `src/agent/agentLoop.ts` (`persistStateToRedis`)
- **Problem**: Every persona transition does a Redis `set` AND `AgentTicketModel.findOneAndUpdate`
  with the full `executionTrace` (capped 50 × ~4 KB = up to ~200 KB) and full `sandbox` snapshot.
  The collection grows fast with no TTL. Redis already has the trace; Mongo only needs recoverable
  resume state.
- **Change**:
  1. Split persistence: keep Redis `saveState` on every transition (live resume cache + UI stream);
     throttle Mongo writes to key transitions only: `DRAFTER` (init record),
     `AWAITING_USER_APPROVAL` (durable "come back later"), `LLM_ERROR`/`REJECTED` (durable failure),
     `RESOLVED` (already via `markResolved`). Skip `EXECUTOR_SANDBOX`/`EVALUATOR` Mongo writes.
  2. Implement `shouldPersistToMongo(persona)`. On throttled transitions store a *compressed* trace
     (`stepId`, `persona`, `message` only — no `payload`); full payload stays in Redis. Matches the
     resume path which pulls trace from Redis first, falls back to Mongo's reduced copy.
  3. Add a TTL index on `AgentTicketModel.createdAt` with `expireAfterSeconds: 30*24*3600` (30 days)
     for transient tickets; keep `RESOLVED` and `AWAITING_USER_APPROVAL` indefinitely (or longer
     TTL). If partial TTL unsupported, use a separate `expiresAt` field indexed
     `{ expireAfterSeconds: 0 }` with a partial filter, or a scheduled cleanup job — note as
     sub-task.
- **Acceptance**: A normal form-build run produces ≤ 2 `AgentTicket` Mongo writes (init +
  `AWAITING_USER_APPROVAL`), down from ~5; Redis still gets every transition; intermediate Mongo docs
  lack heavy `payload` blobs; `AgentTicket` count for a 100-turn load test grows at half the rate.
- **Status**: `-`

### P2-4 Add a per-user rate limit on `/api/agent/execute`
- **Files**: `src/app/api/agent/execute/route.ts` (or new `src/lib/agentRateLimit.ts`)
- **Problem**: The SSE endpoint authenticates a user and streams up to ~15 upstream LLM calls per
  request (3 iterations × up to 5 persona calls). `LLMRateLimitError` handles downstream 429, but
  nothing stops a single user from exhausting NVIDIA/Gemini quota for everyone.
- **Change**:
  1. Redis token bucket keyed by `userId` (reuse `agentRedis.client`). Env
     `AGENT_RATE_LIMIT_PER_MIN` (default 10) agent-loop starts per user per minute.
  2. In `execute/route.ts` `GET`, before the stream: `INCR agent:ratelimit:{userId}` with `EXPIRE 60`.
     If value > limit → `429 { error: "Too many agent requests, please slow down." }` *before*
     opening the SSE stream.
  3. Don't count `mergeApproved` resumes against the limit (or give them a separate higher bucket).
  4. Optional daily cap (86400s bucket) for runaway prevention.
- **Acceptance**: 11th request in a minute from one user returns 429 (before any LLM call); normal
  cadence (~1 prompt/10s) never hits the limit; configurable via env without a deploy.
- **Status**: `-`

### P2-5 Broaden PII redaction to response-body fields
- **Files**: `src/agent/helper/redact.ts` (new, extracted); `src/agent/personas/evaluator.ts`;
  `src/agent/personas/communicator.ts`
- **Problem**: `redactPII` only strips `ip_address` and `user_agent`. `run_database_query` on
  `Response` returns the full `data` object (user-submitted answers, may contain emails/phones/
  names) into the Evaluator/Communicator prompts unredacted. The redactor is scoped to metadata, not
  the actual user-content payload — and is duplicated across two personas.
- **Change**:
  1. Move `redactPII` to `src/agent/helper/redact.ts`; share across both personas; delete copies.
  2. Extend keys with `email`, `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`,
     `zip`, `postcode` → `[redacted]`. Document this is *best-effort, key-name-based* redaction, not
     full PII classification (won't catch `"User Email Address"`).
  3. Optional: regex value redaction (email/phone *values*) inside `data.*` strings, gated behind
     `AGENT_REDACT_VALUES=1` (default off) to avoid false positives in legit content.
  4. Unit test each redacted key + passthrough for unknown keys.
- **Acceptance**: Evaluator/Communicator prompts no longer contain `data.email`/`data.phone`
  plaintext from `Response` queries; unknown keys (e.g. `data.feedback`) pass through; the two
  `redactPII` copies replaced by one shared module.
- **Status**: `-`

### P2-6 Wire `LLMOfflineError` handling into the Communicator
- **File**: `src/agent/personas/communicator.ts`
- **Problem**: `runCommunicator`'s `catch` is generic — returns "I encountered an error while
  generating a final response" but preserves `state.isComplete` from the Evaluator. A user can see a
  success-flagged reply with an error message and the ticket stays RESOLVED even though the final
  step failed. Drafter/Evaluator handle `LLMOfflineError` explicitly; Communicator doesn't.
- **Change**:
  1. In the `catch`, distinguish `err instanceof LLMOfflineError`: set `state.ticket.status =
     "LLM_ERROR"`, return the offline reply ("AI is offline right now. You can resume this ticket
     when the service is back."), clear `isComplete` so the loop's post-Communicator persistence
     keeps the ticket alive for resume.
  2. For other errors: keep the message but clear `isComplete` and set `status: "LLM_ERROR"` so the
     ticket reflects reality.
  3. Have `agentLoop`'s post-Communicator branch check `state.ticket.status === "LLM_ERROR"` and
     call `persistStateToRedis` (not `markResolved`) so the user can resume.
- **Acceptance`: A Communicator LLM outage (stub `LLMOfflineError`) → offline reply, ticket
  `LLM_ERROR` + resumable, not marked complete; normal success → `RESOLVED` unchanged.
- **Status**: `-`

### P2-7 Add a secret-scan CI gate
- **File**: `.github/workflows/secret-scan.yml` (new)
- **Problem**: A literal key landed in `llmHealthMonitor.ts` and shipped. Without a scanner the next
  one will too. This is the CI follow-up from **P0-1**.
- **Change**:
  1. Add `gitleaks/gitleaks-action@v2` (or `trufflesecurity/trufflehog`) on PR + push:
     ```yaml
     - uses: gitleaks/gitleaks-action@v2
       env:
         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     ```
  2. Pin a rule matching `nvapi-` and common provider patterns.
  3. Add to required checks (out of band). Do **P0-1** first so the scanner has a clean baseline.
- **Acceptance`: A PR adding `const k = "nvapi-abc..."` is blocked by CI.
- **Status**: `-`

## P3 — Maintainability & DX

### P3-M2 Replace `state!` non-null assertions with the `activeState` alias
- **File**: `src/agent/agentLoop.ts`
- **Problem**: After `const activeState: AgentState = state;` the loop still uses `state!` ~25×. The
  alias exists to avoid these; the `!` leftovers defeat it and TypeScript null safety.
- **Change**: Replace every `state!` inside the `while (isLooping)` block with `state` (now
  `activeState: AgentState`, non-nullable). Keep `state: AgentState | null = null` at the top
  (genuinely nullable before the alias). Run `tsc --noEmit`.
- **Acceptance**: `grep -c "state!" src/agent/agentLoop.ts` is 0 (or only pre-alias); `tsc --noEmit`
  passes.
- **Status**: `-`

### P3-M3 Fix the `sandboxStore` façade signature drift
- **File**: `src/agent/sandbox/sandboxStore.ts`
- **Problem**: The façade `saveUpdateIntention`/`saveDeleteIntention` omit `idempotencyKey` and
  `expectedUpdatedAt` that the real Redis store and Executor pass. Callers using the façade silently
  lose idempotency + optimistic concurrency — a correctness downgrade hiding behind a "back-compat"
  interface. The deprecated `getStore` returns an always-empty store — a trap.
- **Change** (pick one):
  - **Option A (recommended)**: Delete the `sandboxStore` façade entirely; update the (few) callers
    to use `sandboxRedisStore` directly. Delete the deprecated `getStore` too.
  - **Option B**: Fix signatures to forward all params (`idempotencyKey?`, `expectedUpdatedAt?`);
    remove/throw on `getStore`.
- **Acceptance**: No code path can save an update/delete intention without an `idempotencyKey`;
  `grep -rn "sandboxStore\." src/` shows no usage (A) or only fully-parameterized calls (B);
  `getStore` gone.
- **Status**: `-`

### P3-M4 Standardize merge-stats return typing
- **Files**: `src/agent/sandbox/sandboxStore.ts` (`mergeToProduction` sig);
  `src/agent/sandbox/sandboxMerge.ts` (export type); `src/agent/agentLoop.ts` (consumption)
- **Problem**: `mergeToProduction` declares `Promise<{ mergedForms: number; mergedViews: number }>`
  but returns the richer stats. agentLoop reads two keys. The interface lies.
- **Change** (depends on P1-R1):
  1. Export a single `MergeStats` interface from `sandboxMerge.ts`; make
     `sandboxStore.mergeToProduction` return `Promise<MergeStats>`.
  2. Import `MergeStats` in `agentLoop.ts` rather than redeclaring.
- **Acceptance**: Return type matches actual return; agentLoop consumes all four+ counters (via R1)
  with correct types; `tsc` clean.
- **Status**: `-`

### P3-M5 Make `getAuthUserId` failure observable
- **File**: `src/app/api/agent/execute/route.ts`
- **Problem**: `getAuthUserId` swallows JWT verification errors silently (`catch (err) {}`) and falls
  through to next-auth session. A *tampered* token looks identical to "no token" — no signal that an
  invalid token was presented. Observability gap.
- **Change**:
  1. In the `catch`, log a structured warning (not the token): `console.warn("[agent] JWT
     verification failed", err?.name, err?.message)`. Do NOT throw or change behavior.
  2. If both paths return null, log `[agent] no auth identity resolved` before the 401.
  3. (Optional) Wire to pino logging when refactor R2-day lands.
- **Acceptance**: A tampered-JWT request produces a server log line + still 401; a no-token +
  no-session request produces a distinct log line.
- **Status**: `-`

---

## Part A — sequencing & dependencies

```
[P0-1] secret ──► [P2-7] secret-scan CI   (P0-1 first for a clean baseline)
[P0-2] cross-tenant intersect              (independent)
[P0-3] global sim-offline removal          (independent)
[P1-R2] delete prod-write branches          (independent; verify no caller first)
[P1-E1] Evaluator retry target              (independent)
[P1-M1] snapshot-before-transaction        (independent)
[P1-R1] surface merge no-ops ──► [P3-M4] type honesty   (R1 first)
[P2-D1] zod persona schemas                (independent)
[P2-D2] Redis/Mongo persistence order       (independent)
[P2-D3] throttle Mongo writes + TTL        (independent; light integration with D2)
[P2-4]  per-user rate limit                 (independent)
[P2-5]  PII redaction broaden               (independent)
[P2-6]  Communicator LLMOfflineError        (independent)
[P3-M2] state! cleanup                      (independent; pure refactor)
[P3-M3] drop sandboxStore façade           (independent)
[P3-M5] getAuthUserId observability        (independent)
```

### Suggested schedule (1–2 engineers, ~2 weeks)
1. **Week 1**: P0-1, P0-2, P0-3, P1-R2, P1-E1 (all P0 + cheapest P1 correctness).
2. **Week 1 end / Week 2 start**: P1-R1 → P3-M4, P1-M1, P2-6 (integrity + honesty).
3. **Week 2**: P2-D1, P2-D2, P2-D3 (robustness), then P2-5, P2-4, P2-7, P3-M2, P3-M3, P3-M5.

All Part A items are independently shippable, individually revertable, and have a unit/integration
test. None require WebSocket/eval-harness/prompt-versioning.

### Part A — test strategy (no new infra)

Reuse project conventions. Minimal harness this plan requires:
- `tests/agent/agentTools.test.ts` — stub Mongoose models in-memory; assert `run_database_query`
  tenant isolation + identity resolution (P0-2, P1-R2).
- `tests/agent/sandboxMerge.test.ts` — stub `sandboxRedisStore` + `Form`/`CustomView`/
  `AgentAuditEvent` with a fake session; assert idempotent re-merge, optimistic-concurrency miss,
  snapshot-before-txn (P1-M1, P1-R1).
- `tests/agent/evaluator.test.ts` — call `runEvaluator` with an injected fake `retryLLM`; assert
  retry routes to `EXECUTOR_SANDBOX` not `PLANNER` (P1-E1), `LLMOfflineError` → `LLM_ERROR`
  (P2-6 overlap).
- `tests/agent/redact.test.ts` — assert redaction of named keys (P2-5).

Do *not* build the full golden-set CI harness (that lands in refactor R6) — these tests prove the
specific Part A behavior changes only.

### Part A — Definition of Done

- [ ] **P0**: no `nvapi-` in source; `Form`/`CustomView` intersect operative for both id shapes;
      global sim-offline path removed.
- [ ] **P1**: merge no-ops surface to user; `executeAgentTool` cannot mutate prod; Evaluator retry
      target aligned to one contract; merge snapshot is pre-transaction.
- [ ] **P2**: zod validation on Drafter/Evaluator output; Mongo-first persistence; throttled Mongo
      writes + TTL; per-user rate limit; broader PII redaction; Communicator offline handling;
      secret-scan CI.
- [ ] **P3**: no `state!` post-alias; no drifted `sandboxStore` façade; honest `MergeStats` type;
      `getAuthUserId` failures observable.
- [ ] `tsc --noEmit` clean. `npm run lint` clean. New tests green.
- [ ] `Agent.md` "Remodel notes" matches code (Evaluator-retry bullet per E1; simulated-offline
      bullet per P0-3).
- [ ] No new runtime deps except `zod` (verify not already transitive). None of `ws`/`pino`/
      `prom-client` required by Part A.

---

# Part B — Refactor phases (after / parallel to Part A; ~16 weeks)

The hardening in Part A removes blockers the refactor would otherwise sit on. Part B phases assume
Part A's Definition of Done. Phases marked (P) can run in parallel.

Assumptions (from the dismissed clarifying questions in `AGENT_REFACTOR_PLAN.md`):
- Timeline **12–16 weeks**, 1–2 engineers.
- MongoDB **replica set available** (fallback documented for standalone).
- Transport **full WebSocket migration** with SSE fallback during transition.
- Evaluation **full CI eval harness** with golden prompts.
- Prompt versioning **JSON files + A/B switching** via feature flags.

| Phase | Weeks | Focus | Key Deliverable | Depends on |
|-------|-------|-------|-----------------|------------|
| R0 | 0.5 | Foundation & infra prep | Replica-set verified, WS scaffolded, eval CI pipeline | — |
| R1 | 2 | Parallel read path (P) | Drafter→Communicator shortcut for STAGE_1; 3 LLM calls cut for analytics | R0; **P0-2, P1-R2** |
| R2 | 2 | Token/cost tracking (P) | Per-ticket + per-user usage persisted; dashboard + budget guardrails | R0 |
| R3 | 3 | WebSocket transport + streaming (P) | WS server, reconnection, per-persona token streaming, SSE fallback | R0 |
| R4 | 2 | Concurrency refinement | Read/write lock separation; parallel reads allowed | R1 |
| R5 | 2 | Multi-turn conversation state | `conversationHistory` in AgentState; fed to Planner/Evaluator | — |
| R6 | 2 | Evaluation harness | Golden-set tests; CI job; regression alerts | R1–R5 stable |
| R7 | 1.5 | Prompt versioning + A/B | JSON prompt files; feature-flag router; versioned rollout | — |
| R8 | 1.5 | User presets + cost guardrails | Custom presets API; per-ticket token budget hard-stop | R2, R7 |
| R9 | 1 | Trace optimization + docs | Payload dedup; updated Agent.md/guardrails.md; runbooks | R1–R8 |
| R10 | 1 | Hardening & release | Load test, chaos test, canary rollout, runbook drills | R1–R9 |

## R0 — Foundation (Week 0–0.5)

### R0.1 MongoDB Replica Set Verification
- [ ] Confirm `MONGODB_URI` points to a replica set (`rs0/...`); run `rs.status()` for majority
      quorum.
- [ ] If standalone: document the two-phase merge fallback via a `PendingMerge` collection in
      `sandboxMerge.ts`. **This is a prerequisite for Part A's P1-M1 transaction to be safe** — if
      standalone is in prod, M1's `session.withTransaction` throws at runtime.
- [ ] Add a health endpoint `/api/health/mongo` → `readyState + isMaster`.

### R0.2 WebSocket Server Scaffold
- [ ] New `src/lib/wsServer.ts` (`ws` on a separate port, e.g. 3001, or `/api/ws` via a Next.js
      custom server).
- [ ] Connection auth: reuse `getAuthUserId` from `/api/agent/execute`.
- [ ] Message protocol:
  ```ts
  // Client → Server
  { type: "prompt",   payload: { prompt, mergeApproved, resumeTicketId } }
  { type: "merge",    payload: { ticketId } }
  { type: "resume",   payload: { ticketId } }
  { type: "ping" }
  // Server → Client
  { type: "state",    payload: AgentState }
  { type: "token",    payload: { persona, token } }   // streaming
  { type: "busy",     payload: { message } }
  { type: "error",    payload: { message } }
  { type: "done",     payload: { finalState } }
  { type: "pong" }
  ```
- [ ] Health broadcast channel `agent:llm_health` → WS push (replaces SSE `health-stream`).

### R0.3 Evaluation CI Pipeline
- [ ] New `tests/agent/eval/`:
  - `golden-prompts.jsonl` — `{ prompt, expectedSkills[], expectedTools[], maxIterations }`.
  - `runner.ts` — executes `runAgentLoop` headless; asserts `state.ticket.stage` matches expected,
    `state.actionPlan.map(a => a.tool)` contains expectedTools, `state.isComplete === true` within
    `maxIterations`, no `LLM_ERROR`/`REJECTED` unless expected.
- [ ] `.github/workflows/agent-eval.yml` — runs on PR + nightly; uses `LLM_API_KEY` secret (small
      model); fails PR on any golden-prompt regression.
- [ ] Baseline golden set (15 prompts): read queries (count/filter/analytics); vague build →
      clarification; detailed build → merge approval; edit form → merge; delete form → confirm →
      merge; follow-up "yes" to a prior ticket; product guide FAQ; simulated crash → resume;
      permission-denied flows.

## R1 — Parallel Read Path (Weeks 1–2) — (P)

**Problem**: Pure read queries (`STAGE_1`) burn 3 LLM calls (Drafter→Planner→Evaluator→Communicator).
**Blocker cleared by Part A**: P0-2 (cross-tenant intersect) + P1-R2 (no dead prod-write branches)
must land first — read shortcut amplifies any read-path bug.

- [ ] **R1.1 Drafter short-circuit**: after skill classification, if
      `READ_ONLY_SKILLS.has(skill)`, skip Planner/Executor/Evaluator, call
      `executeAgentTool(skill, params, userId)` directly (read-only post P1-R2), build a minimal
      `AgentState` with `activePersona: "COMMUNICATOR"`, `isComplete: true`, return immediately.
      Define `READ_ONLY_SKILLS` in `policy/permissions.ts`.
- [ ] **R1.2 Communicator read-mode**: detect `state.isReadOnly === true` (new flag) → render
      table/summary instead of "form created" prose; reuse `summaryPayload` formatting.
- [ ] **R1.3 Test**: golden prompts "how many forms", "show responses for form X", "analytics for
      form Y"; assert latency ~8s → ~2s (1 LLM call instead of 4); trace shows
      `DRAFTER → COMMUNICATOR` only.

## R2 — Token/Cost Tracking (Weeks 3–4) — (P)

- [ ] **R2.1 LLM usage return**: `retryLLM`/`callLLM` return
      `{ message, usage: { promptTokens, completionTokens, totalTokens, model } }`; provider-specific
      parsing (NVIDIA `usage`, Gemini `usageMetadata`).
- [ ] **R2.2 Persistence schema**: new Mongo collection `AgentUsage`
      `{ ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, timestamp,
      costUsd }`; per-ticket aggregate `AgentState.tokenUsage = { total, byPersona, estimatedCost }`.
- [ ] **R2.3 Budget guardrails**: env `LLM_TOKEN_BUDGET_PER_TICKET` (default 50000),
      `LLM_TOKEN_BUDGET_PER_USER_DAY` (default 200000); pre-check sums today's user usage → 429-like
      error on exceed; in each persona call, if `state.tokenUsage.total > perTicketBudget` → throw
      `LLMBudgetExceededError` → Evaluator surfaces "please rephrase with fewer details".
- [ ] **R2.4 Dashboard**: `/api/admin/agent/usage` per-user/per-day/per-model breakdown; admin page
      (or extend `/app/agent`) with charts.

## R3 — WebSocket Transport + Streaming (Weeks 5–7) — (P)

- [ ] **R3.1 WS server**: full `src/lib/wsServer.ts` — connection map
      `Map<userId, WebSocket[]>` (multi-tab), heartbeat 30s ping/pong, auth on connect, message
      router delegating to `runAgentLoop` with a custom `onUpdate` that pushes WS messages; stream
      tokens via R3.2.
- [ ] **R3.2 Token streaming**: `llmClient.callOnce` supports `stream: true` — `fetch` with
      `ReadableStream`, parse `data:` SSE chunks, extract `choices[0].delta.content`, callback
      `onToken(token)` → WS `{type:"token", payload:{persona, token}}`. Stream for
      Drafter/Planner/Evaluator/Communicator (not tool calls). Buffer in Communicator until `. ` or
      `\n` for smoother UX.
- [ ] **R3.3 Client migration**: new hook `useAgentWS(userId)` — WS lifecycle + reconnection
      (exponential backoff 1s/2s/4s … max 30s); `AgentVisualizer` switches from `fetch` + `EventSource`
      → `useAgentWS`; SSE fallback if WS fails after 3 retries; deprecate
      `/api/agent/health-stream` → health via WS `pong` + periodic broadcast.
- [ ] **R3.4 Reconnection**: on reconnect send `{type:"resume", payload:{ ticketId:
      lastTicketId }}`; server resumes from last `executionTrace` index if remember `Mongo`/`Redis`
      state and `activePersona !== "MERGED_TO_PRODUCTION"`; client replays missed trace entries
      locally (`localStorage` backup).

## R4 — Concurrency Refinement (Weeks 8–9)

- [ ] **R4.1 Lock separation**: `agentLock.ts` → two locks per user:
      `agent_lock:write:{userId}` (mutations) and `agent_lock:read:{userId}` (reads, shared,
      no TTL conflict). In `runAgentLoop`: if `skill ∈ READ_ONLY_SKILLS` → acquire **read lock**
      (non-blocking `SET NX`, short TTL, release immediately after), else **write lock** (existing
      60s TTL, held full loop).
- [ ] **R4.2 Read-lock impl**: `SET agent_lock:read:{userId} <reqId> NX PX 5000`; multiple readers
      (distinct `reqId`); writer waits for readers to expire (simple TTL is fine for 5s).
- [ ] **R4.3 Test**: 1 write + 3 reads concurrent → reads in parallel, write serialized; no sandbox
      races (Redis sandbox per-user; reads don't mutate).

## R5 — Multi-Turn Conversation State (Weeks 10–11)

- [ ] **R5.1 Schema**: `AgentState.conversationHistory = { role:"user"|"assistant", content, ticketId,
      timestamp }[]`, capped at `MAX_HISTORY = 10` turns; append
      `{role:"user", content: prompt, ticketId: currentTicketId}` per user prompt.
- [ ] **R5.2 Persona integration**: Planner prepends last 3 assistant messages as "Recent context:";
      Evaluator includes history in QA payload for semantic continuity; Communicator uses history
      to avoid repeating explanations.
- [ ] **R5.3 Resume**: load `conversationHistory` from Mongo (already in `AgentState`); Drafter's
      `recentTickets` query also considers conversation turns, not just tickets.

## R6 — Evaluation Harness (Weeks 12–13)

- [ ] **R6.1 Golden prompt expansion**: target 50 prompts — all 6 skills × 2–3 variations; edge
      cases (vague, follow-up, permission denied, crash recovery, multi-turn); adversarial (ReDoS
      regex, cross-tenant `form_id` injection, prompt injection). **Asserts Part A contracts**
      (especially P1-E1 retry routing) so CI red herrings don't appear later.
- [ ] **R6.2 CI metrics**: per-prompt latency (p50/p95), token usage per prompt, iteration-count
      distribution; regression threshold latency +20% or tokens +30% = fail.
- [ ] **R6.3 Nightly drift**: run golden set against current + candidate model versions; alert on
      `isComplete` rate drop, tool-sequence divergence, cost spike.

## R7 — Prompt Versioning + A/B (Weeks 14–15)

- [ ] **R7.1 File-based prompts**:
  ```
  src/agent/prompts/
    v1/{drafter,planner,evaluator,communicator}.json
    v2/   (future)
  ```
  Each file `{ systemPrompt, outputSchema, version }`; `prompts.ts` becomes a loader
  `loadPrompt(version, persona)`.
- [ ] **R7.2 A/B router**: env `AGENT_PROMPT_VERSION=v1`; feature flag
      `AGENT_PROMPT_AB=v2:0.1` (10% get v2); per-user override cookie `agent_prompt_version=v2`;
      metrics tracked per version (via R2 usage collection).

## R8 — User Presets + Cost Guardrails (Weeks 15–16)

- [ ] **R8.1 Custom presets API**: `POST /api/agent/presets` `{label, prompt, tags}`;
      `GET /api/agent/presets` (user's + globals); `DELETE /api/agent/presets/:id`; UI "Save as
      preset" button in `AgentVisualizer` sidebar.
- [ ] **R8.2 Hard budget enforcement**: (already in R2) — add UI: token-budget progress bar in
      `AgentVisualizer` header, warning toast at 80%, hard stop at 100%, admin override
      `AGENT_BUDGET_BYPASS_USERS="user1,user2"`.

## R9 — Trace Optimization + Documentation (Week 17)

- [ ] **R9.1 Trace payload dedup**: `addTrace` stores `actionPlanRef: stepId` of the planner trace
      entry instead of embedding full `actionPlan`; client resolves references when expanding log.
- [ ] **R9.2 Docs**: `Agent.md` synced with live prompts (remove remodel appendix, make canonical);
      `guardrails.md` adds concurrency + budget invariants; `RUNBOOK.md` incident response (LLM
      down, budget exceeded, lock contention, merge failure); Mermaid architecture diagram in
      `docs/agent-architecture.md`.

## R10 — Hardening & Release (Week 18)

- [ ] **R10.1 Load test**: k6 — 50 concurrent users, mixed read/write, 10 min; targets p99 latency
      < 15s (streaming), 0% data loss, < 1% lock contention.
- [ ] **R10.2 Chaos tests**: kill LLM mid-request → resume; kill Mongo primary → replica-set
      failover + agent resume; fill Redis → eviction policy (sandbox TTL) doesn't lose active
      tickets; network partition client → WS reconnection + state replay.
- [ ] **R10.3 Canary rollout**: 5% → 25% → 100% over 3 days; monitor error rate, latency, token
      cost, user satisfaction (toast dismiss rate).
- [ ] **R10.4 Runbook drills**: LLM outage, budget alert, stuck lock, merge conflict — walked by 2
      engineers independently.

---

## Part B — execution order (critical path)

```
R0 (foundation)
   ├──> R1 (read shortcut)      ┐
   ├──> R2 (cost tracking)      ├── can run in parallel
   ├──> R3 (WS + streaming)     ┘
            │
            ├──> R4 (lock separation)  ──> R6 (eval harness)
            ├──> R5 (conversation)     ──> R6
            │
            └──> R7 (prompt versioning)
                     │
                     └──> R8 (presets + budget UI)
                              │
                              └──> R9 (trace + docs)
                                       │
                                       └──> R10 (hardening + release)
```

- R1, R2, R3 can run in parallel after R0.
- R4 depends on R1 (uses `READ_ONLY_SKILLS`).
- R5 independent of R4.
- R6 depends on R1–R5 for a stable test surface.
- R7–R10 sequential.

## Part B — cross-cutting concerns

| Concern | Owner | Tracking |
|---------|-------|----------|
| TypeScript strictness | All phases | `tsc --noEmit` clean gate per PR |
| Lint/format | All phases | `npm run lint` + Prettier gate |
| Secrets | R0, R2, R7 | `.env` never committed; Vercel/GH secrets |
| Backwards compat | R1, R3, R4 | Feature flags for every breaking change |
| Observability | R2, R3, R6 | Structured logs (pino) + metrics (prom-client) |

## Part B — risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM provider changes API | Medium | High | `llmClient.ts` adapter pattern; integration tests per provider |
| Mongo standalone in prod | Low | High | R0.1 verification; fallback documented |
| WS connection storms | Low | Medium | Connection limits per IP; exponential backoff |
| Prompt regression | Medium | High | Golden-set CI + nightly drift detection |
| Token cost spike | Medium | Medium | R2 budget guardrails + alerts |
| Lock contention under load | Medium | Low | R4 read/write separation; monitoring |

## Part B — success criteria (Definition of Done)

- [ ] All 50 golden prompts pass CI.
- [ ] p95 latency for read queries < 3s (was ~8s).
- [ ] p95 latency for form build < 12s streaming (was ~15s blocking).
- [ ] 0 data-loss incidents in chaos tests.
- [ ] Token cost per form build tracked + budget enforced.
- [ ] WS reconnection < 2s median.
- [ ] Canary rollout completes with < 0.1% error rate.
- [ ] Runbook drills passed by 2 engineers independently.

## Part B — file map (new / modified)

```
src/
├── agent/
│   ├── prompts/
│   │   ├── v1/{drafter,planner,evaluator,communicator}.json
│   │   └── loader.ts
│   ├── policy/permissions.ts        # + READ_ONLY_SKILLS, budget check
│   ├── sandbox/
│   │   ├── agentLock.ts             # + read/write lock separation
│   │   └── sandboxMerge.ts          # + standalone fallback
│   ├── types.ts                     # + conversationHistory, tokenUsage, isReadOnly
│   ├── agentLoop.ts                 # + read shortcut, budget check, history append
│   ├── personas/
│   │   ├── drafter.ts               # + short-circuit, history context
│   │   ├── planner.ts               # + history in prompt
│   │   ├── evaluator.ts             # + history in QA
│   │   └── communicator.ts          # + read-mode, history awareness
│   └── helper/
│       ├── jsonParse.ts
│       └── id.ts
├── lib/
│   ├── llmClient.ts                 # + streaming, usage return, budget error
│   ├── wsServer.ts                  # NEW
│   └── agentTools.ts                # + usage metadata
├── app/
│   ├── api/agent/
│   │   ├── execute/route.ts         # WS upgrade handler
│   │   ├── ws/route.ts              # NEW WS endpoint
│   │   ├── presets/route.ts         # NEW CRUD
│   │   ├── health/route.ts          # NEW (replaces health-stream)
│   │   └── admin/usage/route.ts     # NEW dashboard API
│   └── agent/page.tsx               # → useAgentWS hook
├── components/
│   ├── AgentVisualizer/AgentVisualizer.tsx  # WS + streaming UI
│   └── hooks/useAgentWS.ts                    # NEW
├── models/
│   └── AgentUsage.ts                # NEW Mongo model
└── tests/
    └── agent/eval/
        ├── golden-prompts.jsonl
        ├── runner.ts
        └── ci.yml
```

## Part B — new dependencies

```json
{
  "ws": "^8.16.0",
  "@types/ws": "^8.5.10",
  "pino": "^8.19.0",
  "prom-client": "^15.1.0"
}
```

---

# Out of scope (explicitly deferred)

Identified in the architecture review but deferred to Part B because they need new infra, not just
code hygiene:

- WebSocket transport + token streaming — **R3**
- Token-cost tracking + per-user daily budget UI — **R2 + R8**
- Parallel read path / Drafter short-circuit — **R1** (note: a cheap win, but amplifies read-path
  bugs, so Part A P0-2/P1-R2 must land first)
- Multi-turn `conversationHistory` — **R5**
- Full golden-set evaluation harness + nightly drift — **R6**
- Prompt versioning + A/B — **R7**
- Lock read/write separation — **R4** (needs the R1 parallel read path)

Part A closes the correctness/security/integrity holes Part B sits on top of. Recommended kickoff:
ship Part A Week 1–2, then begin R0 and parallelize R1/R2/R3.
