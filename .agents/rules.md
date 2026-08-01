# Easy Forms Agent — Development Rules & Conventions

**Version:** 2.0 (Post Part A Hardening + R0 Foundation)  
**Updated:** 2026-08-01  
**Scope:** All agent-related code under `src/agent/`, `src/lib/llmClient.ts`, `src/lib/agentTools.ts`, `src/app/api/agent/`, `tests/agent/`, and supporting infrastructure (`src/lib/wsServer.ts`, `src/models/AgentTicketModel.ts`, etc.)

---

## 1. Architecture Principles

| Principle | Enforcement |
|-----------|-------------|
| **Mongo is authoritative; Redis is a resume cache** | Every state transition writes Mongo first, then Redis. If Mongo fails, Redis is never updated. See `persistStateToRedis` in `agentLoop.ts`. |
| **Sandbox isolation** | Mutations (`create_form`, `update_form`, `delete_form`) NEVER touch production directly. They queue drafts/intentions into Redis sandbox (`sandboxRedisStore`). Merge to production only via `mergeSandboxToProduction` inside a Mongo transaction (or `PendingMerge` fallback). |
| **Per-user locking** | `acquireAgentLock(userId, ticketId)` held for entire `runAgentLoop` execution. Concurrent calls throw `AgentBusyError` (HTTP 409 or SSE `busy` event). |
| **Optimistic concurrency** | Updates/deletes carry `expectedUpdatedAt`. Merge checks `updatedAt` match; misses are audited as `concurrency_miss`. |
| **Idempotency** | Every draft/intention has `idempotencyKey` (format: `idem_<timestamp>_<random>`). Re-merge with same key is a no-op via `$setOnInsert`. |
| **Tenant isolation** | All queries filtered by `userId`. `resolveFormIdFilter()` in `agentTools.ts` handles both ObjectId and hashed `formId` formats. Cross-tenant queries return empty, not error. |
| **Iteration budget** | `maxIterations = 3` shared by Executor↔Evaluator retries. Drafter clarifications don't consume iterations. Only Evaluator increments `iterationCount`. |
| **Failure = resumable** | On any error, ticket status = `LLM_ERROR`, state written to Mongo, sandbox preserved. User can resume via `resumeTicketId`. |

---

## 2. Code Style & Conventions

### TypeScript
- **Strict mode** — `tsc --noEmit` must pass for all agent files
- **No non-null assertions** — Use `state` (non-null alias) instead of `state!` (fixed in Part A P3-M2)
- **Explicit types** — Avoid `any`; use `AgentState`, `AgentAction`, `SandboxStoreState` from `types.ts`
- **Zod validation** — All LLM JSON output validated via `parsePersona(raw, Schema)` from `helper/validate.ts`

### File Organization
```
src/agent/
├── agentLoop.ts          # Main orchestrator (single entry point)
├── types.ts              # All shared interfaces
├── prompts.ts            # System prompt strings (being versioned)
├── personas/             # One file per persona
│   ├── drafter.ts
│   ├── planner.ts
│   ├── executor.ts
│   ├── evaluator.ts
│   └── communicator.ts
├── sandbox/              # Sandbox + merge + locking
│   ├── sandboxRedisStore.ts
│   ├── sandboxMerge.ts
│   ├── agentLock.ts
│   └── agentRedis.ts
├── policy/
│   └── permissions.ts    # Skill→scope mapping, tool allow-list
├── helper/
│   ├── validate.ts       # Zod schemas + parsePersona
│   ├── redact.ts         # PII redaction
│   ├── jsonParse.ts      # Legacy safeJSON (deprecated)
│   └── id.ts             # ID generators
└── legacy/               # Quarantined fallback code
```

### Naming Conventions
| Pattern | Example |
|---------|---------|
| Persona files | `drafter.ts`, `planner.ts` (lowercase, singular) |
| Action IDs | `act_1`, `act_2` (prefix `act_`) |
| Ticket IDs | `tkt_<timestamp>_<random>` (via `newTicketId()`) |
| Trace IDs | `trc_<timestamp>_<random>` (via `newTraceId()`) |
| Idempotency keys | `idem_<timestamp>_<random>` (via `newIdempotencyKey()`) |
| Redis keys | `agent_state:{ticketId}`, `sandbox:{userId}:{ticketId}`, `agent_lock:{userId}`, `agent:simulated_offline:{ticketId}` |

---

## 3. Persona Contracts

### Drafter (`runDrafter`)
- **Input**: `AgentState` with `prompt` or `resumedPrompt`
- **Output**: `AgentState` with `ticket.stage`, `ticket.title`, `requirements`, `activePersona`
- **Short-circuits**: 
  - `product_guide` / `general_chat` → `COMMUNICATOR` (isComplete=true)
  - `isVague` / `isFollowUp` (unconfirmed) → `DRAFTER` (isQuestion=true)
  - `isCancellation` → `COMMUNICATOR` (isComplete=true)
  - `STAGE_1` / read skills → `PLANNER` (read-only path, R1 will shortcut to Communicator)
- **Validation**: `DrafterOutputSchema` (Zod)

### Planner (`runPlanner`)
- **Input**: `AgentState` with validated `requirements`
- **Output**: `AgentState` with `actionPlan[]`, `activePersona: "EXECUTOR_SANDBOX"`
- **Validation**: `validateToolParams()` per tool; failed params → `status: "error"`
- **Function calling**: Uses OpenAI `tools` + `tool_choice: "auto"`

### Executor (`runExecutor`)
- **Input**: `AgentState` with `actionPlan[]`
- **Output**: `AgentState` with updated `actionPlan` (status/result/error), `activePersona: "EVALUATOR"`
- **Mutations**: Queue to Redis sandbox ONLY (never production)
- **Reads**: Cache results in `sandbox.queryResults[actionId]` for deterministic retries
- **Allow-list**: `ALLOWED_TOOLS` from `policy/permissions.ts`

### Evaluator (`runEvaluator`)
- **Input**: `AgentState` with executed `actionPlan`
- **Pass 1**: Deterministic — failed actions → retry `EXECUTOR_SANDBOX` with `evaluatorFeedback`
- **Pass 2**: LLM QA → `{isComplete, shouldRetry, feedback}` via `EvaluatorOutputSchema` (Zod)
- **Transitions**: 
  - `isComplete + mutating` → `AWAITING_USER_APPROVAL`
  - `isComplete + read-only` → `COMMUNICATOR`
  - `shouldRetry + budget` → `EXECUTOR_SANDBOX`
  - `budget exhausted` → `COMMUNICATOR` (asks user to rephrase)

### Communicator (`runCommunicator`)
- **Input**: `AgentState` with `actionPlan`, `evaluatorFeedback`, `reply?`
- **Output**: `AgentState` with `reply`, `isComplete`
- **Never mutates** `activePersona` (Evaluator owns `AWAITING_USER_APPROVAL`)
- **LLMOfflineError** → sets `status: "LLM_ERROR"`, clears `isComplete`, returns offline message
- **Formatting rules**: Markdown table for ≤5 responses; CSV Data URI for >5

---

## 4. API Contracts

### `/api/agent/execute` (GET, SSE)
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes* | User prompt (empty for mergeApproved) |
| `mergeApproved` | boolean | No | `true` = user confirmed merge |
| `resumeTicketId` | string | No* | Resume existing ticket |
| `sessionId` | string | No | Group related tickets |

*Either `prompt` or `mergeApproved` required.

**Rate Limit**: 10 req/min, 200 req/day per user (returns 429 before SSE opens)

**SSE Events**:
- `data: {type:"state", payload: AgentState}` — after each persona
- `data: {type:"busy", error: string}` — AgentBusyError
- `data: {type:"error", error: string}` — loop failure
- `data: [DONE]\n\n` — successful completion

### `/api/agent/simulate-offline` (POST)
```json
{ "simulateOffline": true, "ticketId": "tkt_xxx" }
```
- `ticketId` **required** (global key removed in Part A P0-3)
- Returns 400 if missing

### `/api/agent/health-stream` (GET, SSE) — **Deprecated**
- Replaced by WebSocket health broadcast (`agent:llm_health` channel)
- Will be removed in R3

### `/api/ws` (GET)
```json
{ "wsUrl": "wss://...", "protocols": ["agent-v1"], "auth": {"method": "token", "param": "token"} }
```

### `/api/health/mongo` (GET)
```json
{
  "status": "healthy|unhealthy",
  "readyState": "connected|...",
  "connected": true,
  "host": "...",
  "database": "...",
  "isMaster": true,
  "replicaSet": "rs0",
  "members": ["host1:27017", "host2:27017"]
}
```

---

## 5. Data Models (Mongo)

### `AgentTicket` (`AgentTicketModel.ts`)
```typescript
{
  ticketId: string (unique),
  sessionId: string,
  userId: ObjectId,
  prompt: string,
  stage: "STAGE_1" | "STAGE_2" | "STAGE_3",
  title: string,
  status: "OPEN" | "PROCESSING" | "RESOLVED" | "REJECTED" | "LLM_ERROR",
  activePersona: PersonaStage,
  iterationCount: number,
  maxIterations: 3,
  requirements: object,
  actionPlan: AgentAction[],
  sandbox: SandboxStoreState,
  executionTrace: ExecutionTraceStep[] (compressed in Mongo),
  reply: string,
  isComplete: boolean,
  isQuestion: boolean,
  resumedPrompt: string,
  // TTL: 30 days for non-RESOLVED, non-AWAITING_USER_APPROVAL
}
```

### `PendingMerge` (`PendingMerge.ts`) — Standalone fallback
```typescript
{
  ticketId: string,
  userId: ObjectId,
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
  snapshot: SandboxStoreState,
  error: string,
  // Unique index: (ticketId, userId)
}
```

### `AgentAuditEvent` — Immutable merge log
```typescript
{
  ticketId: string,
  userId: ObjectId,
  resourceId: string,
  action: "create_form" | "update_form" | "delete_form",
  serverDiff: object,
  outcome: "success" | "concurrency_miss"
}
```

---

## 6. Redis Key Schema

| Key | TTL | Purpose |
|-----|-----|---------|
| `agent_state:{ticketId}` | 24h (sliding) | Full AgentState resume cache |
| `sandbox:{userId}:{ticketId}` | 24h (sliding) | Draft forms, views, updates, deletes, queryResults |
| `agent_lock:{userId}` | 60s | Per-user execution lock (Lua compare-and-del) |
| `agent:simulated_offline:{ticketId}` | ∞ (manual del) | Per-ticket offline simulation |
| `agent:llm_health` | — | Pub/sub channel for health status |
| `agent:ratelimit:{userId}:min` | 60s | Per-minute rate limit counter |
| `agent:ratelimit:{userId}:day` | 86400s | Per-day rate limit counter |

---

## 7. Testing Rules

### Golden Prompt Eval (`npm run agent:eval`)
- **Location**: `tests/agent/eval/golden-prompts.jsonl`
- **Runner**: `tests/agent/eval/runner.ts`
- **CI**: `.github/workflows/agent-eval.yml` (PR + nightly)
- **Pass Criteria**: 
  - All `expectedTools` present in `actionPlan`
  - `iterationCount <= maxIterations`
  - `isComplete === true`
  - `status` not `LLM_ERROR` or `REJECTED`

### Unit Tests (Future)
- Mock `llmClient.ts` with fixtures
- Test sandbox operations in isolation
- Test merge logic with transaction mocks

### Test Data
- Use dedicated `eval@test.local` user
- Clean up after each prompt: `sandboxRedisStore.resetStore()`, mark ticket `RESOLVED`

---

## 8. Deployment & Operations

### Environment Variables (`.env.example`)
```
# Required
MONGODB_URI=
TOKEN_SECRET=
NEXTAUTH_SECRET=
NVIDIA_API_KEY=

# Agent-specific
LLM_PROVIDER=nvidia|google
LLM_MODEL=meta/llama-3.1-8b-instruct
LLM_TIMEOUT_MS=30000
AGENT_RATE_LIMIT_PER_MIN=10
AGENT_RATE_LIMIT_PER_DAY=200
AGENT_REDACT_VALUES=0
LLM_TOKEN_BUDGET_PER_TICKET=50000
LLM_TOKEN_BUDGET_PER_USER_DAY=200000

# WebSocket
WS_PORT=3001
NEXT_PUBLIC_WEBSOCKET_URL=

# Health
REDIS_URL=redis://localhost:6379
```

### Scripts
| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run ws:server` | Standalone WS server (port 3001) |
| `npm run dev:ws` | Both dev + WS server |
| `npm run agent:eval` | Run golden prompt eval |
| `npm run agent:migrate` | Migrate AgentTicket schema |
| `npm run build` | Production build |

### Health Checks
- `GET /api/health/mongo` — Mongo replica set status
- `GET /api/ws` — WS server URL
- `agent:llm_health` Redis channel — LLM status (online/offline/unknown)

---

## 9. Common Pitfalls & Anti-Patterns

| Anti-Pattern | Correct Approach |
|--------------|------------------|
| Direct production writes in personas | Queue to Redis sandbox → merge via `mergeSandboxToProduction` |
| Reading `state!` | Use non-null `state` alias (fixed in P3-M2) |
| Skipping `validateToolParams()` | Always validate in Planner; Executor double-checks |
| Using global `agent:simulated_offline` | Use per-ticket `agent:simulated_offline:{ticketId}` |
| Ignoring `expectedUpdatedAt` | Always snapshot for updates/deletes; enables optimistic concurrency |
| Hardcoding `maxIterations=3` | Use per-skill budget (future R4) |
| Not redacting PII | Always `redactPII(params)` and `redactPII(result)` before LLM |
| Writing Redis before Mongo | Mongo-first, then Redis (P2-D2) |

---

## 10. Version Compatibility

| Component | Current Version | Notes |
|-----------|-----------------|-------|
| MongoDB | 9.8.1 (mongoose) | Requires replica set for transactions |
| Redis | 5.11.1 (ioredis) | Pub/sub + locks + caching |
| WebSocket | 8.21.1 (ws) | Standalone server on port 3001 |
| LLM Provider | NVIDIA NIM (default) | `meta/llama-3.1-8b-instruct` |
| Zod | 4.4.3 | LLM output validation |

---

## 11. Migration Checklist (for schema changes)

- [ ] Update `AgentTicketModel.ts` + add index/TTL if needed
- [ ] Update `types.ts` interfaces
- [ ] Update `normalizeSandboxStore()` for backward compatibility
- [ ] Run `npm run agent:migrate`
- [ ] Update golden prompts if tool schema changed
- [ ] Update `Agent.md` remodel notes

---

**Enforcement**: All rules validated by `tsc --noEmit`, `npm run agent:eval`, and CI workflows. Deviations require PR review with architecture approval.