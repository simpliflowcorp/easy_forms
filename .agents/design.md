# Easy Forms Agent — System Design Document

**Version:** 2.0 (Post Part A Hardening + R0 Foundation)  
**Updated:** 2026-08-01  
**Status:** Production-ready core; R1-R5 refactor in progress

---

## 1. System Overview

### 1.1 Purpose
The Easy Forms Agent is a multi-persona AI system that enables natural-language form management: building forms, querying responses, managing views, and analytics — all through a chat interface with sandbox-isolated mutations and human-in-the-loop merge approval.

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ AgentVisual │  │  useAgentWS │  │  SSE Fallback│  │  Auth (JWT)  │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │ WS/SSE         │ WS/SSE         │ WS/SSE         │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NEXT.JS API ROUTES                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ /api/agent/     │  │ /api/ws         │  │ /api/health/    │             │
│  │ execute (SSE)   │  │ (WS upgrade)    │  │ mongo           │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
└───────────┼────────────────────┼────────────────────┼───────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AGENT RUNTIME (runAgentLoop)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ DRAFTER  │─►│ PLANNER  │─►│ EXECUTOR │─►│EVALUATOR │─►│COMMUNICATOR │  │
│  └──────────┘  └──────────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘  │
│                                    │           │            │            │
│                              ┌─────┴─────┐      │            │            │
│                              │ SANDBOX   │      │            │            │
│                              │ (Redis)   │      │            │            │
│                              └─────┬─────┘      │            │            │
│                                    │            │            │            │
│                              ┌─────┴────────────┴────┐       │            │
│                              │ MERGE (Mongo TXN)     │       │            │
│                              └───────────────────────┘       │            │
└─────────────────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   MONGODB        │  │   REDIS          │  │   REDIS PUBSUB   │          │
│  │ (Authoritative)  │  │ (Resume Cache +  │  │ (Health Broadcast)│          │
│  │                  │  │  Sandbox + Locks)│  │                  │          │
│  │ AgentTicket      │  │                  │  │                  │          │
│  │ PendingMerge     │  │ agent_state:{}   │  │ agent:llm_health │          │
│  │ AgentAuditEvent  │  │ sandbox:{}:{}    │  │                  │          │
│  │ Form/Response/   │  │ agent_lock:{}    │  │                  │          │
│  │ CustomView/User  │  │ agent:ratelimit: │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Multi-persona pipeline** | Separates concerns: intent classification → planning → execution → QA → communication. Each testable independently. |
| **Sandbox isolation** | Mutations never touch production until explicit user approval. Prevents accidental data loss. |
| **Mongo transactions + idempotency** | Atomic merge with `$setOnInsert` prevents duplicate forms on double-click/network retry. |
| **Per-user Redis lock** | Serializes concurrent requests per user. Prevents race conditions on sandbox + merge. |
| **Optimistic concurrency** | `expectedUpdatedAt` catches concurrent edits between snapshot and merge. |
| **Mongo-authoritative, Redis-cache** | Single source of truth; Redis is rebuildable hot cache. |
| **Iteration budget (3)** | Bounded retries; prevents infinite loops. Drafter clarifications don't consume budget. |
| **SSE + WebSocket dual transport** | SSE for simplicity; WS for streaming + reconnection (R3). |

---

## 2. Core Components

### 2.1 Agent Loop (`src/agent/agentLoop.ts`)

**Responsibilities:**
- Acquire per-user lock (`acquireAgentLock`)
- Resume from Redis → Mongo fallback
- Initialize new ticket or resume existing
- Load user context (profile + preferences)
- Run persona pipeline via `while (isLooping)`
- Persist state after each persona (Mongo-first, then Redis)
- Handle failures → `LLM_ERROR` + Mongo write for resume
- Release lock in `finally` block

**State Machine:**
```
INIT → DRAFTER → (PLANNER → EXECUTOR → EVALUATOR)* → COMMUNICATOR → RESOLVED
                    ↑___________________________|
                    (retry on failure, max 3 iterations)

EVALUATOR may also transition to:
  - AWAITING_USER_APPROVAL (mutating plan, isComplete)
  - COMMUNICATOR (read-only plan, isComplete)
```

**Key Invariants:**
- `iterationCount` only incremented by Evaluator
- Lock held for entire loop duration
- Trace capped at 50 entries, 4KB per payload
- Mongo write on: DRAFTER, AWAITING_USER_APPROVAL, LLM_ERROR, REJECTED, RESOLVED
- Redis write on every transition

### 2.2 Personas

| Persona | File | Input | Output | LLM Mode |
|---------|------|-------|--------|----------|
| **Drafter** | `drafter.ts` | prompt, userContext, recentTickets | stage, skill, requirements, clarifyingQuestion | JSON mode (`response_format: json_object`) |
| **Planner** | `planner.ts` | requirements, userContext | actionPlan[] (tool + params) | Function calling (`tools` + `tool_choice: auto`) |
| **Executor** | `executor.ts` | actionPlan, userContext | actionPlan with results/errors | No LLM (deterministic) |
| **Evaluator** | `evaluator.ts` | actionPlan with results | isComplete, shouldRetry, feedback | JSON mode |
| **Communicator** | `communicator.ts` | actionPlan, evaluatorFeedback | user-facing reply | Free text (streaming in R3) |

### 2.3 Sandbox (`src/agent/sandbox/`)

**Components:**
- `sandboxRedisStore.ts` — Redis operations (drafts, updates, deletes, queryResults)
- `sandboxMerge.ts` — Transactional merge to Mongo (with standalone fallback)
- `agentLock.ts` — Per-user Redis lock (Lua compare-and-del)
- `agentRedis.ts` — AgentState resume cache

**Sandbox State Shape:**
```typescript
interface SandboxStoreState {
  forms: Record<string, AgentDraftForm>;      // create_form drafts
  customViews: Record<string, AgentDraftView>; // create_custom_view drafts
  queryResults: Record<string, any>;           // cached read results
  updates: AgentPendingUpdate[];               // update_form intentions
  deletes: AgentPendingDelete[];               // delete_form intentions
}
```

**Merge Process:**
1. Read sandbox snapshot **once** before transaction
2. `mergeFormsAndIntents` — creates forms via `$setOnInsert` (idempotencyKey), applies updates/deletes with `expectedUpdatedAt`
3. `mergeViews` — creates custom views via `$setOnInsert`
4. Commit transaction → `resetStore` (clear Redis sandbox)
5. On failure → sandbox preserved, throw → `LLM_ERROR`

**Standalone Fallback (`PendingMerge`):**
- Two-phase: reserve slot via unique index → execute best-effort → mark COMPLETED/FAILED
- No atomicity guarantee but idempotency keys prevent duplicates

### 2.4 LLM Client (`src/lib/llmClient.ts`)

**Providers:**
- **NVIDIA NIM** (default): `meta/llama-3.1-8b-instruct`
- **Google Gemini**: `gemini-2.0-flash`

**Error Hierarchy:**
```
LLMError (base)
├── LLMOfflineError (network, DNS, connection refused)
├── LLMRateLimitError (429, retry-after)
├── LLMTimeoutError (AbortController)
├── LLMHTTPError (other 5xx, 408, 409, 425, 502, 503, 504)
└── LLMParseError (malformed function calling output)
```

**Retry Policy:**
- 3 attempts with exponential backoff (base 500ms, jitter 250ms)
- Retry on: `LLMRateLimitError`, `LLMTimeoutError`, `LLMHTTPError`, `LLMOfflineError` (attempt 0 only)
- No retry on: `LLMParseError`, auth errors, non-retryable HTTP

**Timeout:** `LLM_TIMEOUT_MS` (default 30s) via `AbortController`

---

## 3. Data Flow

### 3.1 New Request Flow

```
User sends prompt via SSE/WS
       │
       ▼
GET /api/agent/execute?prompt=...&sessionId=...
       │
       ▼
Rate limit check (10/min, 200/day)
       │
       ▼
Acquire lock (agent_lock:{userId})
       │
       ▼
runAgentLoop(userId, prompt, false, undefined, sessionId)
       │
       ├──► Resume? No → Initialize new ticket (STAGE_1, DRAFTER)
       │
       ├──► Load userContext (User.findById)
       │
       ├──► while (isLooping):
       │     ├──► Check simOfflineKey
       │     ├──► DRAFTER: classify intent, extract requirements
       │     │     ├──► isVague? → isQuestion, return to user
       │     │     ├──► product_guide? → COMMUNICATOR, isComplete
       │     │     ├──► STAGE_1 read? → PLANNER (R1: shortcut to COMMUNICATOR)
       │     │     └──► STAGE_2/3? → PLANNER
       │     ├──► PLANNER: compile actionPlan via function calling
       │     │     └──► validateToolParams() per action
       │     ├──► EXECUTOR: execute each action
       │     │     ├──► Mutations → sandbox (idempotencyKey, expectedUpdatedAt)
       │     │     └──► Reads → executeAgentTool + cache in sandbox
       │     ├──► EVALUATOR: QA
       │     │     ├──► Pass 1: failed actions? → retry EXECUTOR
       │     │     ├──► Pass 2: LLM QA → isComplete, shouldRetry, feedback
       │     │     ├──► isComplete + mutating? → AWAITING_USER_APPROVAL
       │     │     ├──► isComplete + read? → COMMUNICATOR
       │     │     ├──► shouldRetry + budget? → EXECUTOR (with feedback)
       │     │     └──► budget exhausted? → COMMUNICATOR (asks rephrase)
       │     └──► COMMUNICATOR: render reply
       │
       ├──► Persist after each persona (Mongo-first, then Redis)
       │
       └──► Return final AgentState → SSE [DONE] / WS done
```

### 3.2 Merge Approval Flow

```
User clicks "Confirm & Merge" in UI
       │
       ▼
GET /api/agent/execute?mergeApproved=true&resumeTicketId=...
       │
       ▼
Rate limit bypassed for mergeApproved
       │
       ▼
runAgentLoop(userId, "", true, resumeTicketId)
       │
       ├──► Verify ticket: AWAITING_USER_APPROVAL + isComplete
       │
       ├──► Verify sandbox non-empty
       │
       ├──► Acquire lock
       │
       ├──► Call mergeSandboxToProduction(userId, ticketId)
       │     ├──► Try Mongo transaction
       │     │     ├──► mergeFormsAndIntents (creates, updates, deletes)
       │     │     ├──► mergeViews
       │     │     └──► Commit → resetStore
       │     └──► Catch standalone error → fallback to PendingMerge
       │
       ├──► Clear Redis state + mark Mongo RESOLVED
       │
       └──► Reply with merge stats (including concurrency misses)
```

### 3.3 Resume Flow

```
User resumes ticket (clicks "Continue" or sends new prompt to existing ticket)
       │
       ▼
GET /api/agent/execute?prompt=...&resumeTicketId=...
       │
       ▼
runAgentLoop(userId, prompt, false, resumeTicketId)
       │
       ├──► Try Redis: agentRedis.getState(ticketId)
       │
       ├──► Fallback Mongo: AgentTicketModel.findOne(ticketId, userId)
       │
       ├──► normalizeSandboxStore() for legacy tickets
       │
       ├──► Replay executionTrace into in-memory trace[]
       │
       ├──► Reset linkedTicketId, isFollowUpConfirmed
       │
       ├──► Store new prompt in resumedPrompt
       │
       ├──► Reset to DRAFTER, iterationCount=1, isComplete=false
       │
       ├──► If was RESOLVED → status = PROCESSING
       │
       └──► Continue normal loop
```

---

## 4. Security & Isolation

### 4.1 Tenant Isolation
- All queries filtered by `userId` (ObjectId)
- `resolveFormIdFilter()` in `agentTools.ts` handles:
  - Response: `form_id` = Mongo `_id`
  - Form: `_id` OR `formId` (hashed)
  - CustomView: `formId` = hashed string
- Cross-tenant query returns empty, not error

### 4.2 Permissions
- `permissions.json` defines scopes: `form_management`, `data_analytics`, `destructive_actions`
- `SKILL_TO_SCOPE` maps skill → scope
- `TOOL_TO_SCOPE` maps tool → scope (defense in depth)
- Double-checked: Drafter (intent) + Executor (dispatch)

### 4.3 PII Redaction
- `redactPII()` in `helper/redact.ts`
- Key-based: `email`, `phone`, `ssn`, `password`, `address`, `zip`, `postcode`, `ip_address`, `user_agent`
- Value-based (optional): email/phone/SSN regex (`AGENT_REDACT_VALUES=1`)
- Applied in Executor, Evaluator, Communicator before LLM calls

### 4.4 Auth
- JWT in cookie (`token`) or NextAuth session
- `getAuthUserId()` verifies JWT → falls back to session
- Per-ticket offline simulation (no global key)
- Rate limiting per user (Redis token bucket)

---

## 5. Observability

### 5.1 Tracing
- `executionTrace[]` in AgentState (capped 50 entries, 4KB payloads)
- Fields: `stepId`, `timestamp`, `persona`, `message`, `payload?`
- Compressed for Mongo (no payload); full in Redis + SSE
- Streamed via SSE `onUpdate` callback

### 5.2 Logging
- Structured `console.warn/error` with context
- Key logs: JWT failures, lock contention, merge stats, LLM errors
- Future: pino + Application Insights (see `appinsights-instrumentation` skill)

### 5.3 Health Monitoring
- `llmHealthMonitor.ts` — 10s interval ping to LLM provider
- Publishes to `agent:llm_health` Redis channel
- WS server subscribes + broadcasts to clients
- `/api/health/mongo` — replica set status

### 5.4 Metrics (Future R2)
- Per-persona token usage (prompt/completion/total)
- Per-persona latency
- Per-ticket cost
- Budget enforcement

---

## 6. Deployment Architecture

### 6.1 Services
| Service | Port | Process |
|---------|------|---------|
| Next.js App | 3000 | `npm run dev` / `npm run start` |
| WebSocket Server | 3001 | `npm run ws:server` (standalone) |
| Redis | 6379 | Docker / managed |
| MongoDB | 27017 | Replica set (required for transactions) |

### 6.2 Environment Variables
```
# Core
MONGODB_URI=mongodb://user:pass@host1:27017,host2:27017,host3:27017/db?replicaSet=rs0
TOKEN_SECRET=<32+ chars>
NEXTAUTH_SECRET=<32+ chars>

# LLM
LLM_PROVIDER=nvidia
NVIDIA_API_KEY=<key>
LLM_MODEL=meta/llama-3.1-8b-instruct
LLM_TIMEOUT_MS=30000

# Agent
AGENT_RATE_LIMIT_PER_MIN=10
AGENT_RATE_LIMIT_PER_DAY=200
AGENT_REDACT_VALUES=0

# WebSocket
WS_PORT=3001
NEXT_PUBLIC_WEBSOCKET_URL=wss://domain.com/api/ws

# Redis
REDIS_URL=redis://localhost:6379
```

### 6.3 Scaling Considerations
- **Next.js**: Stateless, horizontal scaling via load balancer
- **WS Server**: Sticky sessions required (per-user connection map in memory)
  - Future: Redis-backed connection registry for multi-instance
- **Redis**: Single instance for dev; Cluster for prod
- **MongoDB**: Replica set required (transactions); sharding for scale

---

## 7. Refactor Roadmap (Part B)

### R0 Foundation ✅ COMPLETE
- [x] MongoDB health endpoint + replica set verification
- [x] Standalone Mongo fallback via `PendingMerge`
- [x] WebSocket server scaffold
- [x] Evaluation CI pipeline (15 golden prompts)

### R1 Parallel Read Path (Week 1-2)
- [ ] `READ_ONLY_SKILLS` in `permissions.ts`
- [ ] Drafter shortcut: `STAGE_1` skills → direct `executeAgentTool` → Communicator
- [ ] Communicator read-mode (table/CSV rendering)
- [ ] Target: 8s → 2s for read queries

### R2 Token/Cost Tracking (Week 3-4)
- [ ] `llmClient.ts` returns `{message, usage}`
- [ ] `AgentUsage` Mongo model
- [ ] Budget guardrails: per-ticket + per-user-day
- [ ] Dashboard API `/api/admin/agent/usage`

### R3 WebSocket + Streaming (Week 5-7)
- [ ] Full WS server with connection map
- [ ] Token streaming: `stream: true` → `onToken` callback → WS `token` events
- [ ] Client hook `useAgentWS` with reconnection
- [ ] SSE fallback + deprecate `/api/agent/health-stream`

### R4 Concurrency Refinement (Week 8-9)
- [ ] Read/write lock separation
- [ ] `agent_lock:read:{userId}` (shared, 5s TTL)
- [ ] `agent_lock:write:{userId}` (exclusive, 60s TTL)

### R5 Conversation History (Week 10-11)
- [ ] `conversationHistory[]` in `AgentState` (cap 10)
- [ ] Planner/Evaluator/Communicator consume history

---

## 8. Appendix: Key Files Reference

| Category | File | Purpose |
|----------|------|---------|
| **Orchestrator** | `src/agent/agentLoop.ts` | Main loop, state machine, persistence |
| **Personas** | `src/agent/personas/*.ts` | 5 persona implementations |
| **Sandbox** | `src/agent/sandbox/*.ts` | Redis sandbox, merge, lock, cache |
| **Tools** | `src/lib/agentTools.ts` | Read-only tool execution (`run_database_query`) |
| **LLM Client** | `src/lib/llmClient.ts` | Provider abstraction, retry, errors |
| **Validation** | `src/agent/helper/validate.ts` | Zod schemas + `parsePersona` |
| **Redaction** | `src/agent/helper/redact.ts` | PII redaction (key + value) |
| **Types** | `src/agent/types.ts` | All shared interfaces |
| **Permissions** | `src/agent/policy/permissions.ts` | Skill/tool → scope mapping |
| **Prompts** | `src/agent/prompts.ts` | System prompt strings |
| **WS Server** | `src/lib/wsServer.ts` | WebSocket server + message router |
| **Health** | `src/app/api/health/mongo/route.ts` | Mongo replica set health |
| **Models** | `src/models/*.ts` | MongoDB schemas |
| **Eval** | `tests/agent/eval/*.ts` | Golden prompt runner + CI |
| **Config** | `.env.example`, `package.json` | Environment + scripts |

---

**Document Maintenance:** Update this file when architecture changes (new components, modified data flows, new personas, schema changes). Keep in sync with `.agents/rules.md`.