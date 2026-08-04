# Easy Forms Agent — Memory, Loop, LLMOps & Eval

This document analyses the agent feature living under `src/agent/` and adjacent code (`src/lib/llmClient.ts`, `src/app/api/agent/`, `tests/agent/eval/`). It is organised into the four sections you asked for — **Memory**, **Loop**, **LLMOps**, and **Eval** — and for each it explains *how it is used today* and *how it can be improved*.

> Top-level architecture (for context):
> `runAgentLoop()` in `src/agent/agentLoop.ts` orchestrates a 4-stage persona pipeline — **Drafter → Planner → Executor → Evaluator** — followed by a **Communicator** that renders the user-facing reply, and an **AWAITING_USER_APPROVAL → MERGED_TO_PRODUCTION** merge path. State is persisted to Mongo (`AgentTicketModel`, authoritative) and Redis (`agentRedis` resume cache + `sandboxRedisStore` sandbox drafts), serialised by a per-user Redis lock.

---

## 1. Memory

### 1.1 How memory is used today

The agent has **five distinct, disconnected memory stores**:

| Store | Location | Lifetime | Carries |
|---|---|---|---|
| **Agent ticket (Mongo)** | `AgentTicketModel`, written by `persistStateToRedis` / `markResolved` / `handleFailure` in `agentLoop.ts` | Permanent | Full `AgentState`: requirements, actionPlan, sandbox (drafts + pending updates/deletes), userContext, trace (compressed), ticket status |
| **Resume cache (Redis)** | `agentRedis` `agent_state:{ticketId}` | Until cleared/resolved | Same full `AgentState`, used on crash/resume so Mongo is not re-read every turn |
| **Sandbox drafts (Redis)** | `sandboxRedisStore` `sandbox:{userId}:{ticketId}`, 24h TTL (`SANDBOX_TTL_SECONDS`) | 24h (sliding, rewritten on every `_save`) | Pending form/view drafts, `updates[]`, `deletes[]`, `queryResults{}` |
| **Recent-context window** | `runDrafter` queries `AgentTicketModel.find().sort({createdAt:-1}).limit(3)` | Lives in DB, fetched per Drafter call | Last 3 non-REJECTED/LLM_ERROR tickets (title, originalPrompt, agentReply, status) — fed into the Drafter prompt for follow-up detection |
| **Static persona prompt files** | `prompts.ts`, `Agent.md`, `guidelines.md`, `guardrails.md`, `skills.md`, `permissions.json` | Source-controlled | Canonical system prompts, tool schemas, permissions scopes |

Concrete memory flows:

- **Drafter** builds its user-message from: current local time, existing form names (`Form.find().select("name").limit(20)`), `state.userContext` (profile + preferences loaded once in `agentLoop`), the last-3 tickets context, the pending question (`state.isQuestion ? state.reply`), and the new prompt. This is the *only* persona that pulls historical context from Mongo.
- **Resume path** (`runAgentLoop` with `resumeTicketId`): Redis first, Mongo fallback. Mongo tickets persisted before the remodel are coerced via `normalizeSandboxStore(raw)` so missing `updates`/`deletes` arrays don't silently drop pending intentions. The historical `executionTrace` is replayed into the in-memory `trace[]` buffer.
- **Sandbox eviction**: 24h TTL. If the user comes back after >24h and clicks *Confirm & Merge*, `sandboxRedisStore.get` returns `emptySandboxStore()` and the loop throws `"Merge rejected: approval session expired or no pending actions."`
- **Trace memory**: capped to `MAX_TRACE_ENTRIES = 50` with rolling eviction (drops oldest 5), each payload truncated to `MAX_PAYLOAD_BYTES = 4096`. Mongo gets a *compressed* trace (no payload blobs) via `compressTraceForMongo`; Redis + the live `onUpdate` SSE stream get the full trace.
- **User context**: `state.userContext` is loaded once at the top of `runAgentLoop` from `User.findById` and cached on `state` so it survives across the whole ticket — but it is *not* reloaded on resume (the resumed state carries the original profile).

### 1.2 Gaps and improvements

1. **There is no cross-session / long-term memory.** "Recent context" is a 3-ticket sliding window. The agent cannot remember, e.g., "you always build contact forms with an email field" beyond the last 3 prompts. → *Introduce a per-user preferences/preferences-history document* (Mongo collection) that the Drafter reads and *writes back to* after successful merges, capturing recurring fields the user asks for. This is a natural extension of the already-loaded `userContext.preferences`.

2. **The 5 stores are not coherent.** Mongo and Redis can drift: `shouldPersistToMongo` only writes Mongo on `DRAFTER / AWAITING_USER_APPROVAL / LLM_ERROR / REJECTED / RESOLVED` transitions, while Redis is written on *every* transition. If a process crashes between a Mongo skip and the next Redis write, the resume-from-Mongo path sees a stale persona. The code comment acknowledges Mongo is "authoritative; Redis is a resume cache" but the divergence is real. → *Make Mongo the single source of truth and drop the conditional write — write Mongo on every transition (the compressed-trace optimisation already removes the storage cost concern), and let Redis be purely a hot cache that can be rebuilt from Mongo.*

3. **No summarisation of long conversations.** A ticket resumed many times accumulates trace + sandbox state with no compaction. The 50-entry / 4 KB trace cap is per-`trace[]` buffer, but the *sandbox* (`queryResults`, `updates`) grows unbounded within the 24h window. → *Cap sandbox `queryResults` (LRU of N entries) and summarise completed-iteration results into a single `summary` field the Evaluator can read instead of re-reading raw results.*

4. **User profile is frozen at ticket start.** `state.userContext` is loaded once and never refreshed. If the user changes their preferences between the Drafter turn and the Communicator turn (multi-minute loop), the reply uses stale energy level. → *Reload `userContext.preferences` lazily in the Communicator, which is the only persona that consumes it for tone.*

5. **No memory of *why* a prior ticket was rejected/errored.** The recent-context query explicitly excludes `REJECTED`/`LLM_ERROR` tickets (`status: { $nin: [...] }`). Excluding them prevents follow-up on dead work, but it also means the agent cannot learn "this same prompt failed twice before" and proactively ask for clarification. → *Keep errors excluded from the follow-up window but surface a lightweight "recent failure" signal to the Drafter so it can pre-empt the same ambiguity.*

6. **PII redaction is best-effort key-matching only.** `redact.ts` redacts exact keys in `PII_KEYS` (`email`, `phone`, …). The Communicator/Evaluator pass `redactPII(a.params)` and `redactPII(a.result)`. Form `data` payloads submitted by respondents can contain emails/phones under arbitrary key names (e.g. `"Your Email"`). Value-based redaction exists but is gated behind `AGENT_REDACT_VALUES=0` by default "to avoid false positives." → *Default value-based redaction on for the Evaluator/Communicator prompts (which see raw results), and keep key-only redaction for tool params. Email/phone regex false positives in user-*facing* reply text are already mitigated by the Communicator's "no raw JSON" rule.*

7. **Sandbox TTL is silent.** The 24h expiry produces a hard `throw` at merge time with no warning earlier. → *On resume, check the sandbox TTL (`TTL sandbox:{userId}:{ticketId}`) and surface "this draft expires in Xh" in the UI before the user clicks merge.*

---

## 2. Loop

### 2.1 How the loop is used today

`runAgentLoop` is a single `while (isLooping)` over `state.activePersona`:

```
DRAFTER ──┬─(isQuestion/isComplete/REJECTED)─► return
          └─► PLANNER
PLANNER ──► EXECUTOR_SANDBOX
EXECUTOR_SANDBOX ──► EVALUATOR
EVALUATOR ──┬─(failedActions + budget)──► EXECUTOR_SANDBOX      [retry, iterationCount++]
            ├─(shouldRetry + budget)──► EXECUTOR_SANDBOX        [LLM-driven retry, iterationCount++]
            ├─(isComplete + mutating)─► AWAITING_USER_APPROVAL  [stop, await user]
            ├─(isComplete / no retry)─► COMMUNICATOR
            └─(budget exhausted)──────► COMMUNICATOR (asks user to rephrase)
COMMUNICATOR ──► persist + isLooping=false (or AWAITING_USER_APPROVAL branch stops)
```

Key loop invariants enforced in code:

- **Budget**: `maxIterations = 3`. `iterationCount` is incremented *only* by the Evaluator (both its deterministic-short-circuit path and its LLM-shouldRetry path). Drafter clarifications and Planner compilation do **not** consume iterations (per `Agent.md` "Loop budget" note). The Executor→Evaluator→Executor cycle shares the same 3-iteration budget.
- **Retry carries feedback**: on retry, `evaluatorFeedback` is set by the Evaluator and (a) prepended to the Planner's user-prompt preamble on a *replan* (`feedbackPreamble` in `runPlanner`), and (b) logged by the Executor on retry. But note: **retries route to `EXECUTOR_SANDBOX`, not `PLANNER`**, so the Planner preamble only fires on a fresh ticket post-Drafter or an explicit `[replan]` signal. Normal retries reuse the *same actionPlan* with executor-side logging of feedback only — the Executor does not feed `evaluatorFeedback` back into the LLM; it just logs it.
- **Concurrency**: `acquireAgentLock(userId, ticketId)` (Redis `agent_lock:{userId}`, 60s TTL, Lua compare-and-del) is held for the whole loop via `try/finally`. Concurrent calls throw `AgentBusyError`; the SSE route (`/api/agent/execute`) maps it to either HTTP 409 (pre-stream) or a typed `{type:"busy"}` SSE event (in-stream). The lock expires mid-run detection sets `lock.stale()`.
- **Merge path**: `mergeApproved=true` skips the whole persona loop, verifies the ticket is in `AWAITING_USER_APPROVAL` + `isComplete`, verifies the sandbox is non-empty, then calls `mergeSandboxToProduction` inside a Mongo transaction with `$setOnInsert` idempotency keys `(user, agentIdempotencyKey)` and `expectedUpdatedAt` optimistic concurrency. Double-confirm is a no-op.
- **Per-persona persistence**: `persistStateToRedis` is called after each persona stage. `addTrace` pushes a trace step and calls `onUpdate` (the SSE stream) so the frontend's `AgentVisualizer` can render the live trace.
- **Failure handling**: `handleFailure` sets `status = "LLM_ERROR"`, writes Mongo (so the user can resume after a crash), and returns a user-facing reply. Outer `AgentBusyError` re-throws to the route. Any other unhandled outer error surfaces a minimal state.

### 2.2 Gaps and improvements

1. **Retries reuse the *exact same* actionPlan and never re-consult the Planner.** This is intentional (re-running the LLM Planner non-deterministically could regenerate worse params), but it means the retry loop can only succeed if the failure was transient — it cannot recover from a *structurally wrong* plan (e.g., the Planner picked `update_form` but the user actually needed `create_form`). → *Add a `[replan]` escalation: after the first failed retry, route back to the Planner with `evaluatorFeedback` (the Planner's `feedbackPreamble` code already supports this path but is unreachable from the normal retry flow). Make "Evaluator says shouldRetry 2nd time" trigger Planner re-entry instead of a 3rd identical Executor run.*

2. **`maxIterations = 3` is hard-coded** in both `agentLoop.ts` (init state) and the Drafter/Planner comments. There is no per-skill tuning: a `build_form` (3 mutations) and a read query (1 tool) share the same budget. → *Make `maxIterations` a function of ticket stage / skill (read queries: 1; build/edit: 2-3) and configurable via `permissions.json` or a new `loop.json`.*

3. **No loop-level timeout.** The lock has a 60s TTL but the loop itself has no wall-clock budget. A pathological LLM retry sequence (4 personas × 3 retries × 30s timeout × exponential backoff) can run for minutes while holding the lock. When the lock TTL lapses mid-run, `lock.stale()` only logs a warning — the loop continues and may write stale state. → *Add a `LOOP_DEADLINE_MS` (e.g. 90s) checked at the top of each `while` iteration; on expiry, route to `handleFailure` with "timeout" so the lock release + Mongo `LLM_ERROR` happen cleanly.*

4. **The 60s lock TTL is shorter than a worst-case loop.** → *Raise the lock TTL to match `LOOP_DEADLINE_MS` + buffer, and have the loop `lock.renew()` periodically (or use a watchdog that extends TTL while the loop is alive). Alternatively, switch to a TTL-less lock with an explicit heartbeat.*

5. **`simulated_offline` is re-checked only in DRAFTER and PLANNER branches**, not inside EXECUTOR_SANDBOX or EVALUATOR. The original `simOfflineKey` check is at the top of `while`, but the comment "during Planner" re-check only exists for the Planner branch. → *Hoist the single `simOfflineKey` check out of the branch logic so it applies uniformly to every persona.*

6. **Drafter clarification exchanges are not tracked for back-and-forth limits.** A user could ping-pong with the Drafter indefinitely (each clarification calls `runDrafter`, increments nothing). That's fine for UX but unbounded for cost (each Drafter call is an LLM round-trip). → *Add a soft cap (e.g. 5 clarification rounds) after which the agent offers to file the request as a ticket or gives a generic FAQ.*

7. **`onUpdate` is fired on every `addTrace` and after every persona, but the SSE route opens the stream and only ever emits `[DONE]` or an error.** There is no explicit turn-end event distinct from `[DONE]`; a long-running resume could be hard to distinguish from a hung stream on the client. → *Emit a typed `{type:"turn", state}` heartbeat so the client knows the loop is still alive, and a `{type:"complete", state}` before `[DONE]`.*

8. **The retry determinism cache in the Executor** (`sandboxRedisStore.getQueryResult` on `iterationCount > 1`) has no TTL/invalidation. The code comment admits "if the user merges between iterations, they'll see the new state on the very next loop iteration" — but **within** a single loop's retries the cache is frozen, which is the intended determinism. The risk is only across tickets. Low priority, but worth documenting.

9. **No structured "abort" signal.** There is no way for the user to cancel a running loop except closing the SSE stream (and even then the server-side loop continues until it releases the lock). → *Add an `agent:abort:{ticketId}` Redis flag polled in the `while` loop, mapping to a clean `handleFailure("cancelled by user")`.*

---

## 3. LLMOps

### 3.1 How LLM operations are run today

- **Provider layer** (`src/lib/llmClient.ts`): a single `callOnce` → `retryLLM` pipeline. Two providers via `LLM_PROVIDER`: `nvidia` (default, NVIDIA NIM `meta/llama-3.1-8b-instruct`) and `google` (`gemini-2.0-flash`). OpenAI-compatible chat-completions REST via `fetch`.
- **Retry/backoff**: `retryLLM` retries 3× with exponential backoff (`baseMs=500`, `jitterMs=250`) on `LLMRateLimitError`, retryable HTTP status (`408/409/425/429/500/502/503/504`), `LLMTimeoutError`, and a one-shot transient `LLMOfflineError`. Non-retryable offline (e.g. missing API key) throws immediately.
- **Timeout**: `AbortController` with `LLM_TIMEOUT_MS` (default 30s — previously a hard-coded 6,000,000 ms / 100-min bug).
- **Typed errors**: `LLMOfflineError`, `LLMRateLimitError`, `LLMTimeoutError`, `LLMHTTPError`, `LLMParseError`. `classifyError` normalises `AbortError` → `LLMTimeoutError`, network codes (`ENOTFOUND/ECONNREFUSED/ECONNRESET/EAI_AGAIN`) → `LLMOfflineError`.
- **Decoding**: prompts request `response_format: { type: "json_object" }` for Drafter/Evaluator (deterministic JSON). Planner uses OpenAI-style `tools` + `tool_choice: "auto"` for function calling. A Llama-3 `<|python_tag|>` text fallback (`legacy/llama3Fallback.ts`) is gated behind `LLM_ALLOW_LEGACY_FALLBACK=1`. `helper/jsonParse.ts#safeJSON` and `helper/validate.ts#parsePersona` (fast JSON → fenced ```json → balanced-brace extraction → Zod) recover structured output.
- **Health monitoring** (`src/lib/llmHealthMonitor.ts`): a global `setInterval` every 10s pings `https://integrate.api.nvidia.com/v1/models`, dedupes status-changes, and `pubSub.publish("agent:llm_health", {status})`. Per-ticket simulated offline (`agent:simulated_offline:{ticketId}`) is honoured only inside `agentLoop.ts` and the toggle endpoint — it intentionally does **not** influence the global health broadcast, which reflects the real NVIDIA probe.
- **Telemetry**: every persona call records `state.llmRawOutput` (raw response text) into the trace (truncated to 4 KB). Latency is captured only at the Communicator (`turnStartTimeMs → latencyMs`) and only used to weave an apology if >10s. No token counts, no per-persona latency, no cost.

### 3.2 Gaps and improvements

1. **No token accounting or cost tracking.** `callOnce` discards `data.usage` (prompt_tokens, completion_tokens, total). With Llama-3.1-8b on NIM this matters less, but the agent also supports Gemini Flash; and even a free tier has rate limits. → *Capture `usage` from every `callOnce` response, accumulate into `state.llmUsage` (per-persona: prompt/completion/total tokens), and write it to the Mongo ticket. Surface token cost in the trace + on the `AgentVisualizer`.*

2. **No per-persona latency metrics.** Only the end-to-end `latencyMs` is measured. You cannot tell if the Drafter or the Evaluator is the slow persona. → *Wrap each `retryLLM` call's `Date.now()` span in a `recordLLMCall({persona, attempt, ms, status, model})` and store into `state.llmCallLog[]` (capped). Mirror to the SSE stream as typed telemetry events.*

3. **No model routing per persona.** The same `LLM_MODEL` is used for the deterministic Drafter/Evaluator (want JSON, low temp) and the Planner (function calling). Gemini-Flash vs Llama-3.1-8b have very different function-calling quality. → *Add `LLM_MODEL_DRAFTER`, `LLM_MODEL_PLANNER`, `LLM_MODEL_EVALUATOR`, `LLM_MODEL_COMMUNICATOR` env overrides (default to the global) and per-persona temperature (Drafter/Evaluator: 0.0-0.2, Communicator: 0.6).*

4. **Health monitor only checks the *NVIDIA* models endpoint**, even when `LLM_PROVIDER=google`. The `getCachedHealthStatus()` would report "unknown" for Gemini setups. → *Branch the health probe on `LLM_PROVIDER` (Gemini has its own `/models` endpoint).*

5. **No prompt versioning / no prompt registry.** Schema definitions live in `prompts.ts` but the Drafter prompt is a giant string with hand-numbered rules (`1, 2, ..., 20, 21, 22, 23, 24, 25` — note the jump from 7 to 20, a classic prompt-edit scar). There is no A/B versioning, no per-version eval linkage. → *Move each persona's system prompt into a versioned registry (e.g. `src/agent/prompts/drafter/v1.ts`, `v2.ts`) with a `PROMPTS_VERSION` env selector. The eval runner can then regenerate golden results per version.*

6. **No redaction of the raw `llmRawOutput` written to the trace.** `addTrace` stores `state.llmRawOutput` as the Drafter payload *un-redacted* (only `params`/`result` go through `redactPII` in the Executor/Evaluator/Communicator). If the user's prompt contained PII and the LLM echoes it, it lands in Redis + Mongo + the SSE stream. → *Run `redactPII` over `payload` before the size-truncation check in `addTrace`, or at minimum over `llmRawOutput`.*

7. **`retryLLM` retries transient HTTP 500s but not auth flips.** A 401/403 is classified `LLMOfflineError` and only retried on attempt 0 if it was a transient network `LLMOfflineError` (not the auth subclass). That's correct, but the comment "LLMOfflineError is only retryable on the first attempt" is enforced by `err instanceof LLMOfflineError && attempt === 0` — *any* `LLMOfflineError`, including the auth one, gets one retry. → *Distinguish auth-offline (`throw new LLMOfflineError("LLM auth error...")`) and never retry it; the current code may burn one extra cycle on a key rotation.*

8. **No streaming.** Every LLM call uses `stream: false`. The Communicator — the persona the user *watches* — waits for the full completion before emitting a single SSE event. The user sees a blank trace until the end. → *Enable `stream: true` for the Communicator and stream tokens back through the SSE channel as `{type:"token", delta}` events; keep non-streaming for Drafter/Planner/Evaluator (they need full JSON).*

9. **No structured logging.** `console.log("LLM Raw Output:", rawContent)` in the Drafter, `console.warn`/`console.error` elsewhere. Production observability (correlating a ticket failure to a specific LLM call) requires grepping stdout. → *Introduce a logger (pino or winston) with `{userId, ticketId, persona, attempt, model, ms, status}` fields and ship to Application Insights (there is an `appinsights-instrumentation` skill available) / a sink of choice.*

10. **No fallback model.** `LLM_ALLOW_LEGACY_FALLBACK` recovers Llama-3 *text* but if the primary provider is genuinely down there is no model-level failover (e.g. nvidia → gemini). → *On a non-retryable `LLMOfflineError` from the primary provider, transparently retry once against a configured secondary provider before surfacing `LLM_ERROR`.*

---

## 4. Eval

### 4.1 How eval is used today

- **Harness**: `tests/agent/eval/runner.ts`, wired by `npm run agent:eval` (`ts-node ... tests/agent/eval/runner.ts`). It reads golden prompts from `tests/agent/eval/golden-prompts.jsonl`, finds/creates an `eval@test.local` user, then for each prompt calls the **real** `runAgentLoop(userId, prompt, false, undefined, undefined, ()=>{})` against the connected Mongo + Redis.
- **Golden set**: 15 prompts in `golden-prompts.jsonl`, organised into categories (`read_query`, `build_form`, `edit_form`, `delete_form`, `manage_views`, `product_guide`, `vague_clarification`, `followup_confirm`). Each row declares `prompt`, `expectedSkills`, `expectedTools`, `maxIterations`, `category`.
- **Pass criteria** (`runGoldenPrompt`): `toolsMatch` (every `expectedTools` appears in `state.actionPlan`'s tool list) **AND** `iterationsOk` (`iterationCount <= maxIterations`) **AND** `completed` (`state.isComplete === true`) **AND** `noError` (status not `LLM_ERROR`/`REJECTED`). Failures get a one-line `details` string. The runner exits non-zero on any failure so it can gate PRs via the existing `npm run agent:eval`.
- **Output**: stdout only (`✅ PASS` / `❌ FAIL` + summary `📊 Results: N/M passed`). No persisted report file, no history, no diff.
- **In-loop "eval"**: the Evaluator is the agent's runtime QA gate (see Loop §2.1): a deterministic pre-check on `failedActions` short-circuits to a retry; otherwise a JSON-mode LLM call returns `{isComplete, shouldRetry, feedback}`. That is *behavioural self-checking*, not automated testing.

### 4.2 Gaps and improvements

1. **The golden set is tiny (15 prompts) and has known inconsistencies.** Row 4 expects `expectedSkills: ["generate_analytics_skill"]` but `expectedTools: ["run_database_query"]`; row 12 expects `manage_custom_views` → `create_custom_view`, but `create_custom_view` is *not in `agentToolsSchema`* (only `create_form`, `update_form`, `delete_form`, `run_database_query` exist) — so that row is guaranteed to fail unless the LLM hallucinates the tool name (which the Executor's `ALLOWED_TOOLS` gate then rejects). → *Audit each golden row against the live `agentToolsSchema` + `permissions.json`. Expand to ≥50 prompts across edge cases: pronoun follow-ups, cancellations, time-of-day greetings, vague-then-clarify dialogues, multi-step build+filter, cross-tenant isolation.*

2. **Eval runs against the real production-adjacent stack** (real Mongo, real Redis, real LLM). It creates real `Form`/`User` documents as side effects (e.g. the build_form prompts queue sandbox drafts; if a golden prompt ever reaches `AWAITING_USER_APPROVAL` it could leak). It also costs real LLM tokens on every CI run and is **non-deterministic** — the same prompt can pass today and fail tomorrow due to model drift. → *Split into two suites: (a) **unit eval** with the LLM mocked (record/replay fixtures under `tests/agent/eval/fixtures/`) for deterministic structural assertions on the loop + sandbox + merge logic; (b) **live eval** that runs the real LLM but is gated to a nightly job + a manual flag, not PR-blocking.*

3. **No isolation of eval-side effects.** The `eval@test.local` user accumulates tickets and sandbox entries across runs. `runGoldenPrompt` does not clean up its tickets. → *After each prompt (and in a `finally`), clear the sandbox (`sandboxRedisStore.resetStore`) and mark the ticket RESOLVED or delete the `AgentTicket` doc. Use a fresh `sessionId` per run.*

4. **Pass criteria are too coarse.** `toolsMatch` only checks that *expected* tools were *present*; it does not assert the **params** (did it create a form with the right fields?), the **sandbox state** (did the draft have the right `elements`?), or the **reply** (did the Communicator mention the fields?). A prompt can "pass" while producing a garbage form. → *Add `expectedParams` / `expectedReplyContains` / `expectedSandboxShape` fields to golden prompts and assert against `state.actionPlan[].params`, `state.sandbox`, and `state.reply`.*

5. **No eval of the *Evaluator* itself.** The Evaluator is the agent's QA gate, but the harness never tests whether `isComplete=true` is *correct* — it just checks that the loop set `isComplete`. A false-positive "complete" passes eval. → *Add "negative" golden prompts that should NOT be marked complete (e.g., partial fields, wrong form) and assert `state.isComplete === false` and `state.evaluatorFeedback` is non-empty.*

6. **No regression history.** Eval reports go to stdout only. There is no `tests/agent/eval/reports/` with timestamped runs, no trend (pass rate over time), no per-prompt latency/iteration history. → *Write a JSON report to `tests/agent/eval/reports/<timestamp>.json` (pass/fail per prompt, iterations, latency, llmUsage), and a tiny script to diff this run vs last run.*

7. **No CI wiring.** `npm run agent:eval` exists but the `.github/` directory was not inspected for a workflow that calls it. Even if it did, it would be flaky (see #2). → *Add a GitHub Actions job that runs the mocked unit eval on every PR; run the live eval on a schedule with a Slack/PR comment report.*

8. **No correlation between eval failures and trace.** On failure the runner prints `details` but not the `executionTrace`. Diagnosing *why* a prompt failed requires re-running by hand with logging. → *On failure, dump the full `state.executionTrace` (and `llmRawOutput`) into the report JSON so a failed PR gives a copy-paste-able trace.*

9. **The `followup_confirm` golden prompt (`"Yes, that's the form I want"`) is order-dependent** — it only works if a prior `build_form` clarifying question was produced in the *same* run, but the runner executes prompts sequentially in fixed file order with no shared state reset on the resume path. The Drafter's `isFollowUpConfirmed` branch looks up `followUpTicketId` from Mongo, so the *previous* row's ticket must still be findable. This couples row order to test outcome. → *Make the follow-up prompt self-contained: run the build_form prompt first, capture its `ticketId`, then run the confirm prompt with `resumeTicketId=<that>` — explicit chaining instead of implicit file order.*

10. **No coverage metric.** There is no notion of "which skills/personas/branches were exercised by the golden set." The Drafter alone has ~12 branches (vague, followup, followup-confirmed, product_guide, general_chat, cancellation, topic-change, rejection, build_form-no-fields, …). → *Add lightweight branch coverage by tagging each golden prompt with the persona-branches it should exercise and reporting % branches hit. This makes "we still don't have a test for the AWAITING_USER_APPROVAL → expiry-throws path" obvious.*

---

### Stage 1 Resolved

Stage 1 (agent v3 defect-fix sprint) resolved the following P0 defects from `plans/agent_upgrade_v3.md`:

| Defect | Description | Resolution |
|---|---|---|
| **D0.1** | Mongo↔Redis state drift | Write Mongo on every transition; Redis is rebuildable hot cache |
| **D0.2** | Lock TTL shorter than worst-case loop | `LOOP_DEADLINE_MS` + `LOCK_TTL_MS` env-driven; lock heartbeat |
| **D0.3** | Replan unreachable; 2nd retry wastes budget | 1st retry → Executor; 2nd → Planner with feedback; 3rd → ask user |
| **D0.4** | Merge stats inflated | Split `mergedForms` into 6 raw counters (`{ mergedForms, mergedViews, updatesApplied, updatesMissed, deletesApplied, deletesMissed }`) |
| **D0.5** | Simulated-offline check not hoisted out of branch logic | Single check at top of `while` loop, before persona dispatch |
| **D0.6** | `llmRawOutput` stored un-redacted in trace | `redactTracePayload` recursive walker: key-based + value-based (email/phone/SSN/credit-card) redaction on `llmRawOutput` |
| **D0.7** | No user-abort signal | `agent:abort:{ticketId}` Redis flag; `AgentCancelledError` → `CANCELLED` ticket status |
| **D0.8** | Drafter prompt rule numbering jumps | JSON prompt renumbered contiguously 1..N |
| **D0.9** | Communicator collapses typed errors to single branch | Branch on each domain error type; set `errorKind` field |
| **D0.10** | Read-only shortcut bypasses trace | Minimal trace step pushed to `state.executionTrace` in Drafter's read shortcut |

**Stage 1 Contracts Frozen:** `redactTracePayload` (Agent D), `stubRunner.registerRow` (Agent D), `MergeStats` (Agent B), `AgentCancelledError` / `CANCELLED` enum (Agent A → Agent C), `MemoryService` interface (Agent C).

---

## Summary of recommended next steps (prioritised)

**Quick wins (1-2 days each, high leverage, low risk):**
- LLMOps #1: capture `usage` tokens into `state.llmUsage` and the Mongo ticket.
- LLMOps #6: redact `llmRawOutput` before it hits the trace/Redis/Mongo.
- Loop #5: hoist the single `simOfflineKey` check out of the branch logic.
- Memory #2: write Mongo on every transition; treat Redis as a rebuildable hot cache.
- Eval #1: audit/fix the golden prompts against the live tool schema; expand to ≥50.

**Medium (≤1 week):**
- Eval #2 + #7: split into mocked-unit (PR-gating) and live-eval (nightly) suites.
- LLMOps #2 + #9: per-persona latency + structured logging (ship to App Insights).
- Loop #1 + #2: `[replan]` escalation after first failed retry; per-skill `maxIterations`.
- Memory #1: per-user recurring-fields memory written back after successful merges.

**Larger (multi-week):**
- LLMOps #5 + #8: versioned prompt registry with per-version golden baselines + streaming Communicator.
- Loop #3 + #4 + #9: loop deadline, lock renewal/heartbeat, user-abort signal.
- Eval #4 + #5 + #6: structural assertions on params/sandbox/reply + negative tests + persisted report history.
