# Easy Forms Agent — Implementation Plan (v2, grounded against current `src/`)

This document supersedes the previous `implementation_plan.md` and incorporates the architecture
synthesis captured in `MLLE.md` (Memory / Loop / LLMOps / Eval). It was regenerated after a full
audit of the live codebase on **2026-08-02** to reflect what has actually shipped, not what one of
the two older planning documents (`AGENT_REFACTOR_PLAN.md`, `AGent_refactor_plan.md`) assumed was
still pending.

## How this plan was derived

Every claim below was verified against the codebase. A "DONE" / "PARTIAL" / "OPEN" tag is attached
to each item so sequencer/ticket triage doesn't re-do work. Verification evidence is in
`updates/execution_log.md` (sibling file) under the same bullet IDs.

- **DONE** — code is in `src/` and matches the spec; only follow-on hygiene remains.
- **PARTIAL** — the item shipped for the primary path but has a known residual gap (called out).
- **OPEN** — no code exists for this item.
- **STALE** — the original spec item is void because the design shifted (recorded for traceability).

## What shipped already (verified)

Part A of the prior plan is essentially **landed**:

- **P0-1 DONE** — `src/lib/llmHealthMonitor.ts:37` uses `process.env.NVIDIA_API_KEY` with no
  inline fallback; `.env.example:17` has the empty placeholder. `grep -rn "nvapi-" src/` is empty.
- **P0-2 DONE** — `src/lib/agentTools.ts:21-85` defines `resolveFormIdFilter(userId, queryFormId,
  targetCollection)` handling both ObjectId and hashed `formId` shapes; applied to all three
  branches (Form / CustomView / Response) at `agentTools.ts:131-188`.
- **P1-R2 DONE** — `agentTools.ts:95-99` throws for `create_form` / `update_form` /
  `delete_form` with the exact error string from the spec; only `run_database_query` remains.
- **P1-E1 DONE** — `src/agent/personas/evaluator.ts:52, 122, 145` route both deterministic-precheck
  retries and the LLM-QA `shouldRetry` branch to `activePersona: "EXECUTOR_SANDBOX"` with
  `evaluatorFeedback`. Planner is no longer re-engaged on retry.
- **P1-M1 DONE** — `src/agent/sandbox/sandboxMerge.ts:44-50` takes the `snapshot` as a parameter;
  the caller reads it once before `session.withTransaction`.
- **P1-R1 DONE** — `src/agent/agentLoop.ts:225-245` reads `updatesMissed + deletesMissed` from
  `mergeStats` and appends the warning to `state.reply`; `MergeStats` is typed in
  `sandboxMerge.ts:35-42`. (P3-M4 merges as the same deliverable.)
- **P2-D1 DONE** — `src/agent/helper/validate.ts` defines `parsePersona` + `EvaluatorOutputSchema`
  (used in `evaluator.ts:99`); `zod` is in the dependency tree.
- **P2-D2 DONE** — `agentLoop.ts:122-146` writes Mongo first then `agentRedis.saveState`;
  `markResolved` (`:78-96`) is Mongo-first-then-`clearState`. Both carry the "Mongo is authoritative;
  Redis is a resume cache" comment (`:124`).
- **P2-D3 DONE** — `agentLoop.ts:99-120` defines `shouldPersistToMongo` and
  `compressTraceForMongo`; only DRAFTER / AWAITING_USER_APPROVAL / LLM_ERROR / REJECTED / RESOLVED
  persist. (TTL index on `AgentTicket.createdAt` is **OPEN** — see Open items.)
- **P2-5 DONE** — `src/agent/helper/redact.ts` is the single shared module with the full key list
  (`email`, `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`, `zip`, `postcode`,
  `ip_address`, `user_agent`); both `evaluator.ts:4,81,82` and `communicator.ts:3,18,19` import it.
  Value-based redaction (`AGENT_REDACT_VALUES=1`) is implemented at `redact.ts:24-31`.
- **P2-6 DONE** — `communicator.ts:74-81` handles `LLMOfflineError` → `state.ticket.status =
  "LLM_ERROR"`, clears `isComplete`, returns the offline reply; `agentLoop.ts:461-469` checks
  `state.ticket.status === "LLM_ERROR"` and keeps the ticket alive via `persistStateToRedis`.
- **P2-7 DONE** — `.github/workflows/secret-scan.yml` exists alongside `agent-eval.yml`.
- **P3-M2 DONE** — `grep -c "state!" src/agent/agentLoop.ts` returns `0`.
- **P3-M3 DONE** — the `sandboxStore.ts` façade is gone; `src/agent/sandbox/` contains only
  `agentLock.ts`, `agentRedis.ts`, `sandboxMerge.ts`, `sandboxRedisStore.ts`. Callers use
  `sandboxRedisStore` directly.
- **P3-M5 DONE** — `src/app/api/agent/execute/route.ts:64` logs
  `console.warn("[agent] JWT verification failed", err?.name, err?.message)`.

Identified residual P0 hygiene gap (the plan missed one spot):

- **P0-3 PARTIAL** — `agentLoop.ts:389` and `simulate-offline/route.ts` correctly use the
  per-ticket `agent:simulated_offline:{ticketId}` key only. But **`src/lib/llmHealthMonitor.ts:25`**
  still reads the bare *global* `agent:simulated_offline` key. A stale global key would still force
  the broadcast status to "offline" even though the loop and toggle endpoint honour per-ticket
  only. The acceptance criterion "no bare `agent:simulated_offline` reference remains in `src/`"
  was not met. Fix below as **OPEN-1**.

Part B partial landings (worth carrying forward as in-flight, not new starts):

- **R0.3 DONE** — `.github/workflows/agent-eval.yml` runs on PR + nightly, sources `MONGODB_URI`,
  `TOKEN_SECRET`, `NVIDIA_API_KEY` from secrets. `tests/agent/eval/runner.ts` + `golden-prompts.jsonl`
  (15 expected, 14 on disk — see **OPEN-7**) exist.
- **R0.2 PARTIAL** — `src/lib/wsServer.ts` (306 lines) authenticates via JWT in the query string,
  maintains `connections: Map<userId, Set<WSClient>>`, 30s heartbeat, and routes
  `mergePidlish`/`prompt`/`resume` messages into `runAgentLoop`. **What's missing**: WS still runs
  side-by-side with the SSE `health-stream` route (no migration of health to WS `pong`), and
  `src/app/api/agent/execute/route.ts` still owns the primary streaming surface.
- **R3.2 PARTIAL** — `llmClient.ts:109` sets `stream: !!options.onChunk`; `delta.content` chunks
  are surfaced via `options.onChunk` (`:169, :202`); `agentLoop.ts:381-385` wires `state.onChunk`
  per persona; `communicator.ts:60` consumes it. **What's missing**: WS server to relay these
  chunks as `{type:"token"}` messages is not yet wired end-to-end through the UI hook.

Items confirmed **NOT STARTED** (grep evidence in `execution_log.md`):

- **R0.1** (no `/api/health/mongo` replica-set probe — though a `mongo` dir exists under `api/health`).
- **R1** (no `READ_ONLY_SKILLS`, no Drafter short-circuit, no `isReadOnly` flag on `AgentState`).
- **R2** (no `AgentUsage` model, no `tokenUsage` on `AgentState`, no `LLMBudgetExceededError`).
- **R4** (no read/write lock separation in `agentLock.ts`).
- **R5** (no `conversationHistory` on `AgentState`).
- **R7** (no `src/agent/prompts/v1/*.json`; prompts still inline in `prompts.ts`).
- **R8** (no `/api/agent/presets` route).
- **R9 / R10** (trace dedup, load/chaos/canary — none present).

---

# Critical path

```
OPEN-1 (claude P0-3 leak in health monitor) ──► OPEN-2 (TTL index)
        │
        └─► P-Cleanup (completeness: read-only tools, evaluator negative eval, etc.)
                    │
                    ├──► R0.1 (mongo replica-set verify) ──┐
                    │                                       │
                    ├──► R1.1 (read shortcut) ──► R4 (lock separation)
                    │
                    ├──► R2 (token/cost tracking) ──► R8.2 (budget UI)
                    │
                    ├──► R3.3 (client migration to WS) ─► R3.4 (reconnection) ──► R10.2 (chaos)
                    │
                    ├──► R5 (conversationHistory)
                    │
                    ├──► R6 (eval harness hardening)
                    │
                    └──► R7 (prompt versioning) ──► R8.1 (presets API)
```

R0.1 is the only hard prerequisite left, and it only gates R1 (the merge transaction already
runs in-flight against a replica-set-assumed connection — see `sandboxMerge.ts:23-27`). If the
prod `MONGODB_URI` is standalone, traffic is already taking the `PendingMerge` fallback branch.
R0.1 just makes that explicit with a health probe.

---

# Part A-residual — finish the cleanup

Sequencing note: these are small, independent, and shippable in one short PR sweep. They close
out the prior plan's Definition of Done without re-doing anything.

## OPEN-1 — Strip the global `simulated_offline` key from `llmHealthMonitor.ts` — **CLOSED 2026-08-02**
- **File**: `src/lib/llmHealthMonitor.ts` (was lines 23-32)
- **Problem**: P0-3 removed the global-key read in `agentLoop.ts` and `simulate-offline/route.ts`
  but this file still had `const isSimulatedOffline = await pubClient.get("agent:simulated_offline");`.
  A stale global key silently broadcast `{status:"offline"}` to all clients even though no path
  could set/unset the global key (the toggle endpoint requires `ticketId`).
- **Change applied**: dropped the global-key block; replaced with a comment block explaining
  per-ticket simulated offline lives only in `agentLoop.ts` and intentionally does not affect the
  global health broadcast.
- **Acceptance met**: `grep -rn 'simulated_offline' src/lib/llmHealthMonitor.ts` empty; the bare
  `agent:simulated_offline` reference is finally gone from `src/`. P0-3 acceptance criterion satisfied.

## OPEN-2 — Add the deferred TTL index on `AgentTicketModel` — **CLOSED 2026-08-02 (was already DONE)**
- **File**: `src/models/agentTicketModel.ts:33-42`
- **Reality**: the TTL index is already present: `createdAt` indexed with
  `expireAfterSeconds: 30*24*3600` and a partial filter
  `{ status: { $nin: ["RESOLVED"] }, activePersona: { $nin: ["AWAITING_USER_APPROVAL"] } }`.
  Option (a) from the plan shipped; the option-(b) "expiresAt field" avoid-the-partial-footgun
  recommendation was noted but not taken.
- **Acceptance**: 35-day-old transient tickets reaped automatically; `RESOLVED` /
  `AWAITING_USER_APPROVAL` kept indefinitely. No further action. Plan corrected not to re-do it.

## OPEN-3 — Lint pipeline is broken (Next 16 + ESLint 10 flat-config)
- **Files**: `package.json` (`lint` script), new `eslint.config.mjs`.
- **Problem**: `npm run lint` runs `next lint`, which on Next 16 reports
  "Invalid project directory provided, no such directory: .../lint". Raw `npx eslint` reports
  "ESLint couldn't find an eslint.config.(js|mjs|cjs) file" (ESLint 10 dropped legacy
  `.eslintrc.*` support). The project has `eslint-config-next` available; just lacks wiring.
- **Change**: add a flat-config `eslint.config.mjs` extending `eslint-config-next`; rewrite the
  `lint` script to `eslint .` (or `next`'s lint-subcommand if Next 16 fixes it later). This
  un-blocks the Definition of Done clause `npm run lint` clean.
- **Acceptance**: `npm run lint` exits 0 on the current tree (the two pre-existing `tsc` errors
  in `evaluator.ts:100` and `page.tsx:50` are TypeScript, not lint — separate R-phase fixes).

## P-Cleanup — Three small drift fixes the prior plan didn't name but the audit surfaced

### P-Cleanup #1 (Planner tool catalog) — **CLOSED 2026-08-02 (option B)**
- **File**: `src/agent/prompts.ts:60`
- **Problem (deeper than originally scoped)**: `agentToolsSchema` (only 4 tools) /
  `prompts.ts:60` (11 tools) / `permissions.ts:71-83` `TOOL_TO_SCOPE` (11 tools) /
  `guidelines.md` (11 tools) all advertise the same set outward, BUT the executor
  (`executor.ts:65`) only routes `create_form`/`update_form`/`delete_form` to the sandbox
  mutation branch; `query_responses`/`generate_analytics`/`create_custom_view`/etc. fall through
  to `executeAgentTool` which throws "Unknown or unauthorized tool action" in the `default` case.
  So those 6 tools are *permitted-at-the-permission-gate but unimplemented in the dispatch*. The
  loop burns 3 retries then tells the user "could you rephrase?" — a confusing UX, not a crash.
- **Change applied (option B, low blast radius)**: rewrote `prompts.ts:60` from the 11-tool
  laundry list to: "The Executor currently dispatches ONLY: create_form, update_form,
  delete_form, run_database_query. All other read needs (responses, analytics, custom views) MUST
  be expressed as a run_database_query against the Form / Response / CustomView collection."
  The LLM now never plans tools that have no executor branch. (The originally-considered option
  A — extending `agentToolsSchema` to declare the missing 6 — was attempted and rolled back:
  advertising tools that fail at runtime is strictly worse than honestly omitting them.)
- **Acceptance met**: Planner no longer advertises unimplementable tools. Logs / golden prompts
  using those tool names now plan an equivalent `run_database_query` instead.
- **Residual gap (deferred → see R8.X below)**: the actual executor branches for
  `query_responses`/`generate_analytics`/`create_custom_view`/`update_custom_view`/
  `delete_custom_view`/`get_custom_views` are still missing. When they land, flip the prompt
  back to advertise them.

### P-Cleanup #2 (Agent.md redaction list) — **CLOSED 2026-08-02**
- **File**: `src/agent/Agent.md:158`
- **Change applied**: replaced the stale "strips `ip_address`/`user_agent`" sentence with the
  full list matching `src/agent/helper/redact.ts:10-22`: `ip_address`, `user_agent`, `email`,
  `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`, `zip`, `postcode`; plus the
  `AGENT_REDACT_VALUES=1` value-based redaction knob and the "key-name-only, not full PII
  classifier" disclaimer.
- **Acceptance met**: `Agent.md` matches `redact.ts`.

### P-Cleanup #3 (AGENT-OVERVIEW.md global-key sentence) — **CLOSED 2026-08-02**
- **File**: `docs/agent/AGENT-OVERVIEW.md:109`
- **Problem**: claimed the health monitor "Also honours `agent:simulated_offline:{ticketId}`"
  — false before AND after OPEN-1: the monitor only ever read the bare *global* key, never the
  per-ticket key. Now that OPEN-1 stripped the global-key read entirely, the monitor only emits
  real NVIDIA-probe statuses.
- **Change applied**: rewrote the sentence to "Per-ticket simulated offline is honoured only
  inside `agentLoop.ts` and the toggle endpoint — it intentionally does **not** influence the
  global health broadcast, which reflects the real NVIDIA probe."

---

# Part B — Refactor phases (the genuine remaining work)

The prior plan's R0–R10 map is retained below; only the deltas against what's actually landed are
recorded. Anything not flagged as DONE/PARTIAL above is OPEN.

## R0 — Foundation (≤0.5w)

### R0.1 MongoDB Replica-Set Verification — OPEN
- Confirm `MONGODB_URI` points at a replica set (`rs0/...` or `?replicaSet=`); run `rs.status()`.
- If standalone: confirm the `PendingMerge` fallback (`sandboxMerge.ts:33, Pv111`) is the only
  code path taken in prod, and add a startup assertion in `dbConfig/dbConfig.ts` that logs the
  topology. **Why now**: M1's transaction (`session.withTransaction`) actually throws on a
  standalone today — there's no precondition check.
- Add `src/app/api/health/mongo/index.ts` (folder exists but route may not) returning
  `{ readyState, isMaster, replicaSet }`; wire it into `llmHealthMonitor.ts` broadcast so the
  client can surface "agent offline" when Mongo drops out of primary quorum.

### R0.2 WS Server Scaffold — PARTIAL, see above
- Finish the WS→`exec` glue: replace the SSE `health-stream` consumer with WS `pong` +
  `agent:llm_health` Redis subscribe → `broadcast`.
- Promote `wsServerEntry.ts` from a side process to the Next.js custom server path so it shares
  the HTTP listener (currently the dev script runs `concurrently "next dev" "ws:server"`).

### R0.3 Eval Pipeline — DONE (golden set sparse, see R6.1)

## R1 — Parallel Read Path (2w) — OPEN
Pure `STAGE_1` reads (`run_database_query` for `Form`/`Response`/`CustomView`,
`generate_analytics`, `query_responses`, general chat) today burn Drafter → Planner → Executor →
Evaluator → Communicator — 4+ LLM calls. The P0-2 / P1-R2 fixes that the original plan required
as a precondition have shipped, so R1 is unblocked.

- **R1.1** — in `personas/drafter.ts`, after classification:
  - if `READ_ONLY_SKILLS.has(skill)` (`build_form`? read meta; the canonical set lives in
    `skills.md` and should be mirrored in a new `src/agent/policy/permissions.ts`
    `READ_ONLY_SKILLS` constant — `general_chat`, `filter_responses`,
    `generate_analytics_skill`, plus the four custom-view read variants), call
    `executeAgentTool("run_database_query", params, userId)` directly, build a minimal
    `AgentState` with `activePersona: "COMMUNICATOR"`, `isComplete: true`, `isReadOnly: true`,
    return. Skip Planner/Executor/Evaluator entirely.
  - **Quirk to fix concurrently**: the planner's `agentToolsSchema` (P-Cleanup #1) must match
    what read tools the drafter emits, otherwise the function-caller will reject.
- **R1.2** — Communicator read-mode: detect `state.isReadOnly === true` → render the markdown
  table / CSV already specified in `communicator.ts:44-46` (the rule is already there) and skip
  the "form created" prose preamble. The current code already does this implicitly; needs an
  explicit branch + trace marker `DRAFTER → COMMUNICATOR (read shortcut)` so the eval runner can
  assert no Planner call.
- **R1.3** — golden test: 3 prompts ("how many forms", "show responses for form X", "analytics
  for form Y"); assert latency ratio ≥3× and `iterationCount === 1`.

## R2 — Token / Cost Tracking (2w) — OPEN (highest-leverage LLMOps gap from MLLE)
MLLE flagged that `data.usage` is discarded entirely; confirmed (`grep` for `usage` /
`tokenUsage` / `AgentUsage` all empty). Nothing today prevents a single user from exhausting
NVIDIA/Gemini quota for everyone — only the per-user rate limit (P2-4 DONE) bounds request count,
not token cost.

- **R2.1** — `retryLLM`/`callOnce` in `src/lib/llmClient.ts` returns `{ content, raw, usage:
  { promptTokens, completionTokens, totalTokens, model } }`; provider-specific parsing (NVIDIA
  `usage`, Gemini `usageMetadata`).
- **R2.2** — new `src/models/AgentUsage.ts`:
  `{ ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, timestamp,
  costUsd }` (per-call rows). Aggregate field on `AgentState.tokenUsage = { total, byPersona,
  estimatedCost }`; persisted via `persistStateToRedis` when it changes (bonus: leverages the
  P2-D3 throttle).
- **R2.3** — budget guardrails:
  - env `LLM_TOKEN_BUDGET_PER_TICKET` (default 50000), `LLM_TOKEN_BUDGET_PER_USER_DAY`
    (default 200000).
  - Pre-check before each persona call: today's user usage → throw `LLMBudgetExceededError`
    (new sibling of `LLMOfflineError`); the Evaluator surfaces "please rephrase with fewer
    details" and the loop routes to `COMMUNICATOR` (mirror the existing `LLMOfflineError`
    branches already in `evaluator.ts:106`, `communicator.ts:74`).
- **R2.4** — admin dashboard: `src/app/api/admin/agent/usage/route.ts` per-user / per-day /
  per-model breakdown; admin page or extension of `/app/agent` with charts. Required for incident
  response (see R10.4).

## R3 — WebSocket Transport (finish, ~1w) — PARTIAL
Only R3.2 (token streaming in `llmClient`) and the WS server scaffolding (R0.2) have landed.

- **R3.1** — ensure WS server's per-persona `onChunk` relays as `{type:"token",
  payload:{persona, token}}`. Verify the message protocol from the original plan (prompt/merge/
  resume/state/token/busy/error/done/pong) is implemented in `wsServer.ts`.
- **R3.3** — client hook `src/hooks/useAgentWS.ts` exists (verified) — finish the reconnection +
  state-replay logic, then switch `AgentVisualizer` from `fetch + EventSource` to it. SSE
  fallback if WS fails after 3 retries. Deprecate `/api/agent/health-stream` cleanly (delete the
  route once WS `pong` + `agent:llm_health` broadcast covers the same surface).
- **R3.4** — reconnect: send `{type:"resume", payload:{ ticketId: lastTicketId }}`; server resumes
  from the last `executionTrace` index when `activePersona !== "MERGED_TO_PRODUCTION"`; client
  replays missed trace entries from `localStorage` backup.

## R4 — Lock Separation (1w) — OPEN
`agentLock.ts` currently has a single write lock; R1's parallel read path benefits nothing without
it.

- **R4.1** — split per user: `agent_lock:write:{userId}` (mutations, existing 60s TTL held full
  loop) and `agent_lock:read:{userId}` (reads, `SET NX PX 5000` released after the dispatch).
- **R4.2** — readers with distinct `reqId` coexist; a writer drains readers via TTL wait.
- **R4.3** — test: 1 write + 3 reads concurrent → reads parallel, write serialised, no sandbox
  races (sandbox is per-user; reads don't mutate).

## R5 — Multi-Turn Conversation State (2w) — OPEN
MLLE correctly notes the only context window today is the 3-ticket `recentTickets` pull in
`drafter.ts:28` — there is no `conversationHistory` to feed the persona prompts.

- **R5.1** — `AgentState.conversationHistory = { role:"user"|"assistant", content, ticketId,
  timestamp }[]` capped at `MAX_HISTORY = 10`; append the user prompt each loop invocation; append
  the Communicator's final reply.
- **R5.2** — Planner prepends last 3 assistant turns as "Recent context:"; Evaluator includes
  history in the QA payload; Communicator uses history to avoid repeating itself (already half-
  done via `recentTickets` in `communicator.ts:56`). The fields are different: `recentTickets` is
  *prior tickets*, `conversationHistory` is *this ticket's* turns.
- **R5.3** — resume loads `conversationHistory` from Mongo (already part of `AgentState`); Drafter
  reads both.

## R6 — Eval Harness Hardening (2w) — OPEN (R6.1 needs the eval-runner overhaul from real→stub stack)
Current state (`runner.ts`): runs against real Mongo + Redis + LLM, creates a `eval@test.local`
user, counts binary pass — exactly the fragilities MLLE flagged.

- **R6.1** — golden-set expansion to target 50 prompts (currently 14 on disk; spec said 15 —
  reconcile). Add adversarial: cross-tenant `form_id` injection (already asserts P0-2), prompt
  injection, ReDoS regex in `run_database_query` filters. Add negative "should NOT be complete"
  prompts (MLLE's gap #4).
- **R6.2** — stub-stack mode:育苗 the `runAgentLoop` to use in-memory Mongo (e.g. `mongodb-memory-server`)
  + stub `retryLLM` returning fixtures. Add `tests/agent/eval/stubRunner.ts`; keep the real-stack
  runner gated behind `agent:eval:real` for nightly only. This eliminates CI flakiness + token
  cost and removes side effects (real user, real form creation).
- **R6.3** — assert per-call: `params` correctness (not just `tool` names), sandbox shape,
  `reply` semantics (no leaked PII in `data.*`), evaluator retry routing `EVALUATOR →
  EXECUTOR_SANDBOX` not `→ PLANNER` (carries Part A contract P1-E1 forward in regression).
- **R6.4** — metrics: per-prompt latency p50/p95, tokens/prompt, iteration-count distribution;
  persist run reports to `tests/agent/eval/reports/<date>.json` (MLLE gap #5).
- **R6.5** — nightly drift: run golden set against current + candidate model versions; alert on
  `isComplete` rate drop, tool-sequence divergence.

## R7 — Prompt Versioning + A/B (1.5w) — OPEN
Prompts are still inline `DRAFTER_SYSTEM_PROMPT` etc. strings in `src/agent/prompts.ts`
(`grep` for `src/agent/prompts/v1/` returns nothing).

- **R7.1** — extract each persona `*_SYSTEM_PROMPT` to
  `src/agent/prompts/v1/{drafter,planner,evaluator,communicator}.json` with `{ systemPrompt,
  version, outputSchema }`; `prompts.ts` becomes `loadPrompt(version, persona)`.
- **R7.2** — A/B router: env `AGENT_PROMPT_VERSION=v1`, feature flag `AGENT_PROMPT_AB=v2:0.1`,
  per-user cookie override; metrics tracked per version once R2 lands.

## R8 — Presets + Budget UI (1.5w) — OPEN
- **R8.1** — custom presets CRUD: `src/app/api/agent/presets/route.ts` (`POST`/`GET`/`DELETE`);
  schema `{ label, prompt, tags[] }`; "Save as preset" button in the `AgentVisualizer` sidebar.
  No presets route today (`ls src/app/api/agent/` returns only `execute`, `health-stream`,
  `simulate-offline`).
- **R8.2** — token-budget progress bar in `AgentVisualizer` header; warning toast at 80%, hard
  stop at 100% (built on R2.3); admin bypass env `AGENT_BUDGET_BYPASS_USERS`.

## R-Executor-Tools — Implement the advertised-but-missing tool executor branches (~1w) — OPEN
Surfaced by P-Cleanup #1: 6 tools are *permitted-at-permission-gate* and described in
`guidelines.md` / advertised in `prompts.ts:60`, but `executor.ts` has no dispatch branch for
them — they fall through to `executeAgentTool` which throws "Unknown or unauthorized tool
action". Until this lands, the Planner prompt (P-Cleanup #1) defers LLMs to express these as
`run_database_query` workarounds. When R-Executor-Tools ships, flip `prompts.ts:60` back to the
full tool list.

- **R-Executor-Tools.1** — `query_responses` / `generate_analytics` / `get_custom_views` (the
  three read tools): implement as thin wrappers in `executor.ts:159`'s read branch that translate
  to a `run_database_query` against the appropriate collection (Form / Response / CustomView)
  with the right shape, so the LLM can use the higher-level tool name without manual SQL
  translation. They go through `sandboxRedisStore.setQueryResult` like existing read tools.
- **R-Executor-Tools.2** — `create_custom_view` / `update_custom_view` / `delete_custom_view`
  (the three mutating tools): mirror the `update_form` / `delete_form` sandbox-mutation pattern
  at `executor.ts:117-145`. Save `saveCustomViewIntention` / `saveDeleteCustomViewIntention` in
  `sandboxRedisStore` (parallel to existing `saveUpdateIntention`), keyed by an idempotency key
  on the CustomView collection. **`sandboxMerge.ts`** needs a `mergeViews` extension that applies
  these intentions inside the same `session.withTransaction`, **after** the existing
  `mergeFormsAndIntents` completes (so the per-user write lock is still the only concurrency
  story). Apply `expectedUpdatedAt` optimistic concurrency on the CustomView collection too.
- **R-Executor-Tools.3** — schemas: after the executor branches land, **extend
  `agentToolsSchema`** (`src/agent/tools.ts`) to declare all 6 tools (the addition I attempted and
  rolled back in the patch session). Then revert `prompts.ts:60` to advertise the full list.
- **R-Executor-Tools.4** — golden prompts (R6): add 6 positive prompts, one per tool, asserting
  the right tool name lands in `actionPlan` (not a `run_database_query` workaround).
- **Acceptance**: each of the 6 tools has a green golden prompt; a custom-view create/update/
  delete round-trips to production through the sandbox merge; the Planner is unhindered from
  picking the natural tool name.

## R9 — Trace Optimization + Docs (1w) — OPEN
- **R9.1** — `addTrace` stores `actionPlanRef: stepId` of the Planner's trace entry instead of
  embedding the full `actionPlan` again; client resolves references when expanding the log. Today
  `agentLoop.ts:427` embeds the entire `actionPlan` then Evaluator returns it again (`:435`) —
  2× duplication inside the capped 50-entry trace.
- **R9.2** — sync docs: drop the "remodel notes" appendix in `Agent.md`, make the canonical code
  state authoritative; `guardrails.md` adds R1 read-path + R4 lock invariants + R2 budget
  invariants; `RUNBOOK.md` (new) covers LLM-out, budget-exceeded, stuck-lock, merge-conflict
  playbooks; `docs/agent-architecture.md` Mermaid diagram (the doc currently lives only as
  `docs/agent/AGENT-OVERVIEW.md` — promote it + append the diagram).

## R10 — Hardening & Release (1w) — OPEN
- **R10.1** — k6 load test: 50 concurrent users, mixed read (post-R1 1 LLM call) + write (3+ LLM
  calls) for 10 min; targets p99 < 15s streaming, 0% data loss, < 1% lock contention.
- **R10.2** — chaos tests: kill LLM mid-request → R3.4 client reconnect; kill Mongo primary →
  replica-set failover + R0.1 health probe surfaces it; fill Redis → eviction doesn't drop active
  sandbox (verify the TTL on `sandboxRedisStore` is long enough that eviction hits the *next*
  sandbox, never the live one — this is the one genuinely dangerous Redis-induced data loss
  class); network partition → WS reconnect replay.
- **R10.3** — canary: 5% → 25% → 100% over 3 days; monitor error rate, latency, token cost
  (R2), user-satisfaction (toast dismiss rate).
- **R10.4** — runbook drills: LLM outage, budget alert, stuck lock (`PERSIST agent_lock:write:*`
  mid-loop with no expiry), merge-conflict, cross-tenant test probe — walked by 2 engineers
  independently.

---

# Out-of-band (not code, but listed for completeness — gate real deployment)

- **P0-1 follow-up**: rotate the NVIDIA key that was historically committed. Not a code task,
  but a hard prerequisite for *"the exposed key is dead"* regardless of how clean the repo now is.
- Audit `.env` vs `.env.example` — `.env`, `.env.local` both exist in the workspace root and are
  gitignored, but worth confirming they are not committed historically (run `git log --all --
  .env .env.local` before the rotation lands; the docs already warn but no enforcement exists).

---

# Definition of Done

- [x] **OPEN-1**: `grep -rn 'simulated_offline' src/lib/llmHealthMonitor.ts` empty. *(CLOSED 2026-08-02 patch.)*
- [x] **OPEN-2**: TTL index live; 35-day-old `PROCESSING` ticket reaped. *(CLOSED — was already implemented at `agentTicketModel.ts:33-42`. Plan corrected.)*
- [x] **OPEN-3**: `npm run lint` works (adds `eslint.config.mjs`, switches the `lint` script from
      `next lint` to `eslint .`). *(CLOSED 2026-08-02 — though with caveats: TS 7 is not supported
      by `typescript-eslint` yet, so the flat-config file lints ONLY `.js`/`.mjs`/`.cjs`/`.jsx`
      (~7 files); `.ts`/`.tsx` linting is deferred until `typescript-eslint` ships
      TS 7 support — `typescript-eslint#10940`. Type correctness is owned by `tsc --noEmit`.)*
- [x] **Pre-existing TSC errors fixed** — `evaluator.ts:100` (Zod `null`-optional fields not
      matching the stale hand-written `EvaluatorVerdict` interface; replaced interface with
      `type EvaluatorVerdict = EvaluatorOutput` from `validate.ts`) and `page.tsx:50`
      (`prev possibly null` rewritten as a defensive `prev !== null && prev?.persona === ...`
      guard before reaching `prev.content`). *(CLOSED 2026-08-02.)*
- [x] **P-Cleanup #1** (option B): `prompts.ts:60` honest about runtime tool dispatch; LLM no longer
      plans unimplemented tools. The deeper exec gap is deferred to **R-Executor-Tools**. *(CLOSED 2026-08-02.)*
- [x] **P-Cleanup #2**: `Agent.md:158` redaction list matches `redact.ts` + documents
      `AGENT_REDACT_VALUES=1`. *(CLOSED 2026-08-02.)*
- [x] **P-Cleanup #3**: `AGENT-OVERVIEW.md:109` no longer misattributes per-ticket simulated offline
      to the global health monitor. *(CLOSED 2026-08-02.)*
- [ ] **R0.1**: `/api/health/mongo` returns topology + replica-set status.
- [ ] **R1**: p95 read latency < 3s (was ~8s); `iterationCount === 1` for STAGE_1.
- [ ] **R2**: per-call usage persisted; per-ticket + per-day budget enforced; admin dashboard live.
- [ ] **R3**: WS reconnect < 2s median; SSE `health-stream` deleted; per-persona token streaming
      through the UI.
- [ ] **R4**: 1 writer + 3 readers — no read/read serialization.
- [ ] **R5**: `conversationHistory` populated end-to-end; Communicator stops repeating itself.
- [ ] **R6**: stub-stack runner is CI-default; 50 golden prompts; adverse-prompt regression
      fails CI; nightly drift report persisted. Includes a regression test asserting
      `EVALUATOR → EXECUTOR_SANDBOX (not PLANNER)` so a silent evaluator.ts regression fails CI.
- [ ] **R7**: prompts loaded from `v1/*.json`; A/B flag works; per-version metrics visible.
- [ ] **R8**: presets CRUD + budget progress bar.
- [ ] **R-Executor-Tools**: 6 advertised-but-missing executor branches (3 read wrappers + 3
      sandbox-mutation paths); extended `agentToolsSchema`; `prompts.ts:60` reverted to advertise
      the full list once branches land.
- [ ] **R9**: actionPlan duplication removed; docs single-source-of-truth; RUNBOOK drills defined.
- [ ] **R10**: load / chaos / canary reports; runbook drills passed by 2 engineers independently.
- [x] `npm run typecheck` clean (NEW script added; the two pre-existing `tsc` errors fixed today);
      `npm run lint` exits 0 cleanly (= OPEN-3, with `.ts`/`.tsx` lint deferred to upstream);
      `grep -rn 'nvapi-' src/` empty.

# Sequencer (1–2 engineers, ~10–12w remaining)

- **Wk 1 (cleanup)**: ~~OPEN-1, OPEN-2, P-Cleanup in one PR sweep~~ ✅ landed 2026-08-02.
  Add OPEN-3 (lint config) as a same-day follow-up. Rotate NVIDIA key out-of-band (still pending).
- **Wk 1–2**: R0.1 verify; start R2.1 (the highest-leverage single gap; gates R8.2 and feeds
  R6.2 metrics).
- **Wk 2–4**: R1 (read shortcut) in parallel with R7.1 (prompt extraction) — both are pure-code
  refactors with no runtime infra need.
- **Wk 4–5**: R-Executor-Tools (the custom_view/analytics executor branches; depends on R1's
  read-path refactor since some `run_database_query` workarounds will be retired) alongside
  R2.3 + R2.4 (budget enforcement + dashboard) finish R2; R6.2 (stub-stack runner).
- **Wk 5–6**: R3 (finish WS + client migration + reconnection); close R3.4.
- **Wk 6–7**: R4 (lock separation) — depends on R1's `READ_ONLY_SKILLS`; land the test first.
- **Wk 7–9**: R5 (conversationHistory) + R6.1 (50-prompt golden set) + R6.3 (assertions).
- **Wk 9–10**: R8 (presets + budget UI); R9 (trace dedup + docs + RUNBOOK).
- **Wk 10–12**: R10 (load → chaos → canary → drill) — gate releases on green.

Shipping contract: every item is independently revertable; every item has a unit/integration test
named in its bullet. R-phase PRs without an eval-side regression (R6) are blocked.
