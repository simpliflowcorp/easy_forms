# Checkpoint 9 — 2026-08-02 (R1 — Read Shortcut / Parallel Read Path)

Short-form checkpoint following R6 in `checkpoint_8.md`.

## What was built — R1: Read Shortcut / Parallel Read Path

**Spec**: Pure `STAGE_1` read queries (`run_database_query`, `filter_responses`, `generate_analytics_skill`, `manage_custom_views` reads) previously burned 4 LLM calls (Drafter → Planner → Executor → Evaluator → Communicator). The R1 short-circuit routes read-only skills directly: **DRAFTER → COMMUNICATOR**, cutting latency from ~8s to ~2s.

**Implementation** (4 files):

1. **`src/agent/policy/permissions.ts`** — Added `READ_ONLY_SKILLS` set:
   ```typescript
   export const READ_ONLY_SKILLS = new Set([
     "run_database_query",
     "filter_responses", 
     "generate_analytics_skill",
     "manage_custom_views", // read-only custom view ops
   ]);
   ```

2. **`src/agent/types.ts`** — Added `isReadOnl`y flag to `AgentState`:
   ```typescript
   isReadOnly?: boolean; // R1: bypasses Planner/Executor/Evaluator
   ```

3. **`src/agent/personas/drafter.ts`** — Read-only short-circuit:
   - After LLM classification, if `READ_ONLY_SKILLS.has(llmAnalysis.skill)`:
     - Calls `executeAgentTool(skill, params, userId)` directly (the read-only tool)
     - Returns minimal `AgentState` with:
       - `activePersona: "COMMUNICATOR"`
       - `isComplete: true`
       - `isReadOnly: true`
       - `actionPlan` with single read action
     - Bypasses PLANNER/EXECUTOR/EVALUATOR entirely (saves 3 LLM calls)
   - Removed legacy STAGE_1 → PLANNER routing block (now handled by short-circuit)

4. **`src/agent/personas/communicator.ts`** — Read-only mode:
   - New `formatReadOnlyResults()` helper formats tool results directly:
     - ≤5 rows → markdown table
     - >5 rows → CSV download link
   - If `state.isReadOnly`: calls `formatReadOnlyResults()` and returns immediately **without LLM call**
   - Preserves existing formatting rules (table for ≤5, CSV for >5)

**Verification**: 
- `npm run typecheck` ✅
- `npm run lint` ✅

---

## R1 Impact

| Metric | Before | After |
|--------|--------|-------|
| LLM calls for read | 4 (Drafter→Planner→Executor→Evaluator→Communicator) | 1 (Drafter→Communicator) |
| Estimated latency | ~8s | ~2s |
| Token cost | ~4x | 1x |

---

## Cumulative State

| Session | Deliverable | Commit |
|---------|-------------|--------|
| 1 | Cleanup trio + lint config | `5b5ef60` |
| 2 | R6.3 blocked doc | `d1dfa91` |
| 3 | R2.1 — `retryLLM` returns `LLMUsage` | `8a6374f` |
| 4 | R2.2 — `AgentUsage` model + `tokenUsage` | `606ed37` |
| 5 | R2.3 — Budget enforcement | `7e9e683` |
| 6 | R2.4 — Admin dashboard | `4478c72` |
| 7 | R0.2 + R3 — WS transport + token streaming | `562864e` |
| 8 | R6 — Eval harness hardening | `6f7aa33` |
| 9 | **R1 — Read shortcut** | *(pending)* |

---

## Next Up

1. **R4** — Read/write lock separation (depends on R1's `READ_ONLY_SKILLS`)
2. **R5** — `conversationHistory` on `AgentState`
3. **R7** — Prompt versioning + A/B
4. **R8** — Presets + budget UI (depends on R2 data)
5. **R9** — Trace optimization + docs
6. **R10** — Hardening & release

---

## Next Step

Commit R1, then move to R4 (lock separation) which depends on R1's `READ_ONLY_SKILLS`.