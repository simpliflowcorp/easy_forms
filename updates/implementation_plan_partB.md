# Agent Feature Improvements — Implementation Plan

**Started:** 2026-08-01  
**Phase:** Part B Refactor (R0-R3)  
**Goal:** Implement high-impact improvements: WebSocket streaming, parallel read path, token tracking, conversation history

---

## Phase R0 — Foundation (Week 0-0.5)

### R0.1 MongoDB Replica Set Verification
- [x] Verify `MONGODB_URI` points to replica set (`rs0/...`); run `rs.status()` for majority quorum
- [x] Document standalone fallback via `PendingMerge` collection in `sandboxMerge.ts`
- [x] Add health endpoint `/api/health/mongo` → `readyState + isMaster`

### R0.2 WebSocket Server Scaffold
- [x] Create `src/lib/wsServer.ts` (ws on port 3001 or `/api/ws` via Next.js custom server)
- [x] Connection auth: reuse `getAuthUserId` from `/api/agent/execute`
- [x] Message protocol (client→server / server→client)
- [x] Health broadcast channel `agent:llm_health` → WS push

### R0.3 Evaluation CI Pipeline
- [x] Create `tests/agent/eval/golden-prompts.jsonl` (15 baseline prompts)
- [x] Create `tests/agent/eval/runner.ts` — headless `runAgentLoop` execution
- [x] Add `.github/workflows/agent-eval.yml` — runs on PR + nightly

---

## Phase R1 — Parallel Read Path (Week 1-2) — HIGH PRIORITY

### R1.1 Drafter Short-Circuit for STAGE_1
- [ ] Define `READ_ONLY_SKILLS` in `src/agent/policy/permissions.ts`
- [ ] In `runDrafter`: after skill classification, if `READ_ONLY_SKILLS.has(skill)`, skip Planner/Executor/Evaluator
- [ ] Call `executeAgentTool(skill, params, userId)` directly (read-only post P1-R2)
- [ ] Build minimal `AgentState` with `activePersona: "COMMUNICATOR"`, `isComplete: true`

### R1.2 Communicator Read-Mode
- [ ] Detect `state.isReadOnly === true` → render table/summary instead of "form created" prose
- [ ] Reuse `summaryPayload` formatting logic

### R1.3 Test & Verify
- [ ] Golden prompts: "how many forms", "show responses for form X", "analytics for form Y"
- [ ] Assert latency ~8s → ~2s (1 LLM call instead of 4)
- [ ] Trace shows `DRAFTER → COMMUNICATOR` only

---

## Phase R2 — Token/Cost Tracking (Week 3-4) — HIGH PRIORITY

### R2.1 LLM Usage Return
- [ ] Modify `retryLLM`/`callLLM` in `src/lib/llmClient.ts` to return `{ message, usage: { promptTokens, completionTokens, totalTokens, model } }`
- [ ] Parse provider-specific usage (NVIDIA `usage`, Gemini `usageMetadata`)

### R2.2 Persistence Schema
- [ ] Create `src/models/AgentUsage.ts` Mongo model:
  ```ts
  { ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, timestamp, costUsd }
  ```
- [ ] Add `tokenUsage: { total, byPersona, estimatedCost }` to `AgentState`

### R2.3 Budget Guardrails
- [ ] Env: `LLM_TOKEN_BUDGET_PER_TICKET` (default 50000), `LLM_TOKEN_BUDGET_PER_USER_DAY` (default 200000)
- [ ] Pre-check in `agentLoop` before each persona call
- [ ] Throw `LLMBudgetExceededError` → Evaluator surfaces "please rephrase with fewer details"

### R2.4 Dashboard API
- [ ] `GET /api/admin/agent/usage` — per-user/per-day/per-model breakdown

---

## Phase R3 — WebSocket Transport + Streaming (Week 5-7) — HIGH PRIORITY

### R3.1 WS Server
- [ ] Full `src/lib/wsServer.ts` — connection map `Map<userId, WebSocket[]>`
- [ ] Heartbeat 30s ping/pong, auth on connect
- [ ] Message router delegating to `runAgentLoop` with custom `onUpdate` → WS push

### R3.2 Token Streaming
- [ ] `llmClient.callOnce` supports `stream: true` — `fetch` with `ReadableStream`
- [ ] Parse `data:` SSE chunks, extract `choices[0].delta.content`
- [ ] Callback `onToken(token)` → WS `{type:"token", payload:{persona, token}}`
- [ ] Buffer in Communicator until `. ` or `\n` for smoother UX

### R3.3 Client Migration
- [ ] New hook `useAgentWS(userId)` — WS lifecycle + reconnection (exponential backoff)
- [ ] `AgentVisualizer` switches from `fetch` + `EventSource` → `useAgentWS`
- [ ] SSE fallback if WS fails after 3 retries
- [ ] Deprecate `/api/agent/health-stream` → health via WS `pong` + periodic broadcast

### R3.4 Reconnection
- [ ] On reconnect send `{type:"resume", payload:{ ticketId: lastTicketId }}`
- [ ] Server resumes from last `executionTrace` index if `activePersona !== "MERGED_TO_PRODUCTION"`
- [ ] Client replays missed trace entries locally (`localStorage` backup)

---

## Phase R4 — Concurrency Refinement (Week 8-9)

### R4.1 Lock Separation
- [ ] `agentLock.ts` → two locks per user: `agent_lock:write:{userId}` + `agent_lock:read:{userId}`
- [ ] Read lock: `SET NX PX 5000`, multiple readers; writer waits for readers to expire

### R4.2 Test
- [ ] 1 write + 3 reads concurrent → reads in parallel, write serialized

---

## Phase R5 — Multi-Turn Conversation History (Week 10-11)

### R5.1 Schema
- [ ] Add `conversationHistory: { role, content, ticketId, timestamp }[]` to `AgentState` (cap 10)

### R5.2 Persona Integration
- [ ] Planner: prepend last 3 assistant messages as "Recent context:"
- [ ] Evaluator: include history in QA payload
- [ ] Communicator: use history to avoid repeating explanations

---

## Save Points

| Save Point | Description | Files Modified |
|------------|-------------|----------------|
| SP-0 | Baseline after Part A hardening | All Part A files |
| SP-1 | R0 complete (foundation) | wsServer.ts, wsServerEntry.ts, health/mongo, PendingMerge, sandboxMerge.ts, eval CI, golden prompts, runner.ts, agent-eval.yml |
| SP-2 | R1 complete (read shortcut) | drafter.ts, permissions.ts, communicator.ts |
| SP-3 | R2 complete (token tracking) | llmClient.ts, AgentUsage.ts, agentLoop.ts, admin/usage |
| SP-4 | R3 complete (WS + streaming) | wsServer.ts, llmClient.ts, useAgentWS.ts, AgentVisualizer |
| SP-5 | R4 complete (lock separation) | agentLock.ts |
| SP-6 | R5 complete (conversation history) | types.ts, drafter.ts, planner.ts, evaluator.ts, communicator.ts |

---

## Definition of Done (per phase)
- [ ] `tsc --noEmit` clean
- [ ] New tests pass
- [ ] No regression in existing golden prompts
- [ ] Feature flag for each breaking change
- [ ] Documentation updated in `Agent.md`

---

## Current Status
- [x] Part A Hardening (P0-P3) — **COMPLETE**
- [x] R0 Foundation — **COMPLETE**
  - [x] R0.1 MongoDB Replica Set Verification
  - [x] R0.2 WebSocket Server Scaffold
  - [x] R0.3 Evaluation CI Pipeline
- [ ] R1 Read Shortcut — **NOT STARTED**
- [ ] R2 Token Tracking — **NOT STARTED**
- [ ] R3 WS + Streaming — **NOT STARTED**
- [ ] R4 Lock Separation — **NOT STARTED**
- [ ] R5 Conversation History — **NOT STARTED**