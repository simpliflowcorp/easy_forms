# Implementation Log — Part B Refactor

**Started:** 2026-08-01  
**Phase:** R0 Foundation → R1 Read Shortcut → R2 Token Tracking → R3 WS Streaming

---

## Save Point SP-0: Baseline (Part A Complete)
**Date:** 2026-08-01  
**Status:** ✅ Complete  
**Files:** All Part A hardening (P0-P3)  
**Verification:** 
- `grep -rn "nvapi-" src/` → empty
- `grep -rn 'executeAgentTool("(create|update|delete)_form' src/` → empty
- `grep -c "state!" src/agent/agentLoop.ts` → 0
- `tsc --noEmit` → only pre-existing unrelated errors

---

## R0.1 MongoDB Replica Set Verification
**Status:** ✅ Complete  
**Completed:** 2026-08-01  

### Tasks:
- [x] Verify MONGODB_URI points to replica set (health endpoint checks `isMaster`)
- [x] Document standalone fallback via PendingMerge collection in `sandboxMerge.ts`
- [x] Add /api/health/mongo endpoint

### Changes:
- Created `src/app/api/health/mongo/route.ts` - health endpoint returning readyState, isMaster, replicaSet, members
- Created `src/models/PendingMerge.ts` - model for two-phase merge fallback
- Updated `src/agent/sandbox/sandboxMerge.ts`:
  - Added `mergeSandboxToProductionStandalone()` function for standalone MongoDB
  - Modified `mergeSandboxToProduction()` to try transaction first, fall back to standalone on failure
  - Detects standalone errors (IllegalOperation, replica set messages)

### Learning:
- MongoDB transactions require replica set; standalone throws "IllegalOperation" or "Transaction not supported"
- Two-phase merge via PendingMerge collection provides idempotency without transactions
- Unique index on (ticketId, userId) prevents duplicate merges
- Fallback preserves all safety guarantees: idempotency keys, optimistic concurrency, audit events

---

## R0.2 WebSocket Server Scaffold
**Status:** ✅ Complete  
**Completed:** 2026-08-01  

### Tasks:
- [x] Create `src/lib/wsServer.ts` - WebSocket server with authentication, message handling, connection management
- [x] Create `src/lib/wsServerEntry.ts` - Standalone entry point for running WS server on separate port
- [x] Create `src/app/api/ws/route.ts` - API endpoint returning WS server URL for clients
- [x] Connection auth: reuses JWT verification from `/api/agent/execute`
- [x] Message protocol: prompt, merge, resume, ping/pong
- [x] Health broadcast channel `agent:llm_health` → WS push
- [x] Added `ws:server` and `dev:ws` scripts to package.json
- [x] Added `concurrently` dev dependency
- [x] Updated `.env.example` with `WS_PORT` and `NEXT_PUBLIC_WEBSOCKET_URL`

### Changes:
- `src/lib/wsServer.ts` - Full WS server implementation with:
  - Per-user connection map (`Map<userId, Set<WSClient>>`)
  - JWT authentication via query param token
  - Message router delegating to `runAgentLoop` with custom `onUpdate` → WS push
  - Heartbeat 30s ping/pong
  - Redis subscription to `agent:llm_health` for broadcast
  - Message types: connected, state, token, busy, error, done, pong
- `src/lib/wsServerEntry.ts` - Standalone server entry point
- `src/app/api/ws/route.ts` - Returns WS URL for client connection
- `package.json` - Added `ws:server`, `dev:ws` scripts and `concurrently` dependency

### Learning:
- Next.js App Router doesn't support WebSocket upgrades directly; standalone server on separate port is the standard approach
- Connection auth via JWT token in query string works well for WS (no cookies in WS handshake)
- Redis pub/sub for health broadcasts decouples WS server from health monitor
- `runAgentLoop` with custom `onUpdate` callback enables real-time state streaming
- Need to handle token streaming in R3.2 - will require modifying `llmClient.ts` to support streaming callbacks

---

## R0.3 Evaluation CI Pipeline
**Status:** ✅ Complete  
**Completed:** 2026-08-01  

### Tasks:
- [x] Create `tests/agent/eval/golden-prompts.jsonl` (15 baseline prompts)
- [x] Create `tests/agent/eval/runner.ts` — headless `runAgentLoop` execution
- [x] Add `.github/workflows/agent-eval.yml` — runs on PR + nightly
- [x] Add `agent:eval` script to package.json

### Changes:
- `tests/agent/eval/golden-prompts.jsonl` - 15 prompts covering:
  - Read queries (5): count forms, list forms, count responses, analytics, custom views
  - Build forms (3): contact, feedback, registration
  - Edit form (1): add dropdown field
  - Delete form (1)
  - Filter responses (1)
  - Custom view (1)
  - Product guide (1)
  - Vague clarification (1)
  - Follow-up confirmation (1)
- `tests/agent/eval/runner.ts` - Headless test runner that:
  - Connects to DB, creates/finds test user
  - Runs each prompt through `runAgentLoop`
  - Asserts: expected tools used, iterations within budget, complete=true, no LLM_ERROR/REJECTED
  - Exits with code 1 on any failure
- `.github/workflows/agent-eval.yml` - CI workflow:
  - Runs on PR/push to main/develop (path-filtered to agent files)
  - Nightly schedule (2 AM UTC)
  - Sets up Node, installs deps, starts Redis, waits for MongoDB
  - Runs `npm run agent:eval`
  - Includes typecheck and lint jobs
- `package.json` - Added `agent:eval` script

### Learning:
- Golden prompts should be categorized for easier debugging
- Test runner needs a dedicated test user to avoid polluting real data
- CI needs to wait for MongoDB/Redis to be ready before running tests
- Path filtering in GitHub Actions prevents unnecessary runs
- Nightly runs catch model drift (prompt regressions over time)

---

## R1.1 Drafter Short-Circuit for STAGE_1
**Status:** ⏳ Pending  
**Files:** src/agent/personas/drafter.ts, src/agent/policy/permissions.ts, src/agent/agentLoop.ts

---

## R1.2 Communicator Read-Mode
**Status:** ⏳ Pending  
**Files:** src/agent/personas/communicator.ts

---

## R2.1 LLM Usage Return
**Status:** ⏳ Pending  
**Files:** src/lib/llmClient.ts

---

## R2.2 Persistence Schema
**Status:** ⏳ Pending  
**Files:** src/models/AgentUsage.ts, src/agent/types.ts

---

## R2.3 Budget Guardrails
**Status:** ⏳ Pending  
**Files:** src/agent/agentLoop.ts, src/agent/personas/evaluator.ts

---

## R3.1 WS Server
**Status:** ⏳ Pending  
**Files:** src/lib/wsServer.ts, src/app/api/ws/route.ts

---

## R3.2 Token Streaming
**Status:** ⏳ Pending  
**Files:** src/lib/llmClient.ts, src/agent/agentLoop.ts

---

## R3.3 Client Migration
**Status:** ⏳ Pending  
**Files:** src/components/AgentVisualizer/*, src/hooks/useAgentWS.ts

---

## R4.1 Lock Separation
**Status:** ⏳ Pending  
**Files:** src/agent/sandbox/agentLock.ts

---

## R5.1 Conversation History Schema
**Status:** ⏳ Pending  
**Files:** src/agent/types.ts, src/agent/agentLoop.ts

---

## R5.2 Persona Integration
**Status:** ⏳ Pending  
**Files:** src/agent/personas/drafter.ts, src/agent/personas/planner.ts, src/agent/personas/evaluator.ts, src/agent/personas/communicator.ts

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