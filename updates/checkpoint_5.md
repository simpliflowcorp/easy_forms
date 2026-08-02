# Checkpoint 5 — 2026-08-02 (R2.3 — Budget Enforcement)

Short-form checkpoint following R2.2 in `checkpoint_4.md`.

## What was built — R2.3: Per-ticket / per-user-daily budget enforcement

**Spec**: enforce `LLM_TOKEN_BUDGET_PER_TICKET` (default 50,000) and `LLM_TOKEN_BUDGET_PER_USER_DAY`
(default 200,000). Pre-check before each persona LLM call; throw `LLMBudgetExceededError` which
the `handleFailure` path converts to a friendly user message and keeps the ticket alive (`LLM_ERROR`
status, resumable).

**Implementation** (2 files):

1. **`src/lib/llmClient.ts`** — new error class:
   - `LLMBudgetExceededError extends Error` with `budgetType: "per_ticket" | "per_day"`.
   - Evaluator/loop already handles `LLMOfflineError` by routing to COMMUNICATOR; same pattern applies.

2. **`src/agent/agentLoop.ts`**:
   - New import: `LLMBudgetExceededError` from `@/lib/llmClient`.
   - Config constants: `PER_TICKET_BUDGET = 50000`, `PER_USER_DAY_BUDGET = 200000` (env-overridable).
   - `checkBudget(s: AgentState)` async helper called at the top of each `while (isLooping)` iteration:
     - Per-ticket: if `s.tokenUsage.total >= PER_TICKET_BUDGET` → throw `LLMBudgetExceededError("per_ticket")`.
     - Per-user-daily: `AgentUsageModel.aggregate({ $match: { userId, createdAt: { $gte: startOfDay } } }, { $group: { _id: null, total: { $sum: "$totalTokens" } } })`; if `todayTotal >= PER_USER_DAY_BUDGET` → throw `LLMBudgetExceededError("per_day")`.
   - Called at the top of `while (isLooping)` before any persona LLM call.
   - `handleFailure` updated: catches `LLMBudgetExceededError`, sets `state.ticket.status = "LLM_ERROR"`, `isComplete = false`, and returns a friendly message distinguishing per-ticket vs per-day budget. Ticket stays alive (`LLM_ERROR` status) so user can resume.

**Env vars** (add to `.env.example` later):
- `LLM_TOKEN_BUDGET_PER_TICKET=50000`
- `LLM_TOKEN_BUDGET_PER_USER_DAY=200000`

**Backwards compat**: zero breaker; only adds checks. Existing behaviour unchanged when budgets not exceeded.

**Verified**: `npm run typecheck` ✅ | `npm run lint` ✅

---

## Files changed (this session, about-to-commit)

- `src/lib/llmClient.ts` — `LLMBudgetExceededError` class
- `src/agent/agentLoop.ts` — `checkBudget` helper, `LLMBudgetExceededError` import, `handleFailure` budget handling, `checkBudget(state)` called at loop start

---

## Cumulative state

Items closed across all sessions:

- Part A items: P0-1, P0-2, P0-3, P1-R1, P1-R2, P1-E1, P1-M1, P2-D1, P2-D2, P2-D3, P2-4, P2-5, P2-6, P2-7, P3-M2, P3-M3, P3-M4, P3-M5.
- Cleanup trio: OPEN-1, OPEN-2, OPEN-3, P-Cleanup #1, #2, #3.
- Pre-existing TSC errors (2).
- Refactor: R0.1, R0.3, R2.1, R2.2, **R2.3**.
- Refactor partial landings still PARTIAL: R0.2 (WS server — client migration + health-stream deletion pending), R3 (llm-client streaming land; client-side WS+reconnect migration pending).
- Refactor deferred-to-tooling: R6.3 (ts-node+TS7 blocker; draft in git history; restore after TS 6 downgrade).
- Refactor OPEN (no start): R1, R2.4 (admin dashboard), R4, R5, R6 (other sub-items), R7, R8, R-Executor-Tools, R9, R10.

Out-of-band: rotate the historically-committed NVIDIA key (still pending).

---

## Suggested sequencer — next up

Per `implementation_plan.md`: **R2.4 — admin dashboard** (`/api/admin/agent/usage` route + charts). Depends on R2.2/2.3 data.

Alternative parallel track: **R0.2 + R3 finish** (WS client migration + reconnect + delete `health-stream`). Independent of R2.

R1 (read shortcut) also now unblocked (P0-2/P1-R2 shipped) — pure code refactor, can run in parallel.