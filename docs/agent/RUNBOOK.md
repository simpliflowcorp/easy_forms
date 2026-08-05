# Easy Forms Agent — Operational Runbook

Practical, day-to-day operations for the agent subsystem (v3). Commands are
verified for this repo; trust these over the README.

---

## 1. Environment

Copy `.env` / `.env.local` from a peer checkout or the deployment config.
Authoritative env sources: `src/dbConfig/dbConfig.ts` (`MONGODB_URI`) and
`src/lib/redis.ts` (`KV_URL`, or `KV_REST_API_URL`/`KV_REST_API_TOKEN` /
`EASY_FORM_KV_*` in non-dev). Other keys: `TOKEN_SECRET`, `NVIDIA_API_KEY`,
`GEMINI_API_KEY`, `LLM_ALLOW_LEGACY_FALLBACK` (off by default),
`APPLICATIONINSIGHTS_CONNECTION_STRING` (opt-in telemetry), `SEMANTIC_CACHE_ENABLED`.

Never commit `.env*`, `*.pem`, `*.tsbuildinfo`, `next-env.d.ts`.

## 2. Local dev

- `npm run dev` — Next dev server + auto-boots a Docker Redis container
  (`easyforms-redis`, port 6379). Docker required. Start it manually with
  `docker start easyforms-redis`.
- `npm run dev:ws` — web + WebSocket server together (`WS_PORT` 3001).
- `npm run worker` — background worker (ts-node).
- `npm run ws:server` — WebSocket server alone.

## 3. Verification commands

| Command | What it does | When |
|---|---|---|
| `npm run lint` | ESLint flat config (`eslint .`). Lints `.js/.mjs/.mjs/.cjs/.jsx` only — TS issues are NOT caught here | every change |
| `npx tsc --noEmit` | TS strict typecheck (the CI `agent-typecheck` job) | every change |
| `npm run build` | Next production build (compiles SCSS + routes) | before push |
| `npm run agent:eval` | **Stubbed PR-gate** eval: mocked LLM, in-memory stores, < 1 s, deterministic, exits non-zero on failure | agent-path PRs (CI runs it) |
| `npm run agent:eval:live` | Nightly live eval: real LLM + Mongo + Redis; writes `tests/agent/eval/reports/<ISO>.json`. `-- --skip` exits 0 without DB/creds | nightly / manual |
| `npm run agent:load` | Multi-agent load test: 100 concurrent executions, 3 SLAs (P99 < 30 s, 0 data loss, 0 auth bypass) | after orchestrator changes |
| `npm run agent:validate-skills` | Skill validator against the Skills Registry | skills changes |
| `npm run agent:migrate` | Ticket migration script (`scripts/migrate-agent-tickets.ts`) | upgrades |

## 4. LLM configuration

- Provider: `LLM_PROVIDER=nvidia` (default) or `google`.
  - nvidia → `https://integrate.api.nvidia.com/v1/chat/completions`
    (default model `meta/llama-3.1-8b-instruct`)
  - google → Gemini OpenAI-compat endpoint (default `gemini-2.0-flash`)
- `LLM_MODEL` (global default) / `LLM_MODEL_DRAFTER|PLANNER|EXECUTOR|
  EVALUATOR|COMMUNICATOR` (per-persona). Temperatures are baked into
  `PERSONA_TEMPERATURES`.
- Timeout `LLM_TIMEOUT_MS` (default 30 s); retry `retries/baseMs/jitterMs`.
- Secondary-provider failover: `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL`,
  `LLM_FALLBACK_API_KEY` — only `LLMOfflineError` triggers it, once per call.
- Legacy Llama text fallback requires `LLM_ALLOW_LEGACY_FALLBACK=1` (CI sets
  `"0"`).

### 4.1 LLMOps tier routing (Stage 4, D-S4.4)

`src/lib/llmClient.ts` exports the frozen Stage 4 contract
`LLMRoutingTier` + `resolveTier` + `callLLMTiered`:

- **Policy** (`resolveTier(persona, ticketCostUsd?, tierHint?)`):
  - `draft` / `communicate` personas route to the **cheap** model by default.
  - `plan` / `verify` personas route to the **strong** model.
  - Escalation: once cumulative `ticketCostUsd > 0.10`, the call escalates to
    the strong ("verify") tier — small-ticket budgets deserve the strong
    model, avoiding cheap-model loops.
- **Env:** `LLM_MODEL_DRAFT_TIER` (cheap, fallback `LLM_MODEL`),
  `LLM_MODEL_VERIFY_TIER` (strong, fallback `LLM_MODEL`),
  `LLM_MAX_TOKENS_DRAFT_TIER` (default 512), `LLM_MAX_TOKENS_VERIFY_TIER`
  (default 1024).
- **Attribution:** `callLLMTiered` bumps the `AgentUsage` row with the `tier`
  field (schema field added by Agent C). The write is fire-and-forget and
  never breaks the hot path.
- **PII:** tier routing never bypasses `redactPII` — redaction is applied by
  the personas upstream of every LLM call; `callLLMTiered` passes messages
  through untouched.
- Personas route via a 1-line passthrough adding `tierHint` (no persona
  signature change).

## 5. Budgets & eviction

- Loop budget `maxIterations = 3` (Executor↔Evaluator). Per-ticket / per-day
  token budgets via `LLMBudgetExceededError`; orchestrator enforces at
  tool-call granularity and checkpoints a `partial` ticket.
- Sandbox TTL `SANDBOX_TTL_SECONDS` (24 h) on
  `sandbox:{userId}:{ticketId}`. An expired sandbox rejects the merge with
  `"Merge rejected: approval session expired or no pending actions."`
- Semantic cache: `SEMANTIC_CACHE_ENABLED=1` (default off), TTL 60 s,
  key `semantic:<sha256(normalized query)>`, per-scope.

## 6. Observability

- Structured logs: pino-shaped JSON lines on stdout with bound context
  `{userId, ticketId, persona, attempt, ms, status, model}`. Create a child
  logger with `child({ ... }).info("turn_start", {...})`.
- Application Insights: set `APPLICATIONINSIGHTS_CONNECTION_STRING` — the
  logger lazily calls `useAzureMonitor()` (auto-tracks HTTP requests +
  dependencies, incl. LLM calls). No-ops when unset; never crashes.
- Cost: `AgentUsage` rows carry `{persona, model, promptTokens,
  completionTokens, totalTokens, costUsd, latencyMs}` (+ `tier` for tiered
  calls); roll up with `src/lib/costCalculator.ts` `usageSummary(userId)`
  (per-day + per-provider).
- Reports history: `tests/agent/eval/reports/*.json`; diff two runs with
  `tests/agent/eval/diffReports.js`; drift with `nightlyDrift.ts`.

### 6.1 OTel optionalDependencies + one-time live-trace verification (D-S4.1)

The Application Insights runtime deps are **optionalDependencies**:
`@opentelemetry/api@^1.9.1` + `@azure/monitor-opentelemetry@^1.19.0`. The
local `TelemetryApi` type shim in `src/lib/logger.ts` is the type-level
fallback (tsc stays green even when the deps are absent); the npm install is
the runtime source-of-truth.

Install (fresh environment):

```bash
npm ci                          # installs the optionalDependencies too
npm ls @opentelemetry/api @azure/monitor-opentelemetry
```

One-time live-trace verification (closes the v3 §0.🟡#4 gap — run ONCE on
Azure infra with a real connection string, then ad hoc when telemetry is
suspected):

```bash
# 1. deps installed + env set  -> useAzureMonitor() registers a real
#    provider and a real span is created (with a REAL connection string this
#    span lands on the App Insights resource):
APPLICATIONINSIGHTS_CONNECTION_STRING="<real>" node --experimental-strip-types \
  tests/agent/eval/otelTraceVerify.ts --expect-init

# 2. env unset -> no-op (existing behaviour):
APPLICATIONINSIGHTS_CONNECTION_STRING= node --experimental-strip-types \
  tests/agent/eval/otelTraceVerify.ts --expect-noop

# 3. deps absent (simulated)  -> require() catches -> no-op (existing behaviour):
node --experimental-strip-types tests/agent/eval/otelTraceVerify.ts --expect-missing-deps
```

All three checks must PASS. With a real connection string, verify the span
shows up under *Application Insights → Transaction search* for the
`easy-forms-agent` tracer / `log` span name.

## 7. Deploy / CI

CI is `.github/workflows/agent-eval.yml`:

- `agent-eval` (PR/push gate): stub suite, `npm run agent:eval`. Must stay
  deterministic and fast.
- `nightly-live-eval` (D-S4.2, schedule `0 3 * * *` + `main` push): live suite
  with Mongo + Redis + `NVIDIA_API_KEY`; runs `npm run agent:eval:live`
  (runner.ts → liveSuite.ts), writes `tests/agent/eval/reports/<ISO>.json`,
  then diffs tonight's report against the previous one with
  `tests/agent/eval/diffReports.js` — the job FAILS only on real regressions
  (rows that passed before and fail now); a first run / changed row set skips
  the gate. Artifacts: `tests/agent/eval/reports/**` (7-day retention).
- `agent-typecheck`, `agent-lint` run on every PR.
- `secret-scan.yml` enforces no committed secrets.

Reading the nightly diff (`.github/workflows/agent-eval.yml` → *Baseline diff*
step): `regressions` are rows that passed in the previous run and fail now
(real model/contract drift — these fail CI); `new failures` are newly-added
rows that fail (still a diff flag, but often a new test's first run);
`new passes` are rows that recovered. Idempotency is guaranteed by the stub
suite (deterministic) and by `diffReports` keying on row ids — two runs of the
same suite show `✅ No regressions — diff is clean`.

To skip live eval on a non-agent PR:
`npm run agent:eval:live -- --skip` (writes a `*-skip.json` report, exit 0).

## 8. Skills operations

- Built-ins: `src/agent/skills/registry.json` (read-only via the UI).
- User skills: `AgentSkillModel`; managed via `AgentSkillsDrawer` (list /
  test / edit → version bump / delete → soft-delete).
- API: `GET|POST /api/agent/skills`, `PUT|DELETE /api/agent/skills/[id]`.
- Validation: each definition must satisfy the frozen `SkillDefinition` shape
  (`name`, `tools[]`, `maxIterations`, `negativeTests[]`). New constructors
  must go through `makeSkillDefinition` (Agent C's factory) so the
  `requiredParams`/`optionalParams` drift class can't recur.

### 8.1 Skill `assert` grammar (Stage 4 eval() removal — D-S4.5 docs)

`negativeTests[].assert` is **no longer evaluated with `eval()`**. It is
either:
- a **function** `(ctx: NegEvalContext) => boolean` (server-side authored
  only, never user-supplied), or
- a **constrained expression string** parsed by Agent B's `safeAssert.ts`
  (`evalNegativeTest`) — allowed grammar: `actionPlan` / `state` references,
  numbers, strings, `.length`, `.params.X`, `[index]`, comparisons
  (`>=` `>` `<=` `<` `===` `!==` `==` `!=`), `&&` `||` `!`, parens. Everything
  else is rejected (no `require`/`import`/`eval`/`Function`,
  no `process`/`globalThis`/`window`).

**For skill authors:** keep asserts to the grammar above; a malformed assert
(`"actionPlan[;]"`) is rejected at validation time with a parse-error reason —
it never crashes the evaluator. `npm run agent:validate-skills` surfaces
unparseable asserts (non-zero exit).

## 9. Feature flags

| Flag | Effect |
|---|---|
| `AGENT_V3_ENABLED` | route agent tickets through the legacy → Orchestrator shim |
| `SEMANTIC_CACHE_ENABLED` | Redis semantic cache on read/analytics prompts |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights telemetry |
| `AGENT_REDACT_VALUES` | value-based PII redaction (default off) |
| `LLM_ALLOW_LEGACY_FALLBACK` | Llama text fallback (default off) |
| `LLM_V3_*` | per-persona model overrides |
| `LLM_MODEL_DRAFT_TIER` / `LLM_MODEL_VERIFY_TIER` | cheap/strong tier models (D-S4.4) |
| `LLM_MAX_TOKENS_DRAFT_TIER` / `LLM_MAX_TOKENS_VERIFY_TIER` | tier max tokens (D-S4.4) |

### 9.1 `AGENT_V3_ENABLED` drain procedure (Stage 4, D-S4.5 — ref. Agent A's memo)

The hierarchical Orchestrator path is the v3 ship state; the legacy shim
(`src/agent/orchestrator/legacyShim.ts`, gated by `AGENT_V3_ENABLED`) exists
only to drain in-flight tickets. Procedure:

1. Query prod `agentTicketModel` for in-flight legacy tickets:
   `status in [AWAITING_USER_APPROVAL, EXECUTOR_SANDBOX, PLANNER]` with
   `createdAt < <v3 ship-tag date>` (see Agent A's Stage 4 log for the exact
   query + expected counts).
2. If **zero** rows: the drain is complete — schedule the follow-up PR that
   deletes `legacyShim.ts` + the `AGENT_V3_ENABLED` switch in the execute
   route.
3. If rows remain: keep the shim; do NOT delete while
   `AWAITING_USER_APPROVAL`/`EXECUTOR_SANDBOX` tickets exist (their sandbox
   namespaces are legacy-keyed).
4. Do NOT flip the default back to `false` — the pin is `true` (Orchestrator
   is the v3 ship state; `false` exists for emergency rollback only).