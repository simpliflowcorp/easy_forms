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
  completionTokens, totalTokens, costUsd, latencyMs}`; roll up with
  `src/lib/costCalculator.ts` `usageSummary(userId)` (per-day + per-provider).
- Reports history: `tests/agent/eval/reports/*.json`; diff two runs with
  `tests/agent/eval/diffReports.js`; drift with `nightlyDrift.ts`.

## 7. Deploy / CI

CI is `.github/workflows/agent-eval.yml`:

- `agent-eval` (PR/push gate): stub suite, `npm run agent:eval`. Must stay
  deterministic and fast.
- `agent-eval-live` (schedule + `main`): live suite with Mongo + Redis +
  `NVIDIA_API_KEY`; runs `npm run agent:eval:live`.
- `agent-typecheck`, `agent-lint` run on every PR.
- `secret-scan.yml` enforces no committed secrets.

To skip live eval on a non-agent PR:
`npm run agent:eval:live -- --skip` (writes a `*-skip.json` report, exit 0).

## 8. Skills operations

- Built-ins: `src/agent/skills/registry.json` (read-only via the UI).
- User skills: `AgentSkillModel`; managed via `AgentSkillsDrawer` (list /
  test / edit → version bump / delete → soft-delete).
- API: `GET|POST /api/agent/skills`, `PUT|DELETE /api/agent/skills/[id]`.
- Validation: each definition must satisfy the frozen `SkillDefinition` shape
  (`name`, `tools[]`, `maxIterations`, `negativeTests[]`).

## 9. Feature flags

| Flag | Effect |
|---|---|
| `AGENT_V3_ENABLED` | route agent tickets through the legacy → Orchestrator shim |
| `SEMANTIC_CACHE_ENABLED` | Redis semantic cache on read/analytics prompts |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights telemetry |
| `AGENT_REDACT_VALUES` | value-based PII redaction (default off) |
| `LLM_ALLOW_LEGACY_FALLBACK` | Llama text fallback (default off) |
| `LLM_V3_*` | per-persona model overrides |