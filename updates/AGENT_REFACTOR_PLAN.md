# Agent Refactor Master Plan — Easy Forms

**Goal**: Fix all identified weaknesses in one cohesive effort — latency, observability, concurrency, cost control, resilience, and evaluation infrastructure.

**Assumptions** (from dismissed clarifying questions):
- Timeline: **12-16 weeks** with 1-2 engineers (Realistic)
- MongoDB: **Replica set available** (fallback documented for standalone)
- Transport: **Full WebSocket migration** with SSE fallback during transition
- Evaluation: **Full CI eval harness** with golden prompts
- Prompt versioning: **JSON files + A/B switching** via feature flags

---

## Phase Overview

| Phase | Weeks | Focus | Key Deliverable |
|-------|-------|-------|-----------------|
| 0 | 0.5 | Foundation & infra prep | Replica set verified, WS server scaffolded, eval CI pipeline |
| 1 | 2 | Parallel read path (P1) | Drafter → Communicator shortcut for STAGE_1; 3 LLM calls eliminated for analytics |
| 2 | 2 | Token/cost tracking (P1) | Per-ticket + per-user usage persisted; dashboard + budget guardrails |
| 3 | 3 | WebSocket transport + streaming (P2) | WS server, reconnection, per-persona token streaming, SSE fallback |
| 4 | 2 | Concurrency refinement (P2) | Read/write lock separation; parallel reads allowed |
| 5 | 2 | Multi-turn conversation state (P2) | `conversationHistory` in AgentState; fed to Planner/Evaluator |
| 6 | 2 | Evaluation harness (P2) | Golden-set tests; CI job; regression alerts |
| 7 | 1.5 | Prompt versioning + A/B (P3) | JSON prompt files; feature-flag router; versioned rollout |
| 8 | 1.5 | User presets + cost guardrails (P3/P4) | Custom presets API; per-ticket token budget hard-stop |
| 9 | 1 | Trace optimization + docs (P4) | Payload dedup; updated Agent.md/guardrails.md; runbooks |
| 10 | 1 | Hardening & release | Load test, chaos test, canary rollout, runbook drills |

**Total: ~16 weeks** (parallelizable where marked)

---

## Phase 0 — Foundation (Week 0-0.5)

### 0.1 MongoDB Replica Set Verification
- [ ] Confirm `MONGODB_URI` points to replica set (`rs0/...`)
- [ ] Run `rs.status()` — verify majority quorum
- [ ] If standalone: document fallback (two-phase merge via `PendingMerge` collection) in `sandboxMerge.ts`
- [ ] Add `dbConfig.ts` health check endpoint: `/api/health/mongo` → `readyState + isMaster`

### 0.2 WebSocket Server Scaffold
- [ ] New file: `src/lib/wsServer.ts` — `ws` library on separate port (e.g., 3001) or `/api/ws` via Next.js custom server
- [ ] Connection auth: reuse `getAuthUserId` from `/api/agent/execute`
- [ ] Message protocol:
  ```ts
  // Client → Server
  { type: "prompt", payload: { prompt, mergeApproved, resumeTicketId } }
  { type: "merge", payload: { ticketId } }
  { type: "resume", payload: { ticketId } }
  { type: "ping" }

  // Server → Client
  { type: "state", payload: AgentState }
  { type: "token", payload: { persona, token } }  // streaming
  { type: "busy", payload: { message } }
  { type: "error", payload: { message } }
  { type: "done", payload: { finalState } }
  { type: "pong" }
  ```
- [ ] Health broadcast channel: `agent:llm_health` → WS push (replaces SSE `health-stream`)

### 0.3 Evaluation CI Pipeline
- [ ] New dir: `tests/agent/eval/`
  - `golden-prompts.jsonl` — `{prompt, expectedSkills[], expectedTools[], maxIterations}`
  - `runner.ts` — executes `runAgentLoop` headless, asserts:
    - `state.ticket.stage` matches expected
    - `state.actionPlan.map(a => a.tool)` contains expectedTools
    - `state.isComplete === true` within `maxIterations`
    - No `LLM_ERROR` / `REJECTED` unless expected
- [ ] GitHub Actions workflow: `.github/workflows/agent-eval.yml`
  - Runs on PR + nightly
  - Requires `LLM_API_KEY` secret (use small/test model)
  - Fails PR if any golden prompt regresses
- [ ] Baseline golden set (15 prompts covering):
  - Read queries (count, filter, analytics)
  - Vague build → clarification
  - Detailed build → merge approval
  - Edit form → merge
  - Delete form → confirmation → merge
  - Follow-up "yes" to prior ticket
  - Product guide FAQ
  - Simulated crash → resume
  - Permission denied flows

---

## Phase 1 — Parallel Read Path (Weeks 1-2)

**Problem**: Pure read queries (`STAGE_1`) currently burn 3 LLM calls (Drafter → Planner → Evaluator → Communicator).

**Solution**: Short-circuit Drafter → Communicator when skill ∈ `{run_database_query, filter_responses, generate_analytics_skill, manage_custom_views}`.

### 1.1 Drafter Short-Circuit Logic
- [ ] In `runDrafter`: after skill classification, if `READ_ONLY_SKILLS.has(skill)`:
  - Skip Planner/Executor/Evaluator
  - Call `executeAgentTool(skill, params, userId)` directly
  - Build minimal `AgentState` with `activePersona: "COMMUNICATOR"`, `isComplete: true`
  - Return immediately
- [ ] `READ_ONLY_SKILLS` constant in `policy/permissions.ts`

### 1.2 Communicator Read-Mode Rendering
- [ ] Detect `state.isReadOnly === true` (new flag) → render table/summary instead of "form created" prose
- [ ] Reuse existing `summaryPayload` formatting

### 1.3 Test
- [ ] Golden prompts: "how many forms", "show responses for form X", "analytics for form Y"
- [ ] Assert latency drops from ~8s → ~2s (1 LLM call instead of 4)
- [ ] Verify trace shows `DRAFTER → COMMUNICATOR` only

---

## Phase 2 — Token/Cost Tracking (Weeks 3-4)

### 2.1 LLM Client Usage Return
- [ ] Modify `retryLLM` / `callLLM` to return `{ message, usage: { promptTokens, completionTokens, totalTokens, model } }`
- [ ] Provider-specific parsing (NVIDIA: `usage` in response; Gemini: `usageMetadata`)

### 2.2 Persistence Schema
- [ ] New Mongo collection: `AgentUsage`
  ```ts
  { ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, timestamp, costUsd }
  ```
- [ ] Per-ticket aggregate in `AgentState`: `tokenUsage: { total, byPersona, estimatedCost }`

### 2.3 Budget Guardrails
- [ ] Env: `LLM_TOKEN_BUDGET_PER_TICKET` (default: 50000), `LLM_TOKEN_BUDGET_PER_USER_DAY` (default: 200000)
- [ ] In `runAgentLoop` pre-check: sum user's today usage → if exceeds daily, return 429-like error
- [ ] In each persona call: if `state.tokenUsage.total > perTicketBudget` → throw `LLMBudgetExceededError` → Evaluator surfaces "please rephrase with fewer details"

### 2.4 Dashboard
- [ ] `/api/admin/agent/usage` — returns per-user, per-day, per-model breakdown
- [ ] Simple admin page (or extend `/app/agent`) with charts

---

## Phase 3 — WebSocket Transport + Streaming (Weeks 5-7)

### 3.1 WS Server Implementation
- [ ] `src/lib/wsServer.ts` — full implementation with:
  - Connection map: `Map<userId, WebSocket[]>` (support multiple tabs)
  - Heartbeat: 30s ping/pong; auto-cleanup stale connections
  - Auth on connect: token from query param or cookie
  - Message router: delegates to `runAgentLoop` with custom `onUpdate` that pushes WS messages
  - Stream tokens: hook into `llmClient.ts` streaming (see 3.2)

### 3.2 Token Streaming from LLM
- [ ] Modify `llmClient.callOnce` to support `stream: true`:
  - Use `fetch` with `ReadableStream` on response body
  - Yield SSE chunks → parse `data:` lines → extract `choices[0].delta.content`
  - Callback: `onToken(token: string)` → push WS `{type: "token", payload: {persona, token}}`
- [ ] Only stream for Drafter/Planner/Evaluator/Communicator (not tool calls)
- [ ] Buffer tokens in Communicator until `. ` or `\n` for smoother UX

### 3.3 Client Migration
- [ ] New hook: `useAgentWS(userId)` — manages WS lifecycle, reconnection (exponential backoff 1s, 2s, 4s, max 30s)
- [ ] `AgentVisualizer` switches from `fetch` + `EventSource` → `useAgentWS`
- [ ] SSE fallback: if WS fails to connect after 3 retries, fall back to current SSE flow
- [ ] Deprecate `/api/agent/health-stream` → health via WS `pong` + periodic broadcast

### 3.4 Reconnection Semantics
- [ ] On reconnect: send `{type: "resume", payload: {ticketId: lastTicketId}}`
- [ ] Server: if ticket exists in Redis/Mongo and `activePersona !== MERGED_TO_PRODUCTION`, resume streaming from last `executionTrace` index
- [ ] Client: replay missed trace entries locally (store in `localStorage` as backup)

---

## Phase 4 — Concurrency Refinement (Weeks 8-9)

### 4.1 Lock Separation
- [ ] `agentLock.ts` → two locks per user:
  - `agent_lock:write:{userId}` — for mutations (create/update/delete)
  - `agent_lock:read:{userId}` — for read queries (shared, no TTL conflict)
- [ ] `runAgentLoop`:
  - If `skill ∈ READ_ONLY_SKILLS` → acquire **read lock** (non-blocking, `SET NX` with short TTL, release immediately after)
  - Else → acquire **write lock** (existing 60s TTL, held for full loop)

### 4.2 Read-Lock Implementation
- [ ] Read lock: `SET agent_lock:read:{userId} <reqId> NX PX 5000` — short TTL, auto-expires
- [ ] Multiple readers can hold simultaneously (different `reqId` values)
- [ ] Writer waits for all readers to expire (or use Redis `WAIT` — but simple TTL expiry is fine for 5s)

### 4.3 Test
- [ ] Concurrent: 1 write (form build) + 3 reads (analytics) → reads complete in parallel, write serialized
- [ ] No data races on sandbox (Redis sandbox is per-user; reads don't mutate)

---

## Phase 5 — Multi-Turn Conversation State (Weeks 10-11)

### 5.1 Schema Extension
- [ ] `AgentState.conversationHistory: {role: "user"|"assistant", content: string, ticketId, timestamp}[]`
- [ ] Cap at `MAX_HISTORY = 10` turns (configurable)
- [ ] On each user prompt: append `{role: "user", content: prompt, ticketId: currentTicketId}`

### 5.2 Persona Integration
- [ ] **Planner**: prepend last 3 assistant messages to system prompt as "Recent context:"
- [ ] **Evaluator**: include conversation history in QA payload for semantic continuity
- [ ] **Communicator**: use history to avoid repeating explanations

### 5.3 Resume Enhancement
- [ ] On resume: load `conversationHistory` from Mongo (already in `AgentState`)
- [ ] Drafter's `recentTickets` query now also considers conversation turns, not just tickets

---

## Phase 6 — Evaluation Harness (Weeks 12-13)

### 6.1 Golden Prompt Expansion
- [ ] Target: **50 golden prompts** covering:
  - All 6 skills × 2-3 variations
  - Edge cases: vague, follow-up, permission denied, crash recovery, multi-turn
  - Adversarial: ReDoS regex attempt, cross-tenant `form_id` injection, prompt injection

### 6.2 CI Metrics
- [ ] Per-prompt latency (p50, p95)
- [ ] Token usage per prompt
- [ ] Iteration count distribution
- [ ] Regression threshold: latency +20% or tokens +30% = fail

### 6.3 Nightly LLM Drift Detection
- [ ] Run golden set against two model versions (current + candidate)
- [ ] Alert on: `isComplete` rate drop, tool-sequence divergence, cost spike

---

## Phase 7 — Prompt Versioning + A/B (Weeks 14-15)

### 7.1 File-Based Prompts
- [ ] New structure:
  ```
  src/agent/prompts/
    v1/
      drafter.json
      planner.json
      evaluator.json
      communicator.json
    v2/ (future)
  ```
- [ ] Each file: `{ systemPrompt, outputSchema, version }`
- [ ] `prompts.ts` becomes a thin loader: `loadPrompt(version, persona)`

### 7.2 A/B Router
- [ ] Env: `AGENT_PROMPT_VERSION=v1` (default)
- [ ] Feature flag: `AGENT_PROMPT_AB=v2:0.1` → 10% of users get v2
- [ ] Per-user override: cookie `agent_prompt_version=v2`
- [ ] Metrics tracked per version (via Phase 2 usage collection)

---

## Phase 8 — User Presets + Cost Guardrails (Weeks 15-16)

### 8.1 Custom Presets API
- [ ] `POST /api/agent/presets` — `{label, prompt, tags}`
- [ ] `GET /api/agent/presets` — user's presets + global defaults
- [ ] `DELETE /api/agent/presets/:id`
- [ ] UI: "Save as preset" button in `AgentVisualizer` sidebar

### 8.2 Hard Budget Enforcement
- [ ] Already in Phase 2 — add UI:
  - Token budget progress bar in `AgentVisualizer` header
  - Warning toast at 80%, hard stop at 100%
  - Admin override: `AGENT_BUDGET_BYPASS_USERS="user1,user2"`

---

## Phase 9 — Trace Optimization + Documentation (Week 17)

### 9.1 Trace Payload Dedup
- [ ] `addTrace`: instead of embedding full `actionPlan`, store `actionPlanRef: stepId` of the planner trace entry
- [ ] Client resolves references when expanding log

### 9.2 Docs
- [ ] `Agent.md` — sync with live prompts (remove remodel appendix, make it canonical)
- [ ] `guardrails.md` — add concurrency + budget invariants
- [ ] `RUNBOOK.md` — incident response: LLM down, budget exceeded, lock contention, merge failure
- [ ] Architecture diagram (Mermaid) in `docs/agent-architecture.md`

---

## Phase 10 — Hardening & Release (Week 18)

### 10.1 Load Test
- [ ] k6 script: 50 concurrent users, mixed read/write, 10 min
- [ ] Targets: p99 latency < 15s (streaming), 0% data loss, <1% lock contention

### 10.2 Chaos Tests
- [ ] Kill LLM API mid-request → verify resume works
- [ ] Kill Mongo primary → verify replica set failover + agent resume
- [ ] Fill Redis → verify eviction policy (sandbox TTL) doesn't lose active tickets
- [ ] Network partition client → verify WS reconnection + state replay

### 10.3 Canary Rollout
- [ ] 5% → 25% → 100% over 3 days
- [ ] Monitor: error rate, latency, token cost, user satisfaction (toast dismiss rate)

### 10.4 Runbook Drills
- [ ] Team walks through: LLM outage, budget alert, stuck lock, merge conflict

---

## Cross-Cutting Concerns

| Concern | Owner | Tracking |
|---------|-------|----------|
| TypeScript strictness | All phases | `tsc --noEmit` clean gate per PR |
| Lint/format | All phases | `npm run lint` + Prettier gate |
| Secrets | Phase 0, 2, 7 | `.env` never committed; use Vercel/GH secrets |
| Backwards compat | Phases 1, 3, 4 | Feature flags for every breaking change |
| Observability | Phases 2, 3, 6 | Structured logs (pino) + metrics (Prometheus) |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM provider changes API | Medium | High | `llmClient.ts` adapter pattern; integration tests per provider |
| Mongo standalone in prod | Low | High | Phase 0 verification; fallback documented |
| WS connection storms | Low | Medium | Connection limits per IP; exponential backoff |
| Prompt regression | Medium | High | Golden-set CI + nightly drift detection |
| Token cost spike | Medium | Medium | Phase 2 budget guardrails + alerts |
| Lock contention under load | Medium | Low | Phase 4 read/write separation; monitoring |

---

## Success Criteria (Definition of Done)

- [ ] All 50 golden prompts pass CI
- [ ] p95 latency for read queries < 3s (was ~8s)
- [ ] p95 latency for form build < 12s streaming (was ~15s blocking)
- [ ] 0 data-loss incidents in chaos tests
- [ ] Token cost per form build tracked + budget enforced
- [ ] WS reconnection < 2s median
- [ ] Canary rollout completes with < 0.1% error rate
- [ ] Runbook drills passed by 2 engineers independently

---

## File Map (New / Modified)

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

---

## New Dependencies

```json
{
  "ws": "^8.16.0",
  "@types/ws": "^8.5.10",
  "pino": "^8.19.0",
  "prom-client": "^15.1.0"
}
```

---

## Execution Order (Critical Path)

```
Phase 0 (foundation)
   ├──> Phase 1 (read shortcut)      ┐
   ├──> Phase 2 (cost tracking)      ├── can run in parallel
   ├──> Phase 3 (WS + streaming)     ┘
            │
            ├──> Phase 4 (lock separation)  ──> Phase 6 (eval harness)
            ├──> Phase 5 (conversation)     ──> Phase 6
            │
            └──> Phase 7 (prompt versioning)
                     │
                     └──> Phase 8 (presets + budget UI)
                              │
                              └──> Phase 9 (trace + docs)
                                       │
                                       └──> Phase 10 (hardening + release)
```

- Phases 1, 2, 3 can run in parallel after Phase 0
- Phase 4 depends on Phase 1 (uses `READ_ONLY_SKILLS`)
- Phase 5 independent of 4
- Phase 6 depends on 1-5 for stable test surface
- Phase 7-10 sequential

---

This plan is executable as-is. Each phase has clear entry/exit criteria, testable deliverables, and minimal cross-phase coupling.
