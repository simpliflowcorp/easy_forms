# Easy Forms Agent — Architecture (v3)

_Status: Stage 3 (multi-agent orchestration shape, LLMOps, UI + docs)._

This document describes the agent subsystem's architecture: surfaces, roles,
execution flow, persistence, LLMOps wiring, and how the v3 definition-of-done
items (§11 of `plans/agent_spec.md`) map to shipped code. Companion docs:
`API.md` (tool + HTTP API reference), `RUNBOOK.md` (operations),
`TROUBLESHOOTING.md` (diagnostics), `AGENT-OVERVIEW.md` (memory / loop /
LLMOps / eval analysis).

---

## 1. Two surfaces

The agent lives on **two surfaces** that share contracts but are separate
trees:

| Surface | Path | Purpose |
|---|---|---|
| **Web app** | `src/app/**` (`(client)/(mainpath)` authed, `(client)/(publicPath)` public, `api/**` REST, WebSocket server `src/lib/wsServer.ts`) | Form builder + the agent's chat/visualizer UI (`AgentVisualizer`, `AgentSidebarDrawer`, `AgentSkillsDrawer`) |
| **Agent subsystem** | `src/agent/**` | The persona loop, sandbox, policy, skills, memory, orchestrator (Stage 3) |

Business logic for routes lives in `src/service/**` / `src/models/**`
(Mongoose models, one per file, PascalCase default export). React components
NEVER touch Mongoose directly.

## 2. Persona roles

The Stage-1/2 linear loop is `Drafter → Planner → Executor → Evaluator →
Communicator`. Stage 3 promotes this into an **Orchestrator** with a DAG
Planner, a `Critic` role (Evaluator rebranded), and role-specialised
executors:

| Role | Stage 3 identity | Responsibility |
|---|---|---|
| Drafter | `personas/drafter.ts` | Intent classification, skill resolution, follow-up detection, requirement extraction |
| Planner | `personas/planner.ts` + `orchestrator` DAG | Produces `ExecutionPlan` (tasks + dependency/conditional edges) |
| Executor | `executors/{base,forms,responses,views,generic}.ts` | Sandbox-queues mutations, performs reads, dispatches via role allow-lists |
| Critic | `critic/index.ts` (Evaluator persona name kept for traces) | Pre-flight schema/tenant/tool-hallucination checks + post-flight adversarial review → `CriticVerdict` |
| Communicator | `personas/communicator.ts` | Streams user-facing reply via `callLLMStream` |
| Skill Author | `personas/skillAuthor.ts` | Off-loop; authors `SkillDefinition`s persisted to `AgentSkillModel` |

## 3. Execution flow (v3 Orchestrator)

`Orchestrator.execute()` (see `pi_agent_upgrade_v3.md` §4.3):

```
acquire per-execution lock agent_lock:{userId}:{executionId}
  → budget pre-flight (budget.ts)
  → memory context assembly (memory.assembleContext)
  → PLAN (DAG planner)
  → CRITIC pre-flight
  → EXECUTE topologically (role executors, sandbox-queued)
  → CRITIC post-flight
  → AWAITING_USER_APPROVAL → MERGE (Mongo txn, idempotent)
  → LEARN (memory indexing)
  → RESPOND (streamed)
    → checkpoints written after each successful task (replay.ts)
```

Legacy tickets resume through `orchestrator/legacyShim.ts` while
`AGENT_V3_ENABLED` is set; the linear path remains the fallback.

### Parallelism & locking

- Per-**execution** Redis lock `agent_lock:{userId}:{executionId}` (A-S3.7) —
  concurrent executions for the same user are allowed, one lock per run.
- Sandbox drafts are namespaced `sandbox:{userId}:{executionId}` for future
  multi-intent tickets; `sandbox:{userId}:{ticketId}` (the legacy key) is
  preserved for single-intent tickets.
- Executor↔Evaluator loop budget capped at **3 iterations**; `Critic` owns
  `AWAITING_USER_APPROVAL`; only the Communicator renders.

## 4. Hard invariants (unchanged)

1. **Responses are strictly read-only** — `allowedOperations`
   (`find|findOne|countDocuments|aggregate`) only; never write/mutate/delete a
   `Response` document.
2. **Sandbox isolation first** — all mutations queue drafts in Redis
   (`sandboxRedisStore`) and merge only on user **Confirm & Merge** via a
   Mongo transaction with `$setOnInsert` idempotency on `(user,
   agentIdempotencyKey)` + `expectedUpdatedAt` optimistic concurrency. The
   Executor NEVER writes production Mongo directly.
3. **Human approval** — destructive ops (`delete_form`, custom-view deletes,
   DB drops, force pushes) require explicit consent (and `destructive_actions`
   scope defaults to denial).
4. **Strict JSON** — personas exchange JSON; `safeJSON`
   (`src/agent/helper/jsonParse.ts`) preserves the parse contract.
5. **Authz on tenant** — form lookups always intersect the owning user's form
   IDs; never trust a bare `form_id`.
6. **Budget** — token budgets enforced at tool-call granularity
   (`orchestrator/budget.ts`); reaching the cap yields `BudgetExceededError`,
   a partial-`status` ticket checkpoint, and released lock.

## 5. Persistence map

| Store | Location | Kind |
|---|---|---|
| Tickets | `AgentTicketModel` | Mongo (authoritative) |
| Agent state (resume cache) | `agentRedis` `agent_state:{ticketId}` | Redis |
| Sandbox drafts | `sandboxRedisStore` `sandbox:{userId}:{ticketId}` (24h TTL) | Redis |
| Executions | `OrchestratorExecutionModel` (executionId, taskStates, checkpoints, auditLog) | Mongo |
| Checkpoints | `OrchestratorCheckpointModel` (taskStateSnapshot, sandboxSnapshotSha256) | Mongo |
| Audit | `OrchestratorAuditModel` (+ existing `AgentAuditEvent`) | Mongo |
| Skills | `AgentSkillModel` (user skills; soft-delete via `deprecatedAt`, `versionChain`) | Mongo |
| Usage/cost | `AgentUsage` (persona, model, tokens, costUsd, latencyMs) | Mongo |
| Memory | `src/agent/memory/**` (`service`, `compaction`, `context`, `vector`, `preferences`, `procedural`) | Mongo + (Vector) Atlas |

## 6. LLMOps layer (Agent D, `src/lib/`)

| Module | Role |
|---|---|
| `llmClient.ts` | `retryLLM` (bounded retry/backoff, typed errors, secondary-provider fallback on `LLMOfflineError`), `callLLM`, **`callLLMStream`** (streaming + fail-open non-stream fallback), per-persona model/temperature resolution (`LLM_MODEL_<PERSONA>`) |
| `logger.ts` | Structured JSON-line logger with **named child loggers** (`child({userId, ticketId, persona})`) + Azure Application Insights adapter (`useAzureMonitor`, env-gated) |
| `costCalculator.ts` | `computeCostUsd`, `priceFor(provider, model)`, `usageSummary(userId)` (per-day + per-provider) |
| `semanticCache.ts` | Opt-in Redis semantic cache (`SEMANTIC_CACHE_ENABLED`), TTL 60s, graceful miss |
| `llmHealthMonitor.ts` | 10s provider health probe, pub/sub `agent:llm_health` |

## 7. Eval strategy (PR-gating vs nightly)

- **PR gate:** `npm run agent:eval` = `tests/agent/eval/stubRunner.ts`
  (mocked LLM via `__testRetryLLMOverride`, in-memory stores, ~0.5 s,
  deterministic, 84+ rows, branch coverage). Runs in CI on every agent path
  change.
- **Nightly:** `npm run agent:eval:live` = `tests/agent/eval/runner.ts` →
  `liveSuite.ts` (real LLM + Mongo + Redis), writes timestamped reports to
  `tests/agent/eval/reports/`, supports `-- --skip` to pass CI without creds.
- **Load:** `npm run agent:load` = `tests/agent/multi-agent/load_test.ts`
  (100 concurrent executions; P99 < 30 s, 0 data loss, 0 auth bypass).

## 8. Definition-of-done mapping (§11 of `agent_spec.md`)

| # | DoD item | Where it lives |
|---|---|---|
| 1 | 28-tool catalog, gated, golden + negative coverage | `tools.ts`, `policy/permissions.ts` (B), `golden-prompts.jsonl` + `negative-prompts.jsonl`; doc coverage in `API.md` |
| 2 | Every mutation routed through sandbox; transactional merge with idempotency | `sandbox/sandboxMerge.ts`, `sandboxRedisStore` |
| 3 | Budget/deadline/abort/replan gates in code; loop cannot run past `LOOP_DEADLINE_MS` | `orchestrator/budget.ts`, `agentLoop.ts` (`LOOP_DEADLINE_MS`), `agent:abort:*` + `AgentCancelledError`, Evaluator→Planner replan |
| 4 | Memory persists recurring fields/skill stats/failures; Drafter reads at ticket start | `memory/preferences.ts`, `memory/procedural.ts`, `AgentSkillUsageModel`, Drafter recent-context query |
| 5 | User can author/edit/delete a skill; usable by Skill Router | `AgentSkillsDrawer` + `/api/agent/skills/*` (D, this stage), `AgentSkillModel`, `personas/skillRouter.ts` |
| 6 | Stub eval PR-gating & deterministic; live eval nightly & drift-reporting | `stubRunner.ts`, `runner.ts`/`liveSuite.ts` + `reports/`, `diffReports.js`, `nightlyDrift.ts`, `.github/workflows/agent-eval.yml` |
| 7 | Per-persona latency/tokens/cost in `AgentUsage` + admin visibility | `llmClient` usage capture, `agentUsageModel`, `costCalculator.usageSummary` |
| 8 | lint + tsc + build + `agent:eval` all pass in CI | `.github/workflows/agent-eval.yml` (`agent-typecheck`, `agent-lint`, `agent-eval`) |
| 9 | §1.1 invariants preserved; negative suite verifies | `negative-prompts.jsonl`, `stubRunner` negative rows, multi-agent load-test negative intents |

## 9. Directory map (Stage 3 delta)

```
src/lib/                     llmClient, logger, costCalculator, semanticCache, redis, wsServer
src/agent/
  orchestrator/              loop, lock, budget, audit, legacyShim, replay, visualize   (A)
  critic/                    Critic role                                                   (A)
  executors/                 base + forms/responses/views/generic                         (A)
  personas/                  drafter, planner, executor, evaluator, communicator, skillAuthor, skillRouter
  skills/                    loader, registry.json, validator, types                      (B)
  policy/                    permissions.ts + permissions.json                            (B)
  sandbox/                   sandboxRedisStore, sandboxMerge, agentLock, types
  memory/                    service, compaction, context, vector, preferences, procedural (C)
  helper/                    jsonParse, validate, redact
src/service/                 agentSkillsService                                           (D)
src/models/                  AgentTicket, AgentUsage, AgentSkill, Orchestrator* (A/C)
src/app/api/agent/           execute, abort, presets, simulate-offline, skills/*          (D owns skills)
src/components/              AgentVisualizer, AgentSkillsDrawer, ActionBar/*              (D)
tests/agent/eval/            stubRunner, runner, liveSuite, fixtures, reports, diffReports
tests/agent/multi-agent/     load_test.ts                                                (D)
```