# Checkpoint 12 — 2026-08-02 (R7 — Prompt Versioning + A/B Testing)

Short-form checkpoint following R4 in `checkpoint_11.md`.

## What was built — R7: Prompt Versioning + A/B Testing

**Spec**: Extract inline prompts to versioned JSON files, add a loader with A/B testing support, and enable per-user override via cookie.

**Implementation** (6 files):

1. **`src/agent/prompts/v1/drafter.json`** — Drafter system prompt + output schema (Zod-compatible)
2. **`src/agent/prompts/v1/planner.json`** — Planner system prompt + output schema
3. **`src/agent/prompts/v1/evaluator.json`** — Evaluator system prompt + output schema
4. **`src/agent/prompts/v1/communicator.json`** — Communicator system prompt + output schema
5. **`src/agent/prompts/loader.ts`** — Loader with:
   - Version resolution: cookie override > A/B flag > env default (`AGENT_PROMPT_VERSION`) > v1
   - A/B testing: `AGENT_PROMPT_AB=v2:0.1` (10% get v2)
   - Per-user override: cookie `agent_prompt_version=v2`
   - `loadPersonaPrompt(persona, req)` — returns `{ systemPrompt, outputSchema, version }`
   - `listPromptVersions()`, `validatePromptVersion()`
5. **Persona updates** (`drafter.ts`, `planner.ts`, `evaluator.ts`, `communicator.ts`):
   - Replaced inline `DRAFTER_SYSTEM_PROMPT` etc. constants with `loadPersonaPrompt("persona")`
   - Removed inline `*_SYSTEM_PROMPT` constants
   - Updated imports to use `loadPersonaPrompt` from `../prompts/loader`

**Env vars**:
- `AGENT_PROMPT_VERSION=v1` (default)
- `AGENT_PROMPT_AB=v2:0.1` (A/B: 10% get v2)

**A/B flow**: 
1. Cookie `agent_prompt_version=v2` → highest priority
2. `AGENT_PROMPT_AB=v2:0.1` → 10% random assignment to v2
3. `AGENT_PROMPT_VERSION=v1` → env default
4. `v1` → fallback

**Verification**:
- `npm run typecheck` ✅
- `npm run lint` ✅

---

## Files changed (this session)

- `src/agent/prompts/v1/drafter.json` (NEW)
- `src/agent/prompts/v1/planner.json` (NEW)
- `src/agent/prompts/v1/evaluator.json` (NEW)
- `src/agent/prompts/v1/communicator.json` (NEW)
- `src/agent/prompts/loader.ts` (NEW)
- `src/agent/personas/drafter.ts` (updated)
- `src/agent/personas/planner.ts` (updated)
- `src/agent/personas/evaluator.ts` (updated)
- `src/agent/personas/communicator.ts` (updated)
- `src/agent/prompts.ts` (can be deprecated/removed)

---

## Cumulative State (13 sessions)

| Session | Deliverable | Commit |
|---------|-------------|--------|
| 1 | Cleanup trio + lint | `5b5ef60` |
| 2 | R6.3 blocked doc | `d1dfa91` |
| 3 | R2.1 — `retryLLM` returns `LLMUsage` | `8a6374f` |
| 4 | R2.2 — `AgentUsage` model + `tokenUsage` | `606ed37` |
| 5 | R2.3 — Budget enforcement | `7e9e683` |
| 6 | R2.4 — Admin dashboard | `4478c72` |
| 7 | R0.2 + R3 — WS transport + token streaming | `562864e` |
| 8 | R6 — Eval harness hardening | `6f7aa33` |
| 9 | R1 — Read shortcut | `905d7fd` |
| 10 | R5 — Conversation History | `3128ff0` |
| 11 | R4 — Lock Separation | `6dcc57e` |
| 12 | **R7 — Prompt Versioning + A/B** | *(pending)* |

---

## Next Up

1. **R8** — Presets + budget UI (depends on R2 data)
2. **R9** — Trace optimization + docs
3. **R10** — Hardening & release

**TS6 Downgrade** still recommended to unblock R6 runner.