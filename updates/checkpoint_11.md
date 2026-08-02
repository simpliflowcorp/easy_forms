# Checkpoint 11 — 2026-08-02 (R4 — Read/Write Lock Separation)

Short-form checkpoint following R5 in `checkpoint_10.md`.

## What was built — R4: Read/Write Lock Separation

**Spec**: Separate the per-user lock into read and write locks so read-only queries (STAGE_1) can run concurrently while mutations remain exclusive.

**Implementation** (2 files):

1. **`src/agent/sandbox/agentLock.ts`** — Complete rewrite with read/write lock separation:
   - **Write lock**: `agent_lock:write:{userId}` — exclusive, TTL 60s, Lua CAS release (compare-and-del by ticketId). Acquired for mutations (build/edit/delete forms).
   - **Read lock**: `agent_lock:read:{userId}` — shared counter, TTL 5s, auto-expires. Multiple readers increment/decrement counter. Acquired for read-only skills (`READ_ONLY_SKILLS`).
   - Writer waits for active readers to drain (max 5s) before proceeding.
   - Readers auto-expire via short TTL (5s), preventing starvation.

2. **`src/agent/agentLoop.ts`** — Lock acquisition flow:
   - **Classification phase**: Acquires short "classification lock" (5s TTL) to prevent double-submits during Drafter classification.
   - **Drafter runs first** to classify the request and determine skill.
   - **Lock decision**: After Drafter classifies, checks `READ_ONLY_SKILLS.has(skill)`:
     - Read-only skill → acquires read lock (short-circuit path, already handles in R1)
     - Mutating skill → acquires write lock (waits for readers to drain, max 5s)
   - **Merge path**: Immediately acquires write lock (bypasses classification).
   - **Classification lock**: Short 5s lock acquired before Drafter runs to prevent double-submits during classification.

**Key changes to `agentLoop.ts`**:
   - New imports: `READ_ONLY_SKILLS` from permissions
   - Classification lock acquired before Drafter runs (released in finally block)
   - Drafter runs FIRST to classify, then appropriate lock acquired
   - Merge path: immediate write lock acquisition
   - Non-merge: classification lock → Drafter → appropriate lock based on skill

**Dependencies**: Uses `READ_ONLY_SKILLS` from R1 (permissions.ts) and `AgentBusyError` from types.

**Verification**:
- `npm run typecheck` ✅
- `npm run lint` ✅

---

## Cumulative State (12 sessions)

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
| 9 | R1 — Read shortcut | `905d7fd` |
| 10 | R5 — Conversation History | `3128ff0` |
| 11 | **R4 — Read/Write Lock Separation** | *(pending)* |

---

## Next Up

1. **R7** — Prompt versioning + A/B (`src/agent/prompts/v1/*.json`)
2. **R8** — Presets + budget UI (depends on R2 data)
3. **R9** — Trace optimization + docs
4. **R10** — Hardening & release

**TS6 Downgrade** still recommended to unblock R6 runner.