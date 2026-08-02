# Checkpoint 7 — 2026-08-02 (R0.2 + R3 — WebSocket Transport & Streaming)

Short-form checkpoint following R2.4 in `checkpoint_6.md`.

## What was built — R0.2 + R3: WebSocket Transport + Streaming

**Spec**: Complete WebSocket transport layer with token streaming, client migration from SSE, reconnection with state replay, and deletion of legacy SSE `health-stream`.

**Implementation** (6 files created/modified):

1. **`src/hooks/useAgentWS.ts`** (NEW) — Client-side WebSocket hook:
   - Exponential backoff reconnection (1s → 2s → 4s ... max 30s, 10 attempts).
   - Message queue for offline sends (flushes on reconnect).
   - LocalStorage persistence of last `AgentState` + `ticketId` for state replay.
   - Token streaming via `onToken(persona, chunk)` callback.
   - State updates via `onState(state)`.
   - Health updates via `onHealth(status)`.
   - Reconnect notifications via `onReconnect(attempt)`.
   - Message types: `connected`, `state`, `token`, `busy`, `error`, `done`, `health`, `pong`, `replay`, `prompt`, `merge`, `resume`, `ping`.

2. **`src/lib/wsServer.ts`** — Server-side WebSocket (standalone, runs on port 3001):
   - JWT auth via query string token (reuses `TOKEN_SECRET`).
   - Per-user connection tracking (`Map<userId, Set<WSClient>>`).
   - 30s heartbeat (ping/pong).
   - Subscribes to `agent:llm_health` Redis channel → broadcasts `health` messages.
   - `sendTokenToUser(userId, persona, token)` for per-user token streaming.
   - Message handlers: `prompt`, `merge`, `resume`, `ping`.
   - All `runAgentLoop` calls now include `onChunk` callback → `sendTokenToUser`.
   - Exports `sendTokenToUser` for health monitor integration.

3. **`src/app/api/ws/route.ts`** (NEW) — Next.js API route documenting WS endpoint (actual WS server runs standalone on port 3001 via `wsServerEntry.ts`).

4. **`src/hooks/useAgentWS.ts`** (replaces `useWebSocket.ts`) — Full-featured hook replacing legacy `useWebSocket.ts`.

5. **`src/app/agent/page.tsx`** — Migrated from SSE (`fetch` + `EventSource`) to `useAgentWS`:
   - Uses `useAgentWS` with `onState`, `onToken`, `onBusy`, `onError`, `onHealth`, `onConnected`, `onDisconnected`, `onReconnect`.
   - Token streaming updates `streamingContent` state for live UI.
   - Health status displayed in header.
   - Connection status indicator with reconnect toast.

6. **Deleted**: `src/app/api/agent/health-stream/route.ts` — legacy SSE endpoint removed; health now via WS `health` messages.

**Key R3 feature**: Token streaming from `llmClient.ts` → `agentLoop.ts` `onChunk` → WS `sendTokenToUser` → client `onToken` callback → UI live token rendering.

**Verified**: `npm run typecheck` ✅ | `npm run lint` ✅

---

## Files changed (this session, about-to-commit)

- `src/hooks/useAgentWS.ts` (NEW — replaces `useWebSocket.ts`)
- `src/lib/wsServer.ts` (major rewrite: token streaming, `sendTokenToUser`, health broadcast)
- `src/app/api/ws/route.ts` (NEW — documentation endpoint)
- `src/app/agent/page.tsx` (migrated to `useAgentWS`, WS-based)
- `src/app/api/agent/health-stream/route.ts` (DELETED)
- `src/hooks/useWebSocket.ts` (DEPRECATED — kept for reference)

---

## Cumulative state

Items closed across all sessions:

- Part A items: P0-1, P0-2, P0-3, P1-R1, P1-R2, P1-E1, P1-M1, P2-D1, P2-D2, P2-D3, P2-4, P2-5, P2-6, P2-7, P3-M2, P3-M3, P3-M4, P3-M5.
- Cleanup trio: OPEN-1, OPEN-2, OPEN-3, P-Cleanup #1, #2, #3.
- Pre-existing TSC errors (2).
- Refactor: R0.1, R0.3, **R0.2 + R3**, R2.1, R2.2, R2.3, R2.4.
- Refactor partial landings still PARTIAL: none remaining (R0.2/R3 done).
- Refactor deferred-to-tooling: R6.3 (ts-node+TS7 blocker; draft in git history; restore after TS 6 downgrade).
- Refactor OPEN (no start): R1, R4, R5, R6 (other sub-items), R7, R8, R-Executor-Tools, R9, R10.

Out-of-band: rotate the historically-committed NVIDIA key (still pending).

---

## Suggested sequencer — next up

Per `implementation_plan.md`:

1. **R1** — Read shortcut (Drafter short-circuit for `STAGE_1`). Pure refactor, P0-2/P1-R2 preconditions already done. ~2 weeks.
2. **R4** — Read/write lock separation. Depends on R1.
3. **R5** — `conversationHistory` on `AgentState`.
4. **R6** — Eval harness hardening (stub-stack runner, 50 golden prompts, regression tests).
5. **R7** — Prompt versioning + A/B.
6. **R8** — Presets + budget UI (depends on R2 data).
7. **R9** — Trace optimization + docs.
8. **R10** — Hardening & release (load/chaos/canary + runbook drills).

**R1 is the highest-leverage next deliverable** — cuts read-query latency from ~8s (4 LLM calls) to ~2s (1 LLM call) by short-circuiting Drafter → Communicator for `STAGE_1` reads.