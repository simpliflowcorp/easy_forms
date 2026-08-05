# Agent D — Stage 4 Log (s4-agent-d)

**Model:** Grok 4.5 (primary) / DeepSeek V4 Flash Free (fallback)
**Branch:** `s4-agent-d` (worktree `../easy_forms_s4_d`, off `v3-stage-3-complete` = `5136fe2`)
**Track B scope:** LLMOps tier routing (#1, the Stage 4 default)

---

## D-S4.1 — OTel optionalDependencies + live-trace verification ✅

- Moved `@opentelemetry/api@^1.9.1` + `@azure/monitor-opentelemetry@^1.19.0`
  from `dependencies` → **`optionalDependencies`** (pinned stable majors,
  identical to the previously-installed versions). `package-lock.json`
  regenerated (`npm install --package-lock-only --legacy-peer-deps` — the
  pre-existing nodemailer/next-auth peer conflict is untouched; `npm ci`
  verified clean with the new lockfile, deps installed as optional).
- **Shim stays.** `src/lib/logger.ts` untouched (no signature change) — the
  local `TelemetryApi` type shim is the type-level fallback; tsc stayed green
  (verified `npx tsc --noEmit`). The npm install is the runtime source of
  truth; `ensureAppInsights()` still lazily `require()`s inside try/catch.
- **New:** `tests/agent/eval/otelTraceVerify.ts` — one-time live-trace gate
  covering all three contracts:
  1. deps + env set → `useAzureMonitor()` registers a real provider and
     `api.trace.getTracer("easy-forms-agent").startSpan("log")` creates+ends a
     real span (with a REAL `APPLICATIONINSIGHTS_CONNECTION_STRING` this is
     the span that lands on the App Insights resource — the one-time Azure
     infra gate; verified locally with a well-formed dummy key).
  2. env unset → no-op, no crash (verified).
  3. deps blocked (Module._load preload) → `require()` catches → no-op, no
     crash (verified).
- All three modes PASS. RUNBOOK §6.1 documents install + verification steps.
- No real connection string in local `.env` — the "real trace on Azure" step
  is the documented gate that runs once on Azure infra (script is ready).

## D-S4.2 — Nightly live-eval CI schedule ✅

- `.github/workflows/agent-eval.yml`:
  - Schedule trigger now `cron: '0 3 * * *'` (was 2 AM; moved per D-S4.2).
  - Renamed job `agent-eval-live` → **`nightly-live-eval`** (job name matches
    the verify command `act -W ... --job nightly-live-eval`).
  - Added **Baseline diff** step: after the live run, `diffReports.js` diffs
    tonight's `<ISO>.json` vs the previous report; a **"Fail on regressions"**
    gate step fails the job ONLY on real regressions (rows that passed before
    and fail now). First run / changed row set → `diff-clean=skip` (no fail).
  - PR gate (`agent-eval` stubbed) untouched per D-S3.5; artifact upload
    (`tests/agent/eval/reports/**`, 7-day) preserved.
- **Idempotency verified:** two consecutive stub runs (84/84) → `diffReports.js`
  shows `✅ No regressions — diff is clean` (0 regressions / 0 new failures).
  `runner.ts`/`liveSuite.ts` write `<ISO>.json` per run; `diffReports` keys on
  row ids so identical inputs → empty diff.
- `act` not installed locally; workflow YAML parsed + job/step structure
  validated via node (`yaml` package) instead.

## D-S4.3 — Multi-agent load test retest ✅

- Re-ran `node --experimental-strip-types tests/agent/multi-agent/load_test.ts`
  against the Stage 4 worktree: **P99 25ms (<30s), 0 data loss, 0 auth
  bypass** — the v3 SLAs hold (fake-orchestrator in-memory variant; real
  `Orchestrator.execute` hooks in at the integration gate).
- **Extended** the load test with a Stage 4 tier-routing wave
  (`runTierRoutingLoad`, 100 concurrent `callLLMTiered` calls with mocked LLM
  via `__testRetryLLMOverride`): **P99 8ms**, cheap model used for draft
  tiers, `tier:"draft"` attributed in AgentUsage row payloads (50 rows),
  escalation `> $0.10` → verify tier (50 rows). All green.

## D-S4.4 — LLMOps tier routing ✅ (Track B = LLMOps, the default pick)

- `src/lib/llmClient.ts` — frozen contract shipped:
  - `export type LLMRoutingTierName = "draft" | "plan" | "verify" | "communicate"`
  - `export interface LLMRoutingTier { tier; model; maxTokens }`
  - `export function resolveTier(persona, ticketCostUsd?, tierHint?)`
  - `export async function callLLMTiered(opts, onChunk?)`
  - `export const TIER_ESCALATION_COST_USD = 0.1`
  - `export const __testTieredUsageHook` (test-only attribution hook)
- Policy: draft/communicate → cheap (`LLM_MODEL_DRAFT_TIER` → `LLM_MODEL`);
  plan/verify → strong (`LLM_MODEL_VERIFY_TIER` → `LLM_MODEL`); EXECUTOR maps
  to "plan" (strong); escalation `ticketCostUsd > 0.10` → tier "verify"
  (strong model + maxTokens). Max tokens env:
  `LLM_MAX_TOKENS_DRAFT_TIER` (512) / `LLM_MAX_TOKENS_VERIFY_TIER` (1024).
- `callLLMTiered` wraps `callLLM` (plain) / `callLLMStream` (onChunk), forces
  resolved model + max_tokens, surfaces `tier` in the pino log line
  (`LLMOptions.tier` additive field), and bumps the AgentUsage row with
  `tier` (fire-and-forget, guarded — never breaks the hot path).
- **`AgentUsage.tier` coordination with C:** D only CONSUMES the schema field
  (C's add at integration). Mongoose strict mode silently drops `tier` until
  C's field lands — rows still persist. `__testTieredUsageHook` lets the
  load-test/stub assert attribution without Mongo.
- **`tierHint` passthrough:** A's personas add `tierHint` in a 1-line
  passthrough to `callLLMTiered` — no persona file signature change; the
  frozen type is `LLMRoutingTier` + `resolveTier`/`callLLMTiered` exports.
- **PII invariant verified:** `redactPII` is applied upstream in personas/
  memory before any LLM call; `callLLMTiered` passes messages through
  untouched (no cache layer added) → tier routing cannot bypass redaction.
- Verify matrix (stub): tierHint "draft" + cheap env → request hits cheap
  model ✅; AgentUsage row payload carries `tier:"draft"` ✅; `ticketCostUsd
  > 0.10` → escalates to verify-tier model ✅ (all in the load-test wave).

## D-S4.5 — Docs sync ✅

- `docs/agent/RUNBOOK.md`:
  - §4.1 LLMOps tier routing (policy, env, attribution, PII note).
  - §6.1 OTel optionalDependencies install + one-time live-trace verification.
  - §7 nightly-live-eval schedule + how to read `diffReports` (regressions vs
    new failures vs new passes) + idempotency note.
  - §8.1 skill `assert` grammar (Stage 4 eval() removal; safeAssert
    constrained grammar for skill authors).
  - §9.1 `AGENT_V3_ENABLED` drain procedure (ref. Agent A's memo; pin=true;
    schedule legacyShim delete as follow-up PR only after drain).
  - §9 feature-flag table + tier env vars.
- `docs/agent/TROUBLESHOOTING.md`:
  - §7 App Insights: optionalDependencies note (`--omit=optional` silently
    no-ops), one-time verify script, one-shot lazy-init restart note.
  - §7.1 tier routing issues (wrong model, missing tier field, double-persist
    coordination with legacy agentLoop persist path).
  - §8 eval table: nightly diff gate rows + tier wave rows + safeAssert
    validation row; §1 LLM_ERROR tier note.
- Spec coverage: `plans/agent_spec.md` §3.1 tool catalog unchanged (no
  tools.ts/agentTools.ts/permissions.json edits).

## VERIFY (worktree) — all green

```
npx tsc --noEmit          ✅ (incl. optionalDeps moved; shim fallback)
npm run lint              ✅
npm run build             ✅ (Next 16, 33 static pages; env-only DB warning pre-existing)
npm run agent:eval        ✅ 84/84 stub (idempotent, diff clean)
npm run agent:validate-skills ✅ 6 skills
node --experimental-strip-types tests/agent/multi-agent/load_test.ts ✅
  multi-agent: P99 25ms, 0 data loss, 0 auth bypass
  tier wave:    P99 8ms, cheap-for-draft, tier attribution, escalation
tests/agent/eval/otelTraceVerify.ts ✅ all 3 modes
npm run agent:eval:live -- --skip ✅ writes skip report
```

## Integration notes for the gate

1. **`AgentUsage.tier`** — C's schema add (`tier: { type: String }` on
   `agentUsageModel.ts`); D's `callLLMTiered` passes `tier` in the row
   payload. Until C's field lands, Mongoose strict mode silently drops it.
2. **Double-persist** — the legacy `agentLoop.ts` persist path ALSO writes
   AgentUsage rows; tiered calls write via `callLLMTiered`. At integration,
   personas route through `callLLMTiered` (legacy persist is the drain path)
   — see TROUBLESHOOTING §7.1.
3. **`tierHint`** — personas add it as a 1-line passthrough; frozen type is
   the `LLMRoutingTier`/`resolveTier`/`callLLMTiered` exports.
4. **eval() removal** — D depends on B's `safeAssert.ts` + A's `evaluator.ts`
   swap for the security gate (`grep eval\(` in `src/agent/**` must be zero);
   D's docs/load-test only reference the new grammar.
5. **OTel install** — optionalDependencies merged FIRST (isolated commit
   `e3eaa90`); logger interface unchanged so A/B/C consumers unaffected.
6. **Nightly job rename** — `nightly-live-eval` replaces `agent-eval-live`;
   any external refs to the old job name must be updated.
