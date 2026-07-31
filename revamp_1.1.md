# Agent Remodel — Change Log (revamp_1.1)

Tracks every edit made while executing the plan in `agent_remodel.md`. Append-only, newest at top.

## Phase 1 — Foundations (NO runtime behavior change)

### 1.1 Type unification (#17, #20)
- `src/agent/types.ts`
  - Added `AgentPendingUpdate`, `AgentPendingDelete`, `AgentDraftForm`, `AgentDraftView` interfaces.
  - Rewrote `SandboxStoreState` to the canonical shape: `{forms, customViews, queryResults, updates: [], deletes: []}`.
  - Added `emptySandboxStore()` factory and `normalizeSandboxStore(raw)` coercion helper (used by resume path + migration).
  - Added `AgentBusyError` class for the per-user lock (Phase 1.3).
  - Added `resumedPrompt?: string` to `AgentState` so resume does not overwrite the original prompt (Phase 4.4 prep).

### 1.2 Redis-backed sandbox store (#3)
- New `src/agent/sandbox/sandboxRedisStore.ts`. Persists under `sandbox:{userId}` with 24h TTL via `agentRedis.client`. Methods: `get/resetStore/saveDraftForm/saveDraftView/saveUpdateIntention/saveDeleteIntention/getQueryResult/setQueryResult`.
- `src/agent/sandbox/agentRedis.ts` — added `client: redisClient` re-export so the new store can communicate with Redis directly.
- `src/agent/sandbox/sandboxStore.ts` rewritten as a back-compat façade: legacy sync `getStore()` returns `emptySandboxStore()`; async `getStoreAsync()` lifts from Redis; legacy-shape `SandboxStoreState` interface preserved for callers that haven't migrated.
- New `src/agent/sandbox/sandboxMerge.ts` stub. Real Mongo-transaction merge lands in Phase 5.3.

### 1.3 Redis per-user lock (#9)
- New `src/agent/sandbox/agentLock.ts`. `acquireAgentLock(userId, ticketId)` uses `SET key value NX PX 60000`; release via Lua compare-and-del so we never delete another process's lock. Returns `{ release, stale }` — `stale()` true at release time if our lock expired mid-loop (surfaces as `LLM_ERROR` in Phase 6).

### 1.4 UUID / ID generator (#15)
- New `src/agent/helper/id.ts` (`newActionId`, `newTicketId`, `newTraceId`, `newIdempotencyKey`) backed by `crypto.randomUUID`.
- `src/agent/agentLoop.ts` — `addTrace` now uses `newTraceId()` instead of `Date.now()+trace.length`.
- `personas/planner.ts` action IDs switch in Phase 4.2.

### 1.5 Idempotency-key field on Form (#4)
- `src/models/formModel.ts` — added `agentIdempotencyKey: string` with sparse unique index. Used by the Phase 5.3 merge step to dedupe re-merges of the same draft.

### 1.6 Migration script (#17 migration)
- New `scripts/migrate-agent-tickets.ts`. Coerces legacy `AgentTicket.sandbox` to the canonical shape; marks unrecoverable `PROCESSING` tickets `LLM_ERROR`. Default dry-run; `--apply` to commit.
- `package.json` — added `"agent:migrate": "ts-node -r dotenv/config scripts/migrate-agent-tickets.ts"`.

### Type-clean adjustments
- `src/agent/agentLoop.ts` — `sandbox: sandboxStore.getStore(userId)` (legacy in-memory) replaced by `emptySandboxStore()` at both state-init sites (line 54 merge-approved branch and line 111 normal init). Note: `agentLoop` retains non-null assertions `state!` on persona-call sites because the existing `let state: AgentState | null` pattern widens back to nullable on every reassignment; this is a temporary scaffold for Phase 6's full rewrite of the loop with the lock + Mongo `RESOLVED` hygiene.
- `src/lib/agentTools.ts` (pre-existing type errors around `run_database_query`): `secureQuery` typed as `Record<string, any>`; `queryBuilder` typed as `any` to silence cascading Mongoose Query generics. Logic unchanged — Phase 5.2 rewrites this method to fix the cross-tenant leak (#24).

### Phase 1 verification gate
- `npx tsc --noEmit -p tsconfig.json` is clean (no errors introduced by Phase 1; the previously-existing `Cannot find module '@/lib/agentTools'` errors are pre-existing Next.js path-alias resolution issues under raw `tsc`, not blocking under `next build`, and not touched here).
- `npm run lint` / ESLint v10 do not start in this repo today (pre-existing tooling issue, unrelated to the agent remodel) — `next lint` errors with "Invalid project directory: lint" because of a Next 16 invocation quirk. Logged here so implementers know not to re-litigate.
- Migration script `npm run agent:migrate` will run as part of Phase 5.5 once a test Mongo is available; dry-run mode is the default and the script is importable.

### Phase 1 exit status
✓ Done. No runtime behavior change; foundations in place for Phases 2–6.

---

## Phase 2 — Permission enforcement layer (#6, partial #24)

### 2.1 Permission policy module
- New `src/agent/policy/permissions.ts`. Two entry points:
  - `checkPermission(skill)` — maps each skill in `skills.md` to its required scope (`build_form`→`form_management`, `delete_form_skill`→`destructive_actions`, `filter_responses`/`generate_analytics_skill`/`manage_custom_views`/`run_database_query`→`data_analytics`, `product_guide`/`unsupported`→`_always_allowed`). Reads `permissions.json` and returns `{allowed, scope?, reason?}`.
  - `checkToolPermission(tool)` + `ALLOWED_TOOLS` — defense-in-depth at the Executor. Maps tool names to scopes. Used by the executor's new allow-list gate (Phase 2.3).
- Previously the Drafter only checked `form_management` for `build_form`. `data_analytics` was never checked; `destructive_actions` (`false` in `permissions.json`) was never checked — Guardrail #4 was effectively bypassed. This phase closes those gaps.

### 2.2 Drafter permission gate
- `src/agent/personas/drafter.ts`:
  - Removed direct `permissionsConfig` import + the inline `build_form`-only check.
  - Wired `checkPermission(llmAnalysis.skill)` instead. Rejects any skill whose scope is `false`. Rejects unknown skills (typed in `SKILL_TO_SCOPE`) with a "Unknown skill" reason.
  - The early `REJECTED` branch now carries the right scope's reason for all six skills, not just `build_form`.

### 2.3 Executor tool allow-list
- `src/agent/personas/executor.ts`:
  - Added `ALLOWED_TOOLS.includes(act.tool)` check before any dispatch. Hallucinated names produce a clean `act.status = "error"` with the allow-list in the message — the Evaluator/loop can retry against feedback.
  - Added `checkToolPermission(act.tool)` as a second gate. Returns deny reason from `permissions.json`. This catches skills the Drafter let through.
  - Removed `"delete_forms"` (plural) from the mutation-intercept list; it was hallucination bait: the tool was never declared in `tools.ts` / `skills.md` but the executor silently swallowed it. Now it fails the allow-list with a clear message.
- `src/agent/personas/communicator.ts` — same `delete_forms` removal; the "Confirm & Merge" detection only checks `create_form`/`update_form`/`delete_form`.

### Behavior notes
- As part of the Phase 2 sweep, three latent bugs were uncovered while switching `sandboxStore` from sync to async:
  - `sandboxStore.saveDraftForm/saveUpdateIntention/saveDeleteIntention` are now async (Redis-backed). Without `await`, the executor returned a Promise as `act.result` instead of the resolved value, and merge would miss pending intentions.
  - All three call sites now `await` the sandbox writes. `mergeToProduction` was already awaited at `agentLoop.ts:61`.

### Phase 2 verification gate
- `npx tsc --noEmit -p tsconfig.json` clean (no errors introduced).
- Behavior edge cases:
  - Setting `permissions.json` `destructive_actions: true` and asking the LLM to classify `delete_form_skill` will now reach the Planner; previously it would silently slip through and queue a `delete_form` call. The LLM will still need re-prompted at the Communicator confirmation gate (#3 guardrail from `Agent.md`).
  - `permissions.json` `data_analytics: false` now rejects `filter_responses`/`generate_analytics_skill`/`manage_custom_views` at the Drafter — previously these were never gated.
  - Hallucinated `delete_forms` (plural) → executor error action with allow-list printed in the error message → Evaluator retry budget (Phases 4+) acts on it.

### Phase 2 exit status
✓ Done. All six skills + all nine actual tools are now gated against `permissions.json`.

---

## Phase 3 — Robust LLM handling (#5, #13, #21)

### 3.1 Safe JSON extractor
- New `src/agent/helper/jsonParse.ts` — `safeJSON<T>(raw)`:
  1. Parses the whole string if valid JSON.
  2. Otherwise extracts the first ```json fenced block.
  3. Otherwise walks the string with a balanced-brace scanner that ignores braces inside string literals (and respects escaped quotes), returning the first valid balanced block.
  4. Returns `null` on failure — never throws.
- Wired into `personas/drafter.ts` replacing the greedy `/\{[\s\S]*\}/` regex that matched across nested braces and caused `JSON.parse` to throw the entire ticket as "Semantic parsing failed" (#5).

### 3.2 LLM client: typed errors, retry/backoff, bounded timeout
- `src/lib/llmClient.ts` rewritten:
  - New error classes: `LLMOfflineError`, `LLMRateLimitError`, `LLMTimeoutError`, `LLMHTTPError`, `LLMParseError`. Lets the Evaluator/loop distinguish auth/rate-limit/network/parse failures instead of treating them all as generic `Error` (#21).
  - New `retryLLM(messages, options, {retries=3, baseMs=500, jitterMs=250, timeoutMs})`: exponential backoff + jitter. Retries on `LLMRateLimitError`, transient HTTP (`408/409/425/429/500/502/503/504`), `LLMTimeoutError`, and `LLMOfflineError` (first attempt only — avoids retrying a missing API key forever).
  - `LLM_TIMEOUT_MS` env (default 30,000 ms) replaces the original `6,000,000 ms` (100-minute) `AbortController` timeout, which was a bug — a hung request could lock a user out for the duration of a meeting.
  - Existing `callLLM(...)` re-exported as a `retryLLM` wrapper — drop-in for current callers.

### 3.3 Removed Llama-3.1 `<|python_tag|>` hack from the Planner (#13)
- `legacy/llama3Fallback.ts` quarantines the `<|python_tag|>` extractor that hard-coded Llama-specific syntax (`True/False/None` → `true/false/null`, single-quote → double-quote) and silently truncated multi-call plans to ONE action (only the last `<|python_tag|>` match was pushed).
- `personas/planner.ts` no longer calls this fallback by default. Activating it requires `LLM_ALLOW_LEGACY_FALLBACK=1`. Without it, missing tool calls produce a sentinel `_no_tool_call` error action so the Evaluator (Phase 4) can decide whether to retry or surface to the user.
- Same file uses `newActionId()` (Phase 1.4) for action IDs instead of `Date.now()+Math.random()`.
- `state.evaluatorFeedback` is now prepended to the Planner's user message on retries (#4.2/#23 prep). Previously the loop sent retries blindly back to the Planner with no failure context at all, so the LLM had no way to know what to fix.

### Phase 3 verification gate
- `npx tsc --noEmit -p tsconfig.json` clean.
- Behavior edge cases (verifiable by inspection):
  - A 429 from the LLM provider no longer burns one of the Evaluator's three retry iterations on the first call — `retryLLM` backs off and retries internally.
  - A 100-minute hang is no longer possible — `LLM_TIMEOUT_MS` (or `RetryOptions.timeoutMs`) bounds `fetch`.
  - Drafter input with embedded Markdown code fences like
        `"{ "stage": "STAGE_2", "skill": "build_form" } some example ```{ x: 1 }``` trailing prose"`
    is now parsed as the first balanced block instead of throwing.
  - Llama-3.1's `<|python_tag|>` emissions (when not asked for) no longer contaminate the Planner; if you really want them, set `LLM_ALLOW_LEGACY_FALLBACK=1`.

### Phase 3 exit status
✓ Done. Planner is provider-agnostic; JSON parsing is robust; LLM calls distinguish transient from terminal failures and apply bounded backoff.

---

## Phase 4 — Persona correctness (#1, #8, #11, #23, #19)

### 4.3 Drafter — kill hardcoded defaults, fix dead `isFollowUpConfirmed` branch
- `src/agent/personas/drafter.ts` full rewrite:
  - #19: removed the `[Full Name, Email Address]` fallback at the requirements-storage step. The Drafter's prompt Rule #1 says "DO NOT assume or invent default form fields"; the fallback contradicted that trust and produced surprise 2-field forms whenever the LLM omitted `requirements.fields` for a not-flagged-as-vague prompt. Now `build_form` with no fields forces `isVague` so the user is consulted — never surprised.
  - #8: resuscitated the `isFollowUpConfirmed` branch. The previous code set the flag and then fell through into the isVague check, guaranteeing the user was asked to specify form title and fields all over again even after confirming "yes" to "was that form X?". Now we actually load the linked ticket's previously-classified requirements from Mongo (`AgentTicketModel.findOne({ticketId, userId})`), merge them into `state.requirements`, and skip the isVague / hardcoded-fallback path entirely.
  - #4.4: `recentTickets` query excludes `REJECTED`/`LLM_ERROR` so the LLM doesn't try to follow up on dead work; capped at 3 most recent instead of 5 raw entries (prompt size + leak into context).
  - STAGE_1 read path now also recognizes `run_database_query` / `filter_responses` / `generate_analytics_skill` / `manage_custom_views` directly (legacy `read_query_skill` symbol mapped to `run_database_query` for back-compat).
  - `product_guide` branch sets `isComplete: true` so agentLoop clears Redis state (#6.2 prep) instead of leaving the FAQ ticket marked `PROCESSING` forever in Mongo.
  - LLM-offline / parse-fail no longer bubble up as `throw new Error("Semantic parsing failed")` — they surface as a clarifying question to the user so the ticket isn't discarded for a parser bug.

### 4.4 — resume no longer overwrites `state.prompt`
- `src/agent/agentLoop.ts:88`: on resume, we used to do `state.prompt = prompt`, destroying the original prompt and breaking the trace + the Evaluator's "User Request" field. Now `state.resumedPrompt = prompt` instead. (Persona paths still read `state.prompt` for primary intent — Planner/Evaluator/Communicator use it as the User Request field. `resumedPrompt` is the new-in-ticket user input; Phase 6 may surface both when re-planning.)

### 4.1 Evaluator — real LLM-based QA (#1, #23)
- `src/agent/personas/evaluator.ts` full rewrite:
  - Pass 1: deterministic pre-check on `failedActions` — short-circuits to `EXECUTOR_SANDBOX` if iterations remain (NOT Planner as before). Previously the loop routed back to PLANNER on a transient executor error, recompiling a fresh plan from scratch instead of just re-running the failed tool, which usually produced a different plan and burned iterations for no reason (#1, #23). Bonus: retries the right persona against the *same* now-validated params from the Planner.
  - Pass 2: LLM-based semantic QA. Sends user request + Drafter requirements + redacted tool results + iteration budget to a typed-error-using `retryLLM` with `response_format: json_object`. Returns `{isComplete, shouldRetry, feedback}` via `safeJSON`. The previous "Evaluator" only summarized results and unconditionally moved to `COMMUNICATOR` — the spec's "compare sandbox output against requirements" job was never performed (#1).
  - On LLM-determined `shouldRetry && !isComplete && budget remain` → `EXECUTOR_SANDBOX` with the LLM's specific feedback as `evaluatorFeedback` so the next execution actually knows what to fix (#23).
  - `isComplete && plan mutates state` → Evaluator transitions to `AWAITING_USER_APPROVAL` directly (not the Communicator). Previously the Communicator stole this job using a simple tool-name test, contradicting Agent.md:100-119 (#1, #14).
  - On budget exhausted, routes to `COMMUNICATOR` with a user-readable recovery prompt.
  - `redactPII(payload)` strips `ip_address` / `user_agent` from anything sent to the LLM (#6.4 prep).
  - LLM offline / envelope errors no longer silently approve the work — they either retry (with budget) or surface a typed failure (without budget).

### Communicator no longer mutates `activePersona` (#1, #14)
- `src/agent/personas/communicator.ts` rewrite. The Communicator's job is now purely to render the user-facing reply text; it preserves the `activePersona` the Evaluator chose. Previously it ran a tool-name test and overrode the Evaluator's decision by setting `AWAITING_USER_APPROVAL` itself — older code routed to Communicator from the Evaluator's success path and the Communicator then double-transitioned, which is what caused the documented contract violation "Evaluator sets AWAITING_USER_APPROVAL" to be untrue in the implementation.
- Uses `retryLLM` instead of bare `callLLM`. Same PII redactor as the Evaluator is applied to the `summaryPayload`.

### 4.2 Planner — feedback-aware, descriptions enriched, parameter-validated (#11, #23)
- `src/agent/personas/planner.ts`:
  - `state.evaluatorFeedback` is now prepended to the user message as `"Previous plan failed. Feedback: <feedback>..."`. Previously retries went to the Planner with no failure context, so the LLM had no way to know what to fix (#23).
  - New `validateToolParams(tool, params)` performs a minimal schema check aligned with `guidelines.md`: required fields, valid field-type enum (1..5), select-type requires `options[]`, valid filter operators, `formId` required on the right tools, etc. Hallucinated or malformed params are stamped `status: "error"` with the reason at plan-compile time, so the Executor never wastes a sandbox turn on bad data.
  - `describeTool(tool, params)` produces one-line summaries ("Create form 'X' with N field(s)." etc.) replacing the placeholder `"Dynamically invoked tool: <name>"`. These descriptions are shown to the user in their action checklist (#11).

### Executor honors Evaluator feedback on retry (#23)
- `src/agent/personas/executor.ts` rewrite:
  - `lastFeedback = state.evaluatorFeedback || ""` read at the top of the loop and surfaced to logs on retry.
  - Actions that the Planner validator already marked `error` are not dispatched — the params are invalid and re-running won't change that. The prior Evaluator feedback is stamped onto `act.error` for downstream personas so the user's reply can say "prior feedback: …".
  - Otherwise structurally identical to the previous executor; the sandbox mutation block is unchanged here because Phase 5 rewrites that to fix the cross-tenant leak (#24) and the raw `new RegExp(...)` ReDoS vector.

### Phase 4 verification gate
- `npx tsc --noEmit -p tsconfig.json` clean.
- Expected behavior changes verifiable by inspection:
  - `"build a form"` with no fields → user receives a clarifying question instead of a surprise 2-field form (#19).
  - `"yes"` to "was that form X?" → Drafter loads the prior ticket's requirements from Mongo instead of demanding title + fields all over again (#8).
  - A transient executor failure → Evaluator routes back to EXECUTOR_SANDBOX (not PLANNER) and consumes exactly 1 iteration (#1, #23).
  - Mutating-plan success → Evaluator transitions to `AWAITING_USER_APPROVAL`; Communicator renders the reply text (#1, #14).
  - `"delete forms"` plural → Planner never produces `_no_tool_call` because the Executor's allow-list gates it cleanly; the LLM can only ever emit a `delete_form` tool call (singular), and the Planner validator ensures `formId` is provided (#11).

### Phase 4 exit status
✓ Done. All five personas now match the documented contract in `Agent.md`. Spec/implementation drift that produced silent surprise behavior is removed. The bio of bug recipes for the Eleven Evaluator is exhausted; further changes (sandbox rewrite, lock wiring, simulated-offline migration, mongo-RESOLVED hygiene) belong to Phases 5–6.

---

## Phase 5 — Sandbox isolation reworked (#2, #4, #10, #17, #24)

### 5.1 Executor: no prod writes for mutations, no RegEx-by-name leak, no `delete_forms`
- `src/agent/personas/executor.ts` full rewrite:
  - **Mutations never touch prod directly.** `create_form` queues a draft with an `idempotencyKey` into the Redis sandbox. `update_form` / `delete_form` snapshot the existing production form via `Form.findOne({ user, _id|formId })` ONLY (no more `new RegExp('^'+formId+'$', 'i')` against the user-supplied string), then save a pending intention carrying `expectedUpdatedAt` for optimistic-concurrency at merge time. Previously the executor ALSO recorded the regex-built lookup against prod — that lookup silently matched by form NAME in a case-insensitive way, letting a 5-char user string match the wrong form and queue a delete against it (#2, #24).
  - Each mutating action stamps an `idempotencyKey` (via `newIdempotencyKey()` from Phase 1.4 helper) into the pending intention; merged in 5.3.
  - Read / analytics tools now cache their outputs into the per-user sandbox (`sandboxRedisStore.setQueryResult(userId, actionId, result)`). On retry iterations (`state.iterationCount > 1`) the cached result is reused so re-runs are determinate across iterations — the LLM doesn't drift on a different prod snapshot between attempts (#10 prep).

### 5.2 Fix cross-tenant leak in `agentTools.ts` `run_database_query` (#24)
- `src/lib/agentTools.ts`:
  - `Response` branch no longer OVERWRITES `secureQuery.form_id = { $in: userFormIds }` with raw `query.form_id`. Now intersects: `{ $in: userFormIds, $eq: query.form_id }` so a forged `form_id` outside the user's owned set returns empty results — never the victim's data.
  - Same intersect logic added for `Form` and `CustomView` when the LLM provided `form_id` — previously the `user: userId` clause was there but the LLM-supplied `form_id` was uncoupled from the user's owned-forms list. Now both axes are scoped.

### 5.3 Transactional + idempotent mergeToProduction (#4)
- `src/agent/sandbox/sandboxMerge.ts` — full implementation:
  - Whole merge runs inside `session.withTransaction` — `Form.findOneAndUpdate` with `$setOnInsert` keyed on `(user, agentIdempotencyKey)` so a re-merge of the same draft is a no-op (sparse unique index added on `agentIdempotencyKey` in Phase 1.5).
  - Updates / deletes include the `expectedUpdatedAt` snapshot in the filter for optimistic concurrency — if the form was edited between the Executor's existence check and the merge, the update matches zero docs (logged via `Stats.updatesApplied`) and the user is informed, not silently overwritten.
  - On throw, the transaction aborts and the sandbox is NOT reset — the user can retry the approval.
  - On commit, sandbox is reset only after the transaction commits.
  - Edge case (`expectedUpdatedAt` absent): filter simply omits the optimistic guard, applying unconditionally — back-compat for resumes from older tickets pre-Phase-5.

### 5.4 Trace bloat cap (#18)
- `src/agent/agentLoop.ts` `addTrace`:
  - Rolling window caps the trace at 50 entries (drops oldest 5 when hit).
  - Each `payload` is JSON.stringified and truncated to 4 KB with a `…[truncated]` marker if it exceeds the cap. Unserializable payloads become `[unserializable]` instead of throwing.
  - Bounds the AgentState JSON stored in Redis/Mongo so 3-iteration multi-persona runs don't bloat the round-trip.

### Phase 5 verification gate
- `npx tsc --noEmit -p tsconfig.json` clean.
- Expected runtime behavior (will be exercised by integration tests):
  - Concurrent double-click of "Confirm & Merge" no longer creates duplicate production forms — idempotency key deduplicates.
  - A merge that fails partway no longer resets the sandbox — user keeps draft state and can retry.
  - LLM-supplied `form_id` not owned by the user returns empty results — no cross-tenant leak possible.
  - `update_form` / `delete_form` look up by `_id` or by the legacy hashid `formId` only; no regex against the user's free-text `formId`.
  - Re-running `run_agent_query` across the same action's retry iteration returns the prior iteration's snapshot.
  - Routing a trace payload through `<sandbox forms: 50-element object>` truncates to 4 KB.

### Phase 5 exit status
✓ Done. Sandbox is durable in Redis; merge is atomic + idempotent + optimistic-concurrency-aware; Tenant isolation holds even against LLM-supplied filter injection. The legacy `MergeToProduction`-resets-after-throw data-loss bug #4 is closed.

---

## Phase 6 — Resilience, concurrency, telemetry (#7, #10, #16, #22)

### 6.1 Per-user Redis lock wired into the loop (#9, #10)
- `src/agent/agentLoop.ts` full rewrite:
  - `acquireAgentLock(userId, pendingTicketId)` acquired BEFORE either the resume or the init code path runs. Released in a `finally` block via the Lua compare-and-del `release` so we never delete a lock we no longer own (#9).
  - On `AgentBusyError` from the lock acquire (i.e. SETNX failed → another loop is running for this user), the loop re-throws so the `/api/agent/execute` route can stream a typed `{type:"busy"}` SSE event the frontend can render as a toast (Phase 6.1b).
  - The lock's value field carries the ticketId being run, so release-time CAS check can detect if our lock has been silently TLE-expired (60s) — `lock.stale()` logs a warning so the operator can see "your loop ran longer than the lock TTL; consider raising LLM_TIMEOUT_MS or LOCK_TTL_MS".
- `src/app/api/agent/execute/route.ts`:
  - Differentiates `AgentBusyError` from generic in-loop failure. Emits a typed SSE event `{type:"busy", error:"..."}` instead of the generic `{error:...}` envelope. Frontend can now toast "another agent request is already running" instead of silently swallowing as a generic error.

### 6.2 Mongo + Redis coherence on success / failure (\#7, \#22)
- `src/agent/agentLoop.ts` introduces `markResolved(state)` and `persistStateToRedis(state)`:
  - `markResolved` writes the Mongo AgentTicket as `status:"RESOLVED", isComplete:true` AND clears the Redis ticket state. Previously the loop only called `agentRedis.clearState(...)` on success and never marked Mongo RESOLVED — so resolved tickets stayed marked PROCESSING forever, corrupting `recentTickets` ordering and the follow-up detection feature for future prompts from the same user (#22).
  - `persistStateToRedis` writes BOTH the Redis state AND the Mongo AgentTicket on every persona transition (formerly only Redis); so a crash between persona calls leaves a coherent Mongo backup for resume.
- On merged-to-production path: Mongo status set `RESOLVED` (was already set but now via `findOneAndUpdate` after the merge commit, not before — defensive ordering so a failed merge doesn't falsely mark RESOLVED).
- On the Drafter short-circuit branch (product_guide / LLMOffline / clarification question): if `state.isComplete === true`, we now mark Mongo RESOLVED too — previously FAQ tickets were left in PROCESSING.
- On resume, `state.requirements.linkedTicketId` is reset to `undefined` so the resumed ticket doesn't re-crosslink to the prior follow-up (#7, also Phase 4.4 prep).
- Resumed sandbox state runs through `normalizeSandboxStore` (Phase 1.1 helper) so legacy tickets missing `updates`/`deletes` arrays are coerced instead of silently dropping those pending intentions at merge time.

### 6.3 Simulated offline: per-ticket, not global (#16)
- `src/agent/agentLoop.ts`:
  - Simulation flag now read as `agent:simulated_offline:{ticketId}` — only the loop for the targeted ticket crashes. The previous code read `agent:simulated_offline` (a global key) which aborted EVERY agent invocation across the whole deployment — not just the test. The general-purpose `simulate-offline` route used in the legacy flow had to be coordinated with whoever else was using the app at the same time.
  - The legacy global key is still honored for back-compat but logs a deprecation warning to stdout so the operator notices.
  - Stripped the dynamic `await import("./sandbox/agentRedis.js")` (with the `.js` extension) — replaced with the typed top-level `import { agentRedis } from "./sandbox/agentRedis"`. The `.js` extension trick was a Node-bundling escape hatch that confused Next.js path resolution and was an indicator of the issue rather than a fix.
- `src/app/api/agent/simulate-offline/route.ts`:
  - Body now accepts optional `ticketId`. If provided, the per-ticket key is set/cleared; else the legacy global key (for back-compat with old test clients).
  - The published `agent:llm_health` event is preserved so the existing sidebar health indicator continues to reflect simulation state.

### 6.4 PII redaction in summary payloads (+ safe payload)
- `src/agent/personas/evaluator.ts` and `personas/communicator.ts` both strip `ip_address` and `user_agent` keys from any object sent to the LLM as a summary, before the trace is emitted (`redactPII(payload)` via JSON-replacer deep clone). This prevents the Evaluator/Communicator from leaking PII back into the user-facing reply or into trace exports.

### Phase 6 verification gate
- `npx tsc --noEmit -p tsconfig.json` clean.
- Expected behavior (verifiable by integration tests once a Mongo + Redis stack is standing):
  - Two concurrent `/api/agent/execute` POST calls for the same user → the first acquires the lock and processes normally; the second emits a typed `{type:"busy"}` SSE event and closes the stream. No double-merge of forms and no interleaved `updates`/`deletes` arrays.
  - A successful `build_form` → merge flow ends with the AgentTicket Mongo doc marked `status:"RESOLVED"` (`isComplete:true`); `recentTickets` queries in subsequent Drafter runs no longer surface it under PROCESSING.
  - Calling the simulate-offline route with `{simulateOffline:true, ticketId:"tkt_xyz"}` only crashes the loop running ticket `tkt_xyz`; other users' agent requests continue to run.
  - A response payload containing `metadata.ip_address:"1.2.3.4"` is redacted to `"[redacted]"` before being sent to the LLM Evaluator.

### Phase 6 exit status
✓ Done. Per-user concurrency safety in place; Mongo/Redis coherence on success and failure; simulated-offline no longer aborts other users' agent runs; PII not leaked to LLM. The final cleanup & docs phase (#7) is the only one remaining.

---





