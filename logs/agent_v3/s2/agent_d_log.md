# Agent D — Stage 2 Execution Log (LLMOps / Eval / UI / Docs)

Branch: `s2-agent-d` (worktree `../easy_forms_s2_d`), off `agent_v3` (`882f918`).

## Status

All D-S2.x tasks implemented and verified locally (tsc clean, lint clean, `npm run agent:eval:stub` green). Live `npm run agent:eval` remains red — pre-existing broken (NodeNext + ts-node CJS), sealed, NOT touched per brief.

## Task → commit mapping

| Task | Files | Verify |
|---|---|---|
| D-S2.1 | `src/lib/llmClient.ts`, `src/agent/prompts/loader.ts`, `tsconfig.json` | stub meta row `llm_persona_model_resolution` (env `LLM_MODEL_DRAFTER=foo` → resolved `options.model === "foo"`, temp 0.2) |
| D-S2.2 | `src/lib/llmClient.ts`, `src/lib/costCalculator.ts` (NEW) | stub meta row `llm_fallback_on_offline` (primary `LLMOfflineError` → fallback OK; `usage.model === fallback-model`; 2 fetch calls) |
| D-S2.3 | `src/lib/llmClient.ts`, `src/lib/llmHealthMonitor.ts`, `src/lib/logger.ts` | pino JSON lines per LLM call incl. fallback warn with persona/model |
| D-S2.4 | `tests/agent/eval/golden-prompts.jsonl` (18 new rows), `fixtures/goldenContract.ts`, `fixtures/shapeMatcher.ts`, `runner.ts`, `stubRunner.ts` | 66 pass / 0 fail / 18 deferred skip |
| D-S2.5 | `tests/agent/eval/negative-prompts.jsonl` (12 rows), `fixtures/negativeContract.ts` | all 12 denied as expected in stub; live runner wired |
| D-S2.6 | `tests/agent/eval/reports/<ISO>.json`, `diffReports.js` | two consecutive stub runs → diff shows 0 regressions; branches 39/53 (74%) |
| D-S2.7 | `src/components/ActionBar/AgentConfirmationModal.tsx` | selective-merge checkboxes + master; POST `/api/agent/execute` w/ `mergeApprovedActionIds` |
| D-S2.8 | `src/components/ActionBar/SandboxPreviewModal.tsx` (NEW) | read-only preview via `DynamicFieldManger` (existing FormRenderer pattern) |
| D-S2.9 | `.agents/Agent.md` §2 | scopes + 18-tool list + selective-merge + LLMOps bullets added, nothing removed |

## Integration notes for the coordinator

1. **`recordAgentUsage` missing (D-S2.2).** The plan's frozen contract names `recordAgentUsage(...)` exported from `src/models/agentUsageModel.ts`, but Stage 1 only added `latencyMs` — no such export exists in `agent_v3`. I did NOT edit `agentUsageModel.ts` (Agent C owns it). Instead the fallback path attributes cost through the EXISTING loop write (`agentLoop.ts:145`): `usage.model` carries the fallback model id, so the AgentUsage row is attributed to the serving model, and `LLMResult.costUsd` is computed via `src/lib/costCalculator.ts`. If Agent C ships `recordAgentUsage` in Stage 2, it should be called from `callOnceWithFallback`; until then the loop write is the attribution path. Flagged for coordinator decision.
2. **`MergeRequest` not yet in `src/agent/sandbox/types.ts`** (Agent B hasn't pushed). `AgentConfirmationModal.tsx` mirrors the frozen shape `{ ticketId, userId, mergeApprovedActionIds: string[] }` locally with a comment; at the gate it must be aliased to the import from B's file. Coordination: A's `agentLoop.ts` resume path reads `mergeApprovedActionIds` (one-line passthrough); B's `sandboxMerge.ts` filters by it before applying.
3. **`getSandboxPreview` not yet in `src/lib/agentTools.ts`** (Agent B hasn't pushed). `SandboxPreviewModal.tsx` codes against the frozen contract `{ elements, name, description }`: it uses B's function when present (runtime check via static import + cast) and falls back to `GET /api/agent/sandbox/preview?ticketId=` (route to be shipped by B). Read-only — no merge, no prod write, no TTL touch.
4. **`Persona` type:** `src/agent/types.ts` (Agent A) has `PersonaStage` but no plain `Persona` union. `llmClient.ts` exports its own `Persona` union (5 entries). If A ships `Persona` in `types.ts`, alias mine to it at the gate.
5. **`allowImportingTsExtensions: true` added to `tsconfig.json`** (safe: `noEmit: true`). Required because `llmClient.ts` now imports `logger.ts`/`costCalculator.ts`, and `node --experimental-strip-types` cannot resolve `.js` specifiers to `.ts` files. All my src imports use `.ts` extensions, consistent with the stub runner convention. Other agents unaffected (additive flag).
6. **`.agents/Agent.md` is gitignored** — the D-S2.9 doc patch is NOT carried by git. The coordinator may want to un-ignore or replicate §2 changes to a tracked doc. (The committed `src/agent/Agent.md` is a different, persona-spec doc — untouched.)
7. **Reports are untracked** (`tests/agent/eval/reports/` keeps `.gitkeep`); diffReports.js works against local report history. `nightlyDrift.ts` still parses the same report shape (`summary`/`results`).
8. **Eval rows reference B's tool names** — all 18 golden rows are tagged `deferToIntegration: true`; the stub skips them cleanly (18 skipped, logged). After B merges, the live runner executes them (tool-existence check via `agentToolsSchema`).

## Verify summary (worktree)

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — passed (incremental)
- `npm run agent:eval:stub` — 66 passed / 0 failed / 18 skipped (deferred); branches 39/53 (74%); two-run diff: 0 regressions
- `npm run agent:eval` — NOT run (pre-existing broken, sealed)
