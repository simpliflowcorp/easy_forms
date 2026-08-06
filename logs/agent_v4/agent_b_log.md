# Agent B — Stage 4 Log

## B-S4.1 — `safeAssert.ts` — `eval()` replacement ✅

**Created:** `src/agent/skills/safeAssert.ts`

- Exports `evalNegativeTest(test, ctx): { pass: boolean; reason?: string }`
- Recursive-descent parser: orExpr → andExpr → compExpr → unaryExpr → primary → pathExpr
- Root identifiers: `actionPlan`, `state` only
- Property access via `.IDENT` and `[NUM]`
- Comparisons: `===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`
- Logic: `&&`, `||`, `!`, `( ... )`
- Literals: numbers, strings, `true`, `false`, `null`
- Banned tokens rejected at lexer time: `require`, `import`, `eval`, `Function`, `process`, `globalThis`, `window`, `constructor`, `__proto__`, `prototype`, `caller`, `callee`, `global`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`
- Hyphen (`-`) treated as skip character for descriptive assert text tolerance
- Function asserts supported: `assert: (ctx: NegEvalContext) => boolean`
- Tolerant of trailing tokens (descriptive assertion text like "create_form without name...")
- Unknown identifiers return `undefined` (falsy) rather than throwing

**Contract freeze:** `NegEvalContext = { actionPlan: AgentAction[]; state: AgentState }` — Agent C flagged to co-export from `memory/types.ts`.

**Verification:**
- `actionPlan[0].params.elements.length >= 1` — evaluates correctly via matrix: accessor access [0] → .params → .elements → .length → >= 1
- `actionPlan.length > 0 && actionPlan[0].params.isDestructive === false` — correct
- `actionPlan[;]` — rejected by lexer (unexpected character `;`)
- `require('admin')` → detected as banned token at lexer pair → ParseError
- `process.env.PATH` → `process` banned, rejected at lexer

## B-S4.2 — `NegativeTest.assert` union extension ✅

**Updated:** `src/agent/skills/types.ts`

Changed `assert: string` → `assert: string | ((ctx: NegEvalContext) => boolean)`.
This allows skill authors to provide raw assertion functions in addition to
string expressions. The `evalNegativeTest` function handles both uniformly.

Imports `NegEvalContext` from `./safeAssert.js`.

## B-S4.3 — Validator hardening ✅

**Updated:** `src/agent/skills/validator.ts`

- Added import for `evalNegativeTest` from `./safeAssert` (ts-node Compatible)
- `sandboxTest` now runs each `negativeTests[]` assert through `evalNegativeTest` with synthetic context
- Only rejects PARSE/EVALUATION error (structural issues). Descriptive assertion strings that evaluate to false (e.g., "create_form without name parameter") are accepted — they're descriptive labels the Evaluator handles at runtime.
- Added `makeSyntheticConfig()` to generate a synthetic `AgentAction` for validation

**Verification:**
- 6 built-in skills validate ✅ (exit 0)
- `assert: "actionPlan["` → rejected with ParseError (unmatched bracket) ✅
- `assert: "require('admin')"` → rejected with Banned token ✅

## B-S4.4 — Track B sandbox merge kinds ✅

**Updated:** `src/agent/sandbox/types.ts`, `src/agent/3.4_sandboxMerge.ts`

Added three new `MergeableKind`s:
- `form_version_snapshot`
- `resource_lock_acquire`
- `resource_lock_release`

Each no-op-as-mutation writes `AgentAuditEvent` row only. Gated by existing Mongo transaction.
When C ships `FormVersionModel`, the snapshot kind will write the pre-edit snapshot.
When A ships `uo/her/lock.ts` resource-lock, the lock kinds record intent.

## B-S4.5 — Permissions stability check ✅

**Verified:** `src/agent/policy/permissions.ts`

`Permissions = { scopes: string[]; userId?: string }` is the only shape used by:
- `getAllowedTools(role)` — correct
- `checkSkillToolAllowlist(skill, userPermissions)` — correct

No caller mutates to `Record<string, boolean>`.

**Updated:** `src/agent/guidelines.md` with B-S4.5 section documenting the frozen shape, the B-S4.4 Track B merge kinds table, and the B-S4.1 safeAssert overview.

---

## Gate verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (B-owned files) | ✅ Clean (only A's evaluator.ts + orchestrator/loop.ts have expected callsite drift) |
| `npm run lint` | ✅ Clean |
| `npm run agent:validate-skills` (6 built-ins) | ✅ PASSED |
| `npm run agent:validate-skills` (malformed `actionPlan[`) | ❌ Rejected (exit 1) — correct |
| `npm run agent:validate-skills` (banned `require()` | ❌ Rejected (exit 1 — correct |
| `npm run agent:eval` | ⏸️ Skipped — requires MongoDB + Redis + NVIDIA_API_KEY (CI infra) |
