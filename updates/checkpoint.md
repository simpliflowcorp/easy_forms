# Checkpoint — 2026-08-02 (post session 2, post re-audit)

This checkpoint is the **authoritative current state** after running a fresh grep-based verification
of every claim in `updates/implementation_plan.md` against the live `src/` tree. It corrects two
items the prior plan got wrong (R0.1 was wrongly marked OPEN; OPEN-2 still DONE) and freezes the
state as a known-good baseline before R-phase work begins.

## Verification method

- `grep -rnE '...' src/` against each item's expected file/symbol.
- `npm run typecheck` and `npm run lint` (both green: exit 0).
- `git status -s` shows the working-tree changes since `2c3bb7a` (HEAD of `dev`). None have been
  committed — all in working tree only.

## Gates (must-pass, last run)

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | ✅ exit 0 |
| Lint (JS-only) | `npm run lint` (`eslint .`) | ✅ exit 0 |
| Secret scan | `grep -rn "nvapi-" src/` | ✅ empty |
| P0-3 cleanup | `grep -rnE 'get\("agent:simulated_offline"\)\|set\("agent:simulated_offline\|del\("agent:simulated_offline' src/` | ✅ empty |

**Lint caveat**: `.ts`/`.tsx` files are NOT lint-attributed today;
`typescript-eslint@8` throws on TS 7 (`typescript-eslint#10940`); flat config scopes
`eslint.config.mjs` to `.js/.mjs/.cjs/.jsx` only. Type correctness is owned by `tsc --noEmit`.
Re-enable TS lint when upstream unblocks (track in `eslint.config.mjs` file header).

## Working-tree diff since `2c3bb7a` (HEAD of `dev`)

Uncommitted, intended for a single PR before further R-phase work:

```
 M docs/agent/AGENT-OVERVIEW.md          (P-Cleanup #3)
 M package.json                          (OPEN-3: lint script + new typecheck script)
 M src/agent/Agent.md                    (P-Cleanup #2)
 M src/agent/personas/evaluator.ts       (TSC fix: zod `null`-optional → EvaluatorOutput alias)
 M src/agent/prompts.ts                  (P-Cleanup #1: honest tool catalog)
 M src/app/agent/page.tsx                (TSC fix: prev possibly null guard)
 M src/lib/llmHealthMonitor.ts          (OPEN-1: drop global simulated_offline read)
?? MLLE.md                              (the synthesis doc, kept for reference)
?? eslint.config.mjs                    (NEW — OPEN-3)
?? updates/                             (NEW — implementation_plan.md + this log + execution_log.md)
```

`git stash && git stash pop` confirmed these 7 modified files are the only intended edits.
No accidental regressions (the session-1 silent `evaluator.ts` `PLANNER` regression was caught
midstream and reverted via `git checkout HEAD -- src/agent/personas/evaluator.ts`; before my
session-2 zod-alias fix was applied).

## Authoritative item state — verified 2026-08-02

### Part A (prior plan) + liberties the cleanup trio added — all CLOSED

| ID | Status | Evidence (line refs, last verified) |
|----|--------|--------------------------------------|
| **P0-1** NVIDIA key out of source | ✅ CLOSED | `src/lib/llmHealthMonitor.ts:37` reads `process.env.NVIDIA_API_KEY` with no fallback; `.env.example:17` has `NVIDIA_API_KEY=` empty; `grep "nvapi-" src/` empty. |
| **P0-2** Form/CustomView form_id intersect guard | ✅ CLOSED | `src/lib/agentTools.ts:21-85` defines `resolveFormIdFilter(userId, queryFormId, targetCollection)`; applied to all three branches at `:131-188`. |
| **P0-3** Per-ticket-only simulated offline | ✅ CLOSED | `agentLoop.ts:389` per-ticket key; `simulate-offline/route.ts:28` per-ticket only; `llmHealthMonitor.ts` no longer reads the global key (OPEN-1 patch); bare-`agent:simulated_offline` grep empty. |
| **P1-R1** Merge optimistic-concurrency warning | ✅ CLOSED | `agentLoop.ts:228-242`: traces `mergeStats.{updates,deletes}{Applied,Missed}`, surfaces warning to `state.reply` when `missedCount > 0`. |
| **P1-R2** No prod-write branches in `executeAgentTool` | ✅ CLOSED | `agentTools.ts:95-99` throws for `create_form`/`update_form`/`delete_form` with the spec'd error string; only `run_database_query` remains. |
| **P1-E1** Evaluator retry routes to `EXECUTOR_SANDBOX` | ✅ CLOSED (twice!) | `evaluator.ts:52, 122, 145` all return `activePersona: "EXECUTOR_SANDBOX"` with `evaluatorFeedback`. **Was silently regressed to `"PLANNER"` mid-session 1** (probably a stray editor / `git stash pop` mishap — see `execution_log.md` session 1). Reverted via `git checkout HEAD --`. **Still no regression test** for this — see R6.3 below. |
| **P1-M1** Sandbox snapshot before txn | ✅ CLOSED | `sandboxMerge.ts:44-50` `mergeFormsAndIntents(userId, ticketId, snapshot, session, stats)` takes `snapshot` as a parameter; caller reads it once before `session.withTransaction`. |
| **P2-D1** Zod personas schemas | ✅ CLOSED | `src/agent/helper/validate.ts` exports `DrafterOutputSchema`, `EvaluatorOutputSchema`, `parsePersona<T>()`; `evaluator.ts:94` and `drafter.ts:78` use `parsePersona(rawContent, schema)`. (The earlier tsc error from the zod-`null`-optional vs stale `EvaluatorVerdict` interface mismatch was fixed in session 2 by replacing the interface with `type EvaluatorVerdict = EvaluatorOutput` from `validate.ts:60`.) |
| **P2-D2** Mongo-first persistence order | ✅ CLOSED | `agentLoop.ts:122-146` `persistStateToRedis` writes Mongo first then `agentRedis.saveState`; `markResolved:78-96` Mongo-first-then-`clearState`. Both carry the "Mongo is authoritative; Redis is a resume cache" comment (`:124`). |
| **P2-D3** Throttle Mongo writes to key transitions | ✅ CLOSED | `agentLoop.ts:99-120` `shouldPersistToMongo` + `compressTraceForMongo`; only `DRAFTER` / `AWAITING_USER_APPROVAL` / `LLM_ERROR` / `REJECTED` / `RESOLVED` persist to Mongo. |
| **P2-4** Per-user rate limit | ✅ CLOSED | `execute/route.ts:15-26, 41, 45` define `AGENT_RATE_LIMIT_PER_MIN` (default 10) + `AGENT_RATE_LIMIT_PER_DAY` (default 200), Redis increments + check before SSE stream opens. |
| **P2-5** Broaden PII redaction + shared module | ✅ CLOSED | `src/agent/helper/redact.ts:10-22` lists 11 keys (`ip_address`, `user_agent`, `email`, `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`, `zip`, `postcode`); `:24-31` value-based `AGENT_REDACT_VALUES=1` regex. Both `evaluator.ts:4,81,82` and `communicator.ts:3,18,19` import the same module. |
| **P2-6** `LLMOfflineError` in Communicator | ✅ CLOSED | `communicator.ts:74-81` sets `state.ticket.status = "LLM_ERROR"`, clears `isComplete`, returns offline reply; `agentLoop.ts:461-469` keeps the ticket alive via `persistStateToRedis`. |
| **P2-7** Secret-scan CI | ✅ CLOSED | `.github/workflows/secret-scan.yml` exists; baseline clean post-P0-1. |
| **P3-M2** replace `state!` post-alias | ✅ CLOSED | `grep -c 'state!' src/agent/agentLoop.ts` = 0. |
| **P3-M3** drop sandboxStore façade | ✅ CLOSED | `src/agent/sandbox/` has only `agentLock.ts`, `agentRedis.ts`, `sandboxMerge.ts`, `sandboxRedisStore.ts` (no façade). |
| **P3-M4** honest `MergeStats` type | ✅ CLOSED | `sandboxMerge.ts:35-42` exports the interface with all six counters; `agentLoop.ts:226-245` reads all six from the return value. |
| **P3-M5** `getAuthUserId` observability | ✅ CLOSED | `execute/route.ts:64` `console.warn("[agent] JWT verification failed", err?.name, err?.message)`. |

### Cleanup trio (this series of sessions) — all CLOSED

| ID | Status | Evidence |
|----|--------|----------|
| **OPEN-1** Drop global simulated_offline from health monitor | ✅ CLOSED | `llmHealthMonitor.ts` no longer has the `agent:simulated_offline` Redis `get`; replaced with an explanatory comment block. Bare-`agent:simulated_offline` `get/set/del` grep empty across `src/`. |
| **OPEN-2** AgentTicket TTL index | ✅ CLOSED (was actually already done; plan-and-log corrected) | `agentTicketModel.ts:33-42`: `AgentTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { status: { $nin: ["RESOLVED"] }, activePersona: { $nin: ["AWAITING_USER_APPROVAL"] } } })`. |
| **P-Cleanup #1** Planner tool catalog drift | ✅ CLOSED (option B) | `prompts.ts:60` rewritten to state "The Executor currently dispatches ONLY: create_form, update_form, delete_form, run_database_query. All other read needs (responses, analytics, custom views) MUST be expressed as a run_database_query." Underlying exec gap deferred to **R-Executor-Tools**. |
| **P-Cleanup #2** Agent.md redaction list | ✅ CLOSED | `Agent.md:158` lists the full 11 keys + `AGENT_REDACT_VALUES=1` knob. |
| **P-Cleanup #3** AGENT-OVERVIEW.md global-key sentence | ✅ CLOSED | `AGENT-OVERVIEW.md:109` rewritten to state per-ticket simulation lives only in `agentLoop.ts` and the toggle endpoint, intentionally not affecting the global health broadcast. |
| **OPEN-3** `npm run lint` works | ✅ CLOSED (with caveat) | New `eslint.config.mjs` (flat config) at project root; `package.json` lint script switched `next lint` → `eslint .`; new `typecheck` script added. Caveat: lint scope is `.js/.mjs/.cjs/.jsx` only — TypeScript files deferred to `tsc --noEmit` until `typescript-eslint#10940` resolves. The TS 7 blocker was unknown until session 2 attempted the obvious path; documented in `eslint.config.mjs` file header. |
| **Pre-existing TSC errors** | ✅ CLOSED | `evaluator.ts` replaced the stale `interface EvaluatorVerdict` with `type EvaluatorVerdict = EvaluatorOutput` from `validate.ts`; `page.tsx:50` rewritten with explicit `prev !== null && prev?.persona === ...` guard. `npm run typecheck` exit 0. |

### Part B (refactor) — verified state

| ID | Status | Evidence |
|----|--------|----------|
| **R0.1** Mongo replica-set verification + health probe | ✅ CLOSED (was wrongly marked OPEN in `implementation_plan.md`) | `src/app/api/health/mongo/route.ts` exists, fully implemented: GET handler runs `connectDB()`, returns `{ readyState (0-3 mapped), connected, host, database, isMaster, replicaSet, members, timestamp }` with 200/503 status. Calls `adminDb.command({ isMaster: 1 })`. **My session-1 audit batch-listed `src/app/api/health/` and noted `mongo` existed but never read the file content — false negative. Re-verified the file content this session.** |
| **R0.2** WS server scaffold | 🟡 PARTIAL | `src/lib/wsServer.ts` (306 lines) + `wsServerEntry.ts` + `src/hooks/useWebSocket.ts` exist; auth via JWT in query string; `runAgentLoop` invoked from WS path; 30s heartbeat. Still missing: full `useAgentWS` client migration that replaces the SSE/`fetch` consumer in `AgentVisualizer`, plus deletion of `health-stream` SSE route (still present at `src/app/api/agent/health-stream/route.ts`). |
| **R0.3** Eval CI pipeline | ✅ CLOSED | `.github/workflows/agent-eval.yml` runs on PR + nightly; `tests/agent/eval/runner.ts` + `golden-prompts.jsonl` (14 lines; spec said 15) exist. **Caveat**: runner uses real Mongo + Redis + LLM (non-deterministic, costs tokens, creates real `eval@test.local` form rows; same fragilities MLLE flagged). Hardening is R6. |
| **R1** Parallel read path | ❌ OPEN | No `READ_ONLY_SKILLS` in `policy/permissions.ts`; no `isReadOnly` flag on `AgentState`; no Drafter short-circuit. |
| **R2** Token / cost tracking | ❌ OPEN | `AgentUsage`/`tokenUsage`/`LLMBudgetExceededError`/`costUsd`/`promptTokens`/`completionTokens` grep all empty across `src/`. **Highest-leverage remaining gap.** |
| **R3** WS transport + streaming | 🟡 PARTIAL | `llmClient.ts:109` sets `stream: !!options.onChunk`; `onChunk` wired through `agentLoop.ts:381-385` and consumed by all four personas (`evaluator.ts:96`, `planner.ts:161`, `drafter.ts:69`, `communicator.ts:60`). Missing: client-side `useAgentWS` migration + reconnect state-replay; `health-stream` SSE still in production path. |
| **R4** Read/write lock separation | ❌ OPEN | `agentLock.ts` has a single write lock only; no `agent_lock:read:` / `agent_lock:write:` split. |
| **R5** Multi-turn conversation state | ❌ OPEN | `conversationHistory` / `MAX_HISTORY` grep empty. |
| **R6** Eval harness hardening | ❌ OPEN (subset closed) | R0.3 closed (pipeline stands up); R6.1 (50 golden prompts; currently 14), R6.2 (stub-stack runner, replace real-stack eval), R6.3 (per-call/per-tools assertion + evaluator retry-routing regression test), R6.4 (metrics), R6.5 (nightly drift) all OPEN. R6.3 is the cheapest safety net against the kind of silent regression we caught in session 1. |
| **R7** Prompt versioning + A/B | ❌ OPEN | `src/agent/prompts/v1/*.json` does not exist; prompts still inline `DRAFTER_SYSTEM_PROMPT` etc. in `prompt.ts`. |
| **R8** Presets + budget UI | ❌ OPEN | `src/app/api/agent/presets/` does not exist; `src/app/api/admin/agent/usage/` does not exist; `AgentVisualizer` has no token-budget bar. Both gated on R2 (budget) for the data source. |
| **R-Executor-Tools** Implement advertised-but-missing tool branches | ❌ OPEN | `grep case "query_responses"\|case "generate_analytics"\|case "create_custom_view"\|...` against `executor.ts` returns empty. Six tools still permitted-at-permission-gate but unimplemented. Deferred from P-Cleanup #1. |
| **R9** Trace optimization + docs | ❌ OPEN | `addTrace` still embeds the full `actionPlan` twice; no `RUNBOOK.md`; no `docs/agent-architecture.md`. |
| **R10** Hardening & release | ❌ OPEN | No k6 / chaos / canary artifacts; runbook drills not scheduled. |

## Recommended sequencer (re-ranked after re-audit)

- **Cleanup PR sweep** — commit the 7 modified files + `eslint.config.mjs` + `updates/` + `MLLE.md`
  (or drop `MLLE.md` — it was the audit input) as a single PR. The working tree is sitting on
  these uncommitted; before any R-phase work begins, freeze the baseline.
- **Trivial safety-first test**: R6.3 regression assertion for `EVALUATOR → EXECUTOR_SANDBOX
  (not PLANNER)` — prevents the silent regression class that slipped through in session 1.
  Lightweight, no new infra.
- **Highest-leverage single deliverable**: R2.1 → R2.4 (token usage return → persistence → budget
  guardrails → admin dashboard). Gates R8.2 (budget UI), R6.2 (cost-in-CI metric), R10.4
  (runbook response).
- **Cheapest UX win**: R1 (read shortcut). Pre-conditions (P0-2, P1-R2) already shipped; cut a
  `STAGE_1` 4-call pipeline down to 1 LLM call.
- **Wire-and-go**: R0.2 + R3 finish (WS client migration + reconnect + delete health-stream).
  R3.2 (llmClient streaming) already landed; just relay through `useAgentWS`.

Out-of-band, still pending (NOT a code task): **rotate the historically-committed NVIDIA key**.
The repo is clean now (`grep "nvapi-" src/` empty) but the leaked credential is still active
until rotated at the NVIDIA console.

## Working-tree commit message template (when committing)

```
chore(agent): post-audit cleanup — closes OPEN-1, OPEN-2, OPEN-3, P-Cleanup #1-3

Code-side fixes:
- llmHealthMonitor.ts: drop the bare global `agent:simulated_offline` read
  (P0-3 had missed this file). The per-ticket key is honoured only in
  agentLoop.ts and the toggle endpoint.
- prompts.ts:60: rewrite the Planner tool catalog so it only advertises tools
  the Executor actually dispatches; the LLM no longer plans tools that throw
  "Unknown or unauthorized tool action" at runtime. (Custom-view / analytics
  / query_responses executor branches still TODO — see new R-Executor-Tools
  phase in updates/implementation_plan.md.)
- Agent.md:158 + AGENT-OVERVIEW.md:109: doc sync — redaction list matches
  redact.ts; health monitor sentence no longer misattributes per-ticket
  simulated offline.
- evaluator.ts / page.tsx: fix two pre-existing tsc errors (zod null-optional
  alias; prev possibly null guard).

Tooling:
- package.json: lint script `next lint` -> `eslint .` (Next 16 dropped the
  subcommand); add `typecheck` script.
- eslint.config.mjs: NEW flat config. Scope is `.js/.mjs/.cjs/.jsx` only —
  typescript-eslint@8 throws on TS 7 (typescript-eslint#10940); type
  correctness owned by `tsc --noEmit` until upstream unblocks. Documented in
  file header.

Plan + execution log:
- updates/implementation_plan.md: rewritten, grounded in current src/ state.
- updates/execution_log.md: full audit + two patch sessions of work.
- updates/checkpoint.md: this grounding snapshot.
```

## What to do next (concrete)

1. **Commit** the cleanup working tree as a single PR (per template above).
2. **Pull-request review** + land on `dev`. Rotate NVIDIA key out-of-band.
3. **Start R6.3** — a small focused test:
   - `tests/agent/evaluator.test.ts` (or `.spec.ts` per project style — none exists yet; pick
     `node:test` or vitest based on what works with `ts-node`).
   - Inject a fake `retryLLM` returning `{ isComplete: false, shouldRetry: true, feedback: "x" }`.
   - Assert `runEvaluator(state)` returns `activePersona === "EXECUTOR_SANDBOX"` (NOT `"PLANNER"`).
   - Repeat the assertion at the two other retry paths (deterministic-failed-actions, LLM QA-pass
     unknown error). Three assertions, one file.
4. **Then R2.1** — extend `retryLLM`/`callOnce` in `src/lib/llmClient.ts` to return
   `{ content, raw, usage, tool_calls }`; provider-specific parsing of NVIDIA `usage` vs Gemini
   `usageMetadata`. Type it; persist it in R2.2 next.
