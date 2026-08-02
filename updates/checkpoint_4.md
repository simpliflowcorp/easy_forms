# Checkpoint 4 — 2026-08-02 (R2.2 — AgentUsage model + AgentState.tokenUsage)

Short-form checkpoint following R2.1 in `checkpoint_3.md`. Comprehensive grounding in
`checkpoint_1.md`.

## What was built — R2.2: Persist per-call usage + accumulate on AgentState

**Spec**: write per-call `AgentUsage` rows to Mongo at each persona LLM call; accumulate
`state.tokenUsage` (total + byPersona + estimatedCost) for the running ticket.

**Implementation** (4 files):

1. **`src/models/agentUsageModel.ts`** (NEW) — Mongo model for per-call usage rows:
   - Fields: `ticketId`, `userId`, `persona`, `model`, `promptTokens`, `completionTokens`,
     `totalTokens`, `costUsd`, `createdAt`.
   - Indexes: `{userId, createdAt: -1}` and `{ticketId, persona}`.
   - Follows the same `mongoose.models || mongoose.model` pattern as other models.

2. **`src/agent/types.ts`** — two additive fields on `AgentState`:
   - `lastLLMUsage` (transient, cleared after each capture): the `LLMUsage` returned by
     `retryLLM` for the most recent persona call.
   - `tokenUsage` (persisted, accumulated): `{ total, byPersona: Record<persona, {prompt,
     completion, total}>, estimatedCost }`. Written back to Mongo via the existing
     `persistStateToRedis` path (which throttles per P2-D3).

3. **Persona files** (`drafter.ts`, `planner.ts`, `evaluator.ts`, `communicator.ts`) — each
   captures `response?.usage` into `state.lastLLMUsage` immediately after `retryLLM` returns.
   One-liner additive; no logic change.

4. **`src/agent/agentLoop.ts`** — the wiring:
   - New import: `AgentUsageModel` from `@/models/agentUsageModel`.
   - New helper `captureLLMUsage(s: AgentState, persona: string)` called after each
     persona's LLM call (DRAFTER, PLANNER, EVALUATOR, COMMUNICATOR). Does three things:
     a) Accumulates `total`, `byPersona[persona]`, and `estimatedCost` into `s.tokenUsage`.
     b) Writes a per-call `AgentUsage` document to Mongo (fire-and-forget `.catch()` log).
     c) Clears `s.lastLLMUsage`.
   - Called at the end of DRAFTER, PLANNER, EVALUATOR, COMMUNICATOR stages in the loop.
   - EXECUTOR doesn't call LLM directly, so no capture there (kept comment for future).

**Cost estimation**: placeholder `$0.0001 / 1K tokens` → refined in R8 with real model pricing
tables. `costUsd` on the `AgentUsage` row uses the same placeholder.

**Backwards compat**: zero caller breakage; all fields are additive on `AgentState`.

## Verification

| Gate | Result |
|------|--------|
| `npm run typecheck` (`tsc --noEmit`) | ✅ exit 0 |
| `npm run lint` (`eslint .`) | ✅ exit 0 |

## Files changed (this session, about-to-commit)

- `src/models/agentUsageModel.ts` (NEW)
- `src/agent/types.ts` (`lastLLMUsage`, `tokenUsage` on `AgentState`)
- `src/agent/personas/drafter.ts` (capture `response?.usage`)
- `src/agent/personas/planner.ts` (capture `response?.usage`)
- `src/agent/personas/evaluator.ts` (capture `response?.usage`)
- `src/agent/personas/communicator.ts` (capture `response?.usage`)
- `src/agent/agentLoop.ts` (import `AgentUsageModel`, `captureLLMUsage` helper, calls after
  DRAFTER/PLANNER/EVALUATOR/COMMUNICATOR)

## What R2.2 does NOT do (deferred)

- **R2.3** — `LLMBudgetExceededError` + per-ticket / per-day budget enforcement. Needs
  `tokenUsage.total` on `AgentState` (now present) and a pre-check before each `retryLLM`
  call (or at the start of each persona).
- **R2.4** — admin dashboard route (`/api/admin/agent/usage`) for per-user / per-day /
  per-model breakdown + charts.
- **R8.2** — budget progress bar in `AgentVisualizer` header, warning toast at 80%, hard
  stop at 100%, admin bypass env.
- **Real cost table** — per-model `$/1K` pricing loaded from config/DB, not hardcoded
  `0.0001/1K`. Refined in R8.

## Cumulative state — verification sweep

Items closed across all sessions:

- Part A items: P0-1, P0-2, P0-3, P1-R1, P1-R2, P1-E1, P1-M1,
  P2-D1, P2-D2, P2-D3, P2-4, P2-5, P2-6, P2-7, P3-M2, P3-M3, P3-M4, P3-M5.
- Cleanup trio: OPEN-1, OPEN-2, OPEN-3, P-Cleanup #1, #2, #3.
- Pre-existing TSC errors (2).
- Refactor: R0.1, R0.3, R2.1, R2.2.
- Refactor partial landings still PARTIAL: R0.2 (WS server — client migration + health-stream
  deletion pending), R3 (llm-client streaming land; client-side WS+reconnect migration pending).
- Refactor deferred-to-tooling: R6.3 (ts-node+TS7 blocker; draft in git history; restore after
  TS 6 downgrade).
- Refactor OPEN (no start): R1, R2.3-R2.4, R4, R5, R6 (other sub-items), R7, R8, R-Executor-Tools,
  R9, R10.

Out-of-band: rotate the historically-committed NVIDIA key (still pending regardless of repo
cleanliness — codebase has been clean since the cleanup-trio commit `5b5ef60`).

## Suggested sequencer — next up

Per `implementation_plan.md`'s sequencer: **R2.3 — `LLMBudgetExceededError` + per-ticket
/ per-day budget enforcement**. The `state.tokenUsage.total` and `state.tokenUsage.byPersona`
are now available; just need a pre-check before each persona call (or at loop entry) that
throws `LLMBudgetExceededError` when `state.tokenUsage.total > perTicketBudget` or when
today's user usage (sum of `AgentUsage.createdAt` today) > `perDayBudget`. The Evaluator
already handles `LLMOfflineError` by routing to COMMUNICATOR with a friendly message — the
same pattern applies.

Alternative next step: **R0.2 + R3 finish** (WS client migration + reconnect + delete
`health-stream`). This is independent of R2 and can run in parallel if a second engineer is
available.