# Easy Forms Agent v3 — Parallel Implementation Plan

> **Source specs:** `plans/agent_spec.md`, `plans/agent_upgrade_v3.md`, `plans/pi_agent_spec.md`, `plans/pi_agent_upgrade_v3.md`, `plans/agy_implementation_plan.md`, `plans/inspiration_breakdown.md`
>
> **What this plan does.** The two specs describe the **same Easy Forms agent** under different lenses:
> - `agent_spec.md` + `agent_upgrade_v3.md` are the **defect-first** roadmap on the existing 4-persona loop (`Drafter → Planner → Executor → Evaluator → Communicator`) — what to fix and extend.
> - `pi_agent_spec.md` + `pi_agent_upgrade_v3.md` are **the target architectural redesign** of that same loop, written on this codebase by Nemotron 3 Ultra. The "PI Orchestrator / Planner / Critic / Executor / Memory / Skill Synth" roster is the **rename and promotion** of the inline loop machinery into first-class named roles. It is **not** a new parallel system.
>
> **Goal.** Deliver the v3 agent **end-to-end**: full CRUD control, complete-without-failing loop, long-term memory, first-class skills, hardened LLMOps, and the refactor of the linear loop into the **multi-agent hierarchical shape** (named roles, DAG planning, parallel executors, adversarial Critic) inside the existing `src/agent/` tree. The existing `/api/agent/execute` route contract stays identical so active tickets resume without breakage.
>
> **Strategy.** Three sequential stages. Each stage runs **four agents in parallel**. Within a stage, every file is owned by exactly **one** agent. No two agents touch the same file in the same stage. Between stages, ownership can transfer. This guarantees zero merge conflicts during parallel execution.

---

## Stage 0 — Stage / Agent Boundary Rules (READ FIRST)

### 0.1 The Non-Conflict Contract

A merge conflict can ONLY occur when two parallel agents edit the same file. We prevent this by:

1. **File ownership is exclusive within a stage.** The matrix below lists every file touched in a stage against the agent that owns it. If a file does not appear in an agent's column, that agent MUST NOT edit it.
2. **Hot-zone files are serialized across stages.** `agentLoop.ts`, `tools.ts`, `agentTools.ts`, `permissions.ts`, `permissions.json`, `sandboxMerge.ts`, `types.ts` are owned by ONE agent per file per stage — never two in the same stage.
3. **New files have no conflict risk.** New directories (`src/agent/skills/`, `src/agent/memory/`, `src/agent/orchestrator/`, `src/agent/executors/`, `src/agent/critic/`, `tests/agent/eval/`) are partitioned across agents by subdirectory.
4. **Interface contracts are frozen up front.** Before a stage starts, every agent's exported type signatures and function names that another agent will *call* or *import* must be agreed (the "contract sheet", §0.3). Agents code against interfaces, not implementations.
5. **No agent may run `git add -A` or `git commit -am`.** Each agent stages only its own owned files. A stage ends with a single integration commit.

### 0.2 The Four Agent Roles (Constant Across Stages)

| Agent | Role | Theme |
|---|---|---|
| **Agent A — Loop & Orchestration** | Owns `agentLoop.ts`, the orchestrator role, types, ACP bus, the loop refactor. | Loop integrity, budget, deadlines, aborts, replan, role promotion |
| **Agent B — Tools, Sandbox & Policy** | Owns the tool catalog, sandbox store, merge engine, permissions, skills registry. | CRUD surface, sandbox isolation, permission gating |
| **Agent C — Memory & Models** | Owns all Mongoose models, the Memory Service, migration, vector store. | Data persistence, recall, episodic/semantic memory |
| **Agent D — LLMOps, Eval, UI & Docs** | Owns LLM client, eval suite, SSE/WS streaming, UI components, docs. | Model routing, streaming, observability, user surface |

### 0.3 Contract Sheet (Frozen Before Stage 1)

These interface signatures MUST be committed by **Stage 1** at the listed paths so Stages 2 and 3 code against the interface, not the implementation. Each file is owned by exactly one agent per stage.

```typescript
// src/agent/types.ts — owned by Agent A (extends existing file)
export interface AgentCancelledError extends Error { code: "AGENT_CANCELLED"; ticketId: string; }
export interface LoopTimeoutError extends Error { code: "LOOP_TIMEOUT"; deadlineMs: number; }
// Stage 3 additions (frozen Stage 1, impl Stage 3):
export interface ExecutionPlan { planId: string; goal: string; tasks: TaskNode[]; edges: TaskEdge[]; checkpoints: Checkpoint[]; ... }
export interface TaskNode { taskId: string; role: ExecutorRole; skill: string; tool: string; params: Record<string, any>; dependsOn: string[]; ... }
export interface CriticVerdict { verdict: "pass" | "conditional_pass" | "fail" | "escalate"; score: number; findings: Finding[]; requiredFixes: FixDirective[]; ... }
export interface ExecutionState { executionId: string; userId: string; status: ExecutionStatus; plan: ExecutionPlan; taskStates: Map<string, TaskState>; ... }

// src/agent/skills/types.ts — owned by Agent B (NEW)
export interface SkillDefinition { skillId: string; name: string; version: string; permissionScope: string; tools: ToolRef[]; maxIterations: number; negativeTests: NegativeTest[]; dryRunShape: Record<string, unknown>; ... }
export interface SkillRegistry { resolve(skillName: string, userId: string): Promise<SkillDefinition | null>; register(skill: SkillDefinition, author: string): Promise<SkillDefinition>; list(userId: string): Promise<SkillDefinition[]>; validate(skill: SkillDefinition): Promise<ValidationResult>; }

// src/agent/memory/types.ts — owned by Agent C (NEW)
export interface AgentMemory { userId: string; key: string; value: unknown; confidence: number; lastUsedAt: Date; }
export interface MemoryService { getMemory(userId: string, key?: string): Promise<AgentMemory | AgentMemory[]>; setMemory(userId: string, key: string, value: unknown, opts?: { confidence?: number }): Promise<void>; recordSkillUse(userId: string, skill: string, ok: boolean, iterations: number): Promise<void>; recordFailure(userId: string, promptHash: string, err: string): Promise<void>; recentFailures(userId: string, sinceMs: number): Promise<AgentFailure[]>; summarize(ticketId: string): Promise<string>; assembleContext(userId: string, scope: MemoryScope): Promise<AgentContext>; }
```

### 0.4 Hard Invariants (Preserved Across All Stages)

From `.agents/Agent.md` §2 and `src/agent/guardrails.md`:
- **Form submission responses are strictly read-only.** No `Response` write tool ever.
- **Sandbox isolation before production merge.** Mutations queue in `sandbox:{userId}:{ticketId}` (24h TTL); merge only on user Confirm & Merge click inside a Mongo transaction with `$setOnInsert` idempotency + `expectedUpdatedAt`.
- **Human confirmation for destructive actions.** Deletes halt the loop, surface a confirmation modal with a one-click backup suggestion.
- **Permission verification.** Every tool passes `permissions.ts` against `permissions.json` before execution.
- **Loop budget.** Executor↔Evaluator retries capped (per-skill override via the Skills Registry).
- **Strict JSON contracts** between personas (`safeJSON`); **PII redaction** (`redactPII`) before any LLM call.
- **Per-user Redis lock** `agent_lock:{userId}` serializes the loop; **per-execution lock** `agent_lock:{userId}:{executionId}` for parallel multi-intent tickets (Stage 3).

### 0.5 Build / Verify Invariants

After **every** stage:
1. `npm run lint` MUST pass.
2. `npx tsc --noEmit` MUST pass.
3. `npm run build` MUST pass.
4. If any agent touched `src/agent/**`, `src/lib/llmClient.ts`, or `src/lib/agentTools.ts`: `npm run agent:eval` MUST pass.
5. **No agent merges its own PR.** The stage ends with a single integration commit; CI runs once.

---

## Stage 1 — Defect Fixes + Contract Skeleton (Week 1)

### 1.1 Stage Goal

**Fix every P0 defect that breaks the loop today, AND freeze the contract sheet** (`src/agent/types.ts` extensions, `src/agent/skills/types.ts`, `src/agent/memory/types.ts`) for Stage 3's refactor. After Stage 1, the existing loop never drifts, never runs past the deadline, replan is reachable, trace is PII-redacted, the loop is user-cancellable, typed errors produce typed replies, reads leave a trail, and the Drafter rules are contiguous. Stage 1 also writes the **interface-only** type additions that Stage 3 will fill with implementations — so Stages 2 and 3 code against interfaces, not implementations.

**Exit criteria.**
- All P0 defects from `agent_upgrade_v3.md` (D0.1–D0.10) are fixed and each has a stubbed unit-eval row.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass.
- `src/agent/types.ts` (extended), `src/agent/skills/types.ts`, `src/agent/memory/types.ts` exist and export the contract-sheet interfaces (§0.3).

### 1.2 Stage 1 — File Ownership Matrix

Stage 1's defects concentrate on loop state, trace shape, and the Drafter prompt. The four hot-zone legacy files (`agentLoop.ts`, `types.ts`, `agentTicketModel.ts`, `agentLock.ts`) are concentrated in **Agent A**, because Stage 1's defects are almost all loop-state and trace-shape fixes. Agent B handles the sandbox-merge stats defect (D0.4) plus the Drafter JSON prompt renumbering (D0.8 — lives in `prompts/v1/drafter.json`, Agent B's). Agent C handles new model fields. Agent D handles the LLMOps-layer defects (D0.5, D0.6, D0.9) plus the eval skeleton.

To avoid the one true conflict (D0.7 needs both `agentLoop.ts` and `agentTicketModel.ts`): **Agent A** edits `agentLoop.ts` to emit a typed `AgentCancelledError` (defined in `src/agent/types.ts`, owned by A); **Agent C** adds the `CANCELLED` enum value, the `errorKind` field, and the TTL partial-filter extension to `agentTicketModel.ts` independently. Neither touches the other's file. They agree on field names via the contract sheet before the stage starts.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` | **A** (D0.1, D0.2, D0.3, D0.5, D0.7, D0.9 orchestration, D0.10 trace hook, merge-reply rendering) |
| `src/agent/types.ts` | **A** (add `AgentCancelledError`, `LoopTimeoutError`, `ErrorKind` union; interface-only Stage-3 additions frozen as types) |
| `src/agent/sandbox/agentLock.ts` | **A** (D0.2 — `LOCK_TTL_MS` env-driven, heartbeat) |
| `src/agent/personas/evaluator.ts` | **A** (D0.3 — new `decision: "retry" \| "replan" \| "ask_user" \| "complete"` enum) |
| `src/agent/personas/drafter.ts` | **A** (D0.10 — minimal trace step in read-only shortcut) |
| `src/agent/prompts.ts` | **A** (D0.8 — deprecate to legacy fallback, route to v1 JSON via the existing `prompts/loader.ts`) |
| `src/app/api/agent/abort/route.ts` | **A** (NEW — D0.7 — POSTs `agent:abort:{ticketId}` flag to Redis) |
| `src/agent/sandbox/sandboxMerge.ts` | **B** (D0.4 — split `mergedForms` into 6 raw counters) |
| `src/agent/sandbox/types.ts` | **B** (NEW — export `MergeStats`) |
| `src/agent/prompts/v1/drafter.json` | **B** (D0.8 — contiguous rule numbering 1..N) |
| `src/agent/policy/permissions.ts` | **B** (scaffold new scopes: `skill_authoring`, `bulk_operations`, `system_admin`, `integration_management`, `agent_audit` — enum only, defaults unchanged) |
| `src/agent/permissions.json` | **B** (new scope keys default `false`) |
| `src/agent/guidelines.md` | **B** (scaffold upcoming tool-entry template) |
| `src/agent/skills.md` | **B** (add deprecation header — skills will be first-class in `src/agent/skills/registry.json` starting Stage 2) |
| `src/agent/skills/types.ts` | **B** (NEW — freeze `SkillDefinition`, `SkillRegistry` interface) |
| `src/agent/skills/registry.json` | **B** (NEW — empty array `[]`) |
| `src/models/agentTicketModel.ts` | **C** (D0.7 — add `CANCELLED` to status enum + ttl partial filter; D0.9 — add `errorKind` field + index) |
| `src/models/agentUsageModel.ts` | **C** (add `latencyMs` field + index — prep for Stage 3 LLMOps) |
| `src/agent/memory/types.ts` | **C** (NEW — freeze `AgentMemory`, `MemoryService` interface, `AgentFailure`, `AgentSkillUsage`) |
| `src/agent/memory/index.ts` | **C** (NEW — re-export barrel from `types.ts`; impl lands Stage 2) |
| `src/agent/helper/redact.ts` | **D** (D0.6 — add `redactTracePayload(obj)` recursive walker; keep `redactPII` untouched) |
| `src/lib/llmClient.ts` | **D** (D0.9 prep — surface `LLMRateLimitError` / `LLMTimeoutError` typed error classes up the call stack; no API change yet) |
| `src/lib/llmHealthMonitor.ts` | **D** (L2.3 — branch probe URL on `LLM_PROVIDER`: nvidia vs google) |
| `src/lib/logger.ts` | **D** (NEW — thin pino adapter with App Insights stub; no replacements yet, just exports) |
| `tests/agent/eval/stubRunner.ts` | **D** (NEW — wire `__testRetryLLMOverride` hook into a Jest runner; empty fixture set for Stage 1) |
| `tests/agent/eval/fixtures/` | **D** (NEW — empty dir + `.gitkeep`) |
| `tests/agent/eval/reports/` | **D** (NEW — empty dir + `.gitkeep`) |
| `tests/agent/eval/negative-prompts.jsonl` | **D** (NEW — empty file; prompts land Stage 2) |

### 1.3 Stage 1 — Tasks per Agent

#### **Agent A — Loop & Orchestration**

**A-S1.1 — `[DEFECT D0.1]` Mongo↔Redis state drift.** `agentLoop.ts:182-229` — `shouldPersistToMongo` skips writes on most transitions; a crash between a skipped Mongo write and the next Redis save leaves resumed state stale. **Fix:** remove the conditional; write Mongo on every transition using the existing `compressTraceForMongo` helper (already instrumented; nothing to add to `agentTicketModel.ts`). **Verify:** stubbed unit-eval row that kills the process between PLANNER and EXECUTOR via a `__testCrash` flag, resumes from Mongo, asserts the persona is PLANNER (not DRAFTER).

**A-S1.2 — `[DEFECT D0.2]` Lock TTL shorter than worst-case loop.** `agentLock.ts` uses 60 s TTL; `agentLoop.ts` has no deadline. **Fix:** add `LOOP_DEADLINE_MS` (env, default `120000`), checked at the top of every `while` iteration; on expiry throw `LoopTimeoutError` (new — added to `src/agent/types.ts`). Raise `LOCK_TTL_MS` to `max(LOOP_DEADLINE_MS, 60000) + 5000`. **Verify:** chaos unit-eval: stub an LLM that sleeps 40 s per call; assert the loop returns `LoopTimeoutError` around the 120 s mark and the lock is released.

**A-S1.3 — `[DEFECT D0.3]` Replan unreachable; 2nd identical retry wastes the budget.** `agentLoop.ts:609-618` retries into EXECUTOR_SANDBOX with the same plan on `shouldRetry`. **Fix:** promote the existing `feedbackPreamble` into a reachable path: 1st retry → EXECUTOR_SANDBOX; 2nd retry → PLANNER_MIXER with `evaluatorFeedback`; 3rd → COMMUNICATOR asks the user. In `evaluator.ts` (owned by A) add `decision: "retry" | "replan" | "ask_user" | "complete"`. Cache the failed plan into `state.priorPlans[]` so the Planner sees both the failed plan and the feedback side-by-side. **Verify:** golden prompt with a deliberately bad first plan (stubbed Executor returns `error` on `update_form`); assert the 2nd retry goes through the Planner (trace shows `persona: "PLANNER"` again) and the 3rd surfaces a user question.

**A-S1.4 — `[DEFECT D0.5]` Simulated-offline not hoisted out of branch logic.** `agentLoop.ts:576-590` re-checks `simOfflineKey` only inside the PLANNER branch. **Fix:** hoist a single `isSimulatedOffline` check to the top of `while`; throw before persona dispatch; drop the duplicate. **Verify:** add a stubbed eval row asserting the throw happens in every persona, including EXECUTOR_SANDBOX.

**A-S1.5 — `[DEFECT D0.7]` User-abort signal.** Add `agent:abort:{ticketId}` Redis flag, polled at the top of every `while` iteration. New `AgentCancelledError` class in `src/agent/types.ts`. On detection: `handleFailure(new AgentCancelledError(...))`, set Mongo ticket status to `CANCELLED` (Agent C adds the enum value), release the lock, emit `{type:"cancelled"}` SSE event before `[DONE]`. **New file:** `src/app/api/agent/abort/route.ts` — POST handler setting the Redis flag, authenticated via the existing NextAuth session. **Coordinate with C:** they add `CANCELLED` to the `status` enum + ttl partial-filter in `agentTicketModel.ts`. **Verify:** start a 4-persona loop; abort mid-Executor via the new route; assert lock released within 1 s, SSE event fires, Mongo ticket is `CANCELLED`.

**A-S1.6 — `[DEFECT D0.9]` Communicator double-branches on `LLMOfflineError` only.** `agentLoop.ts:232-266` `handleFailure` collapses `LLMRateLimitError` / `LLMTimeoutError` / `LLMHTTPError` into a generic "AI processing interrupted" reply. **Fix:** branch on each typed error to produce a user-readable recovery message keyed to the error type. Set a new `ticket.errorKind` field (Agent C adds the schema field + index) per Mongo ticket. **Verify:** one stubbed eval row per error kind asserting the right reply text.

**A-S1.7 — `[DEFECT D0.10]` Read-only shortcut bypasses trace.** `drafter.ts:216-242` calls `executeAgentTool` directly on `READ_ONLY_SKILLS`, leaving no trace / `AgentUsage` row. **Fix:** add a minimal trace step in the read-only shortcut. In `drafter.ts` (owned by A in this stage), after the read `executeAgentTool` call, push `{ persona: "DRAFTER", message: "Read query: <toolName>", result, ts: Date.now() }` into `state.executionTrace`. The trace is persisted by `addTrace` logic in `agentLoop.ts` (also A). **Verify:** send "list my active forms"; inspect the Mongo `executionTrace` doc; assert a step exists with `persona: "DRAFTER"`.

**A-S1.8 — `[DEFECT D0.8]` Drafter prompt rule numbering jumps 7 → 20.** `prompts.ts:20-27` has missing rules 8–19. The versioned JSON at `prompts/v1/drafter.json` is canonical (loader at `prompts/loader.ts:79`). **Fix:** deprecate `prompts.ts` to a fallback-only path that logs a warning on use; renumber `prompts/v1/drafter.json` contiguously from 1. **Coordinate with B:** Agent B owns `prompts/v1/drafter.json`; Agent A owns `prompts.ts`. JSON keys and shape identical; only rule numbers change. **Verify:** diff the loaded prompt byte-by-byte against a canonical string; `npm run agent:eval` before + after; if results drift, investigate before merging.

**A-S1.9 — Contract sheet: types.ts additions.** Add `AgentCancelledError`, `LoopTimeoutError`, `ErrorKind` union to `src/agent/types.ts`. Add the **interface-only** Stage-3 additions (`ExecutionPlan`, `TaskNode`, `CriticVerdict`, `ExecutionState`) as exported types — no implementation in Stage 1. **Why:** Stage 3 fills these with impl; freezing the shape now lets Stages 2's callers (`SkillRouter`, `MemoryService.assembleContext`) reference them. **Verify:** `npx tsc --noEmit` passes.

#### **Agent B — Tools, Sandbox & Policy**

**B-S1.1 — `[DEFECT D0.4]` Merge stats inflated.** `sandboxMerge.ts:380-385` computes `mergedForms` as `stats.mergedForms + stats.updatesApplied + stats.deletesApplied`. `agentLoop.ts:336-339` then prints "Forms created: X" where X includes updates + deletes. **Fix:** return the raw `{ mergedForms, mergedViews, updatesApplied, updatesMissed, deletesApplied, deletesMissed }` dict. Create `src/agent/sandbox/types.ts` exporting `MergeStats`. The standalone merge path at `sandboxMerge.ts:337` has the same bug — fix it too. **Coordinate with A:** Agent A's reply renderer in `agentLoop.ts` reads the new `MergeStats` shape. Frozen contract: `MergeStats = { mergedForms: number; mergedViews: number; updatesApplied: number; updatesMissed: number; deletesApplied: number; deletesMissed: number; }`. **Verify:** unit test: create 1 draft, update 1, delete 1 in the same sandbox; assert `mergeSandboxToProduction` returns `{ mergedForms: 1, updatesApplied: 1, deletesApplied: 1, ... }` not `mergedForms: 3`.

**B-S1.2 — `[DEFECT D0.8]` Drafter rules renumbered.** `src/agent/prompts/v1/drafter.json` has rule numbers jumping 7 → 20. **Fix:** renumber rules 1..N contiguously. Audit each rule against `.agents/design.md` B9 quality gate (every rule true/false testable, has a *why*). **Coordinate with A:** A owns `prompts.ts` (legacy fallback); B owns `prompts/v1/drafter.json` (canonical). **Verify:** diff the loaded prompt byte-by-byte; `npm run agent:eval` before + after, investigate drift before merging.

**B-S1.3 — Skills Registry skeleton.** Create `src/agent/skills/types.ts` exporting the frozen `SkillDefinition`, `SkillRegistry` interface. Create `src/agent/skills/registry.json` with `[]`. Create `src/agent/skills/loader.ts` exporting `loadSkillRegistry(): SkillDefinition[]`. **Why:** Stage 2's Skill Router (Agent A) and Stage 3's Skill Author (Agent A) code against this contract. **Verify:** `npx tsc --noEmit` passes. Loading `registry.json` returns `[]`.

**B-S1.4 — Permissions scaffold for new scopes.** `src/agent/policy/permissions.ts` — add new scope enum values for the upcoming tool catalog: `skill_authoring` (default `false`), `bulk_operations` (default `false`), `system_admin` (default `false`), `integration_management` (default `false`), `agent_audit` (default `true`). Update `src/agent/permissions.json` with the new scope keys and defaults. No `ALLOWED_TOOLS` additions yet (no new tools in Stage 1). Update `src/agent/guidelines.md` to document the new scopes with stub descriptions. Add a deprecation header to `src/agent/skills.md` noting skills become first-class in `src/agent/skills/registry.json` starting in Stage 2. **Verify:** `npx tsc --noEmit` passes. `permissions.ts` exports the new scopes in `ALL_SCOPES`. `checkToolPermission("nonexistent_tool", {})` still returns `false` for every scope.

#### **Agent C — Memory & Models**

**C-S1.1 — `agentTicketModel` status + errorKind extension.** `src/models/agentTicketModel.ts`:
- Add `"CANCELLED"` to `status` enum.
- Extend the TTL partial-filter expression (`expireAt`) to exclude `CANCELLED` (same treatment as `AWAITING_USER_APPROVAL`).
- Add `errorKind` field: `{ type: String, enum: ["timeout", "rate_limit", "http_5xx", "offline", "cancelled", "oom", "unknown"], index: true, default: "unknown" }`.
**Why:** Agent A's `handleFailure` writes `status: "CANCELLED"` and `errorKind: "timeout"` etc; the schema must accept them. **Coordinate with A:** the field names are frozen in §0.3. **Verify:** insert a test ticket with `status: "CANCELLED"`, `errorKind: "timeout"`; assert it saves and indexes; the TTL index skips it.

**C-S1.2 — `agentUsageModel` latency field.** `src/models/agentUsageModel.ts` — add `latencyMs: { type: Number, index: true, default: 0 }`. Prep for Stage 3 LLMOps (per-persona latency to `AgentUsage`). **Verify:** existing writes still work (the field has a default). Insert a row; assert `latencyMs` defaults to `0`.

**C-S1.3 — Memory Service types skeleton.** Create `src/agent/memory/types.ts` exporting the frozen contract: `AgentMemory`, `MemoryService` interface, `AgentFailure`, `AgentSkillUsage`. Create `src/agent/memory/index.ts` re-exporting from `types.ts`. The actual `MemoryService` impl + Mongo models land in Stage 2. **Verify:** `npx tsc --noEmit` passes with the new files.

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S1.1 — `[DEFECT D0.6]` PII redaction in trace.** `src/agent/helper/redact.ts` — add `redactTracePayload(obj)` that walks the payload tree recursively, applies key-based redaction, and applies value-based redaction to `llmRawOutput` specifically. Keep `redactPII` untouched (it's used by Executor/Evaluator/Communicator for tool params/results). **Coordinate with A:** Agent A's `addTrace` in `agentLoop.ts` calls `redactTracePayload`. Frozen signature: `redactTracePayload(payload: Record<string, unknown>): Record<string, unknown>`. **Verify:** send `me@example.com` in a prompt; inspect the Mongo `executionTrace` doc; assert the email is `***`-masked.

**D-S1.2 — `[GAP L2.3]` Health monitor branches on provider.** `src/lib/llmHealthMonitor.ts` — branch the probe URL on `LLM_PROVIDER`: `nvidia` → NVIDIA `/models` endpoint; `google` → Google `/v1beta/models`; unknown → return `unknown` status (don't probe a wrong URL). **Verify:** set `LLM_PROVIDER=google` in test env; assert the probe hits the Google endpoint.

**D-S1.3 — Structured logger skeleton.** Create `src/lib/logger.ts` exporting a thin pino adapter with `{userId, ticketId, persona, attempt, ms, status, model}` context fields. Interface: `logInfo`, `logWarn`, `logError`, plus `child(context)` for binding context. App Insights adapter is a stub (commented-out `applicationinsights` import — Stage 3 wires it via the `appinsights-instrumentation` skill). For Stage 1, NO `console.*` calls are replaced yet. **Verify:** import `logInfo` in a throwaway test; assert a JSON line is written to stdout with the context fields present.

**D-S1.4 — Stubbed eval runner skeleton (PR-gating prep).** `tests/agent/eval/stubRunner.ts` — wire the existing `__testRetryLLMOverride` hook in `llmClient.ts:376-388` into a Jest-style runner. Empty fixture set for Stage 1 — just the harness, no prompts yet. Create `tests/agent/eval/fixtures/` and `tests/agent/eval/reports/` with `.gitkeep`. Create `tests/agent/eval/negative-prompts.jsonl` as an empty file (Stage 2 will populate). **Coordinate with A:** Agent A's D0.1 chaos row registers via `stubRunner.registerRow({...})`. The contract: `registerRow({ id, prompt, setup, llmOverride, assert })` — `llmOverride` is a function `(messages, tools) => { content: string, tool_calls?: any[] }` matching `__testRetryLLMOverride`'s expected shape. **Verify:** add a single toy row (`id: "skeleton_smoke"`, prompt: "ping", assert: `state => true`); CI runs it; passes.

**D-S1.5 — Stage 1 docs patch (no code).** Update `.agents/Agent.md` §2 to add the new `CANCELLED` ticket status and `errorKind` field. Update `docs/agent/AGENT-OVERVIEW.md` §1.2 to mark defects D0.1–D0.10 as resolved. **Verify:** diff the doc; new content only; nothing removed.

### 1.4 Stage 1 — Integration & Verify Gate

After all 4 agents finish:

1. **Integration commit.** One coordinator pass runs `npx tsc --noEmit` to catch cross-agent shape mismatches (e.g., Agent B changed `MergeStats` but Agent A's reply renderer wasn't updated — should not happen given the contract sheet, but verify twice).
2. **Order of verification:**
   - `npx tsc --noEmit` (cross-file type errors).
   - `npm run lint` (style + unused-imports; Agent A and D both add files; each only imports from frozen contracts, so no lint duplication).
   - `npm run build` (Next.js production build — catches Server/Client boundary issues with the new `abort/route.ts`).
   - `npm run agent:eval` — must pass against the existing 50-prompt golden set (Stage 1 doesn't change tool semantics; only fixes defects; eval regression must be zero).
   - Stubbed eval rows from Agents A and D run as a smoke (5 rows max).
3. **Stage 1 exit.** All four pass → contract sheet is committed and exported → `import type { MemoryService } from "@/agent/memory"` resolves → cut Stage 1 ship-tag.

### 1.5 Stage 1 — Why it's conflict-free (proof)

- **No two agents touch the same file.** Confirmed by the matrix in §1.2.
- **All cross-agent dependencies are via frozen contracts** (§0.3): `MergeStats` (B's `sandbox/types.ts`), `AgentCancelledError` (A's `types.ts`), `CANCELLED` enum value (C's `agentTicketModel.ts` via agreed field name), `redactTracePayload` (D's `redact.ts` via agreed signature), `stubRunner.registerRow` (D's `stubRunner.ts` via agreed API).
- **All new files are partitioned by subdirectory:** `src/agent/skills/` → Agent B; `src/agent/memory/` → Agent C; `tests/agent/eval/` → Agent D. Agent A adds no new subdirectory in Stage 1 (only the new `src/app/api/agent/abort/route.ts`).

## Stage 2 — Capability Build-Out (Weeks 2–3)

### 2.1 Stage Goal

**Ship the full CRUD tool catalog (28 tools from spec §3.1), the Skills Registry with built-in skills, the Memory Service, and the per-skill `maxIterations` budget override.** After Stage 2, the agent can do *everything an authenticated user can do* (within the invariant set). The new hierarchical-refactor parts (named Orchestrator, DAG Planner, Critic, domain Executors) ship in Stage 3; Stage 2 builds the parts they will compose: tools, skills, memory.

**Exit criteria.**
- Tool catalog has 28 tools (10 existing + 18 new across bundles B1–B6).
- All 6 built-in skills (`build_form`, `edit_form`, `delete_form_skill`, `filter_responses`, `generate_analytics_skill`, `manage_custom_views`) are in `registry.json` with `maxIterations` set.
- Memory Service persists recurring form fields per user, skill-usage stats, recent failures; the Drafter reads them at ticket start.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass; one golden prompt per new tool + at least 10 negative prompts.

### 2.2 Stage 2 — File Ownership Matrix

The Stage 1 contract sheet makes Stage 2 substantially partitionable. The hot files shift: now `agentLoop.ts` (read-only shortcut handler + replan hook) is owned by **Agent A**; the `tools.ts` schema / `agentTools.ts` exec layer are owned by **Agent B**; all new Mongo models go to **Agent C**; `llmClient.ts` per-persona model is owned by **Agent D**. **No stage ever edits a file two agents own.**

A subtle conflict risk: the new `dashboard_stats`, `list_notifications`, `user_profile` reads all need helpers in `src/lib/agentTools.ts` (Agent B) AND might tempt you to add a Mongo query in `src/models/*` (Agent C). Rule: Agent B writes pure functions that accept already-fetched Mongo documents; Agent C owns the Mongo aggregation pipelines + indexes + the read models (e.g., `dashboardModel.ts` is NEW and owned by Agent C). Agent B's `agentTools.ts` *imports* helpers from Agent C's `models/` and *calls* them, never edits them. The contract: functions exported by `src/models/*.ts` are read-only imports for Agent B.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` (read-only shortcut via Skill Router; replan enforces per-skill `maxIterations`; merge reply renderer with 6 counters) | **A** |
| `src/agent/personas/drafter.ts` (multi-skill extraction; memory hydration at ticket start) | **A** |
| `src/agent/personas/planner.ts` (refactor into Mixer — fills params into Skill Router templates) | **A** |
| `src/agent/personas/evaluator.ts` (negative-test mode + structural-bit checks) | **A** |
| `src/agent/personas/communicator.ts` (selective-merge reply renderer — reads `MergeStats`) | **A** |
| `src/agent/personas/skillRouter.ts` (NEW — resolves Drafter skill name to `SkillDefinition`; built-in vs user override; rejects unknown) | **A** |
| `src/agent/skills/orchestratorBase.ts` (NEW — empty scaffold for Stage 3's Orchestrator role; interface only) | **A** |
| `src/agent/skills/criticBase.ts` (NEW — empty scaffold for Stage 3's Critic role; interface only) | **A** |
| `src/agent/executors/base.ts` (NEW — empty `ExecutorBase` abstract class; Stage 3 fills domain executors) | **A** |
| `src/agent/tools.ts` (add 18 new tool schemas in dependency-ordered bundles B1-B6) | **B** |
| `src/lib/agentTools.ts` (impl the 18 new read tools + helpers) | **B** |
| `src/agent/personas/executor.ts` (sandbox-queue the 12 new mutating tools) | **B** |
| `src/agent/sandbox/sandboxMerge.ts` (extend merge to CustomView updates/deletes + User profile/prefs/notifications + `USER_SAFE_FIELDS` allowlist) | **B** |
| `src/agent/sandbox/types.ts` (extend `MergeStats`, add `MergeableKind` union) | **B** |
| `src/agent/policy/permissions.ts` (`TOOL_TO_SCOPE` for all 18 new tools; `ALLOWED_TOOLS` per scope; `USER_SAFE_FIELDS`) | **B** |
| `src/agent/permissions.json` (enable new tools under existing scopes; `destructive_actions` still default false for destructive ones) | **B** |
| `src/agent/skills/registry.json` (populate 6 built-in skills with `maxIterations`, `negativeTests`, `dryRunShape`) | **B** |
| `src/agent/skills/loader.ts` (load + cache built-ins; load user skills via `AgentSkillModel.find`) | **B** |
| `src/agent/skills/validator.ts` (NEW — Zod schema for `SkillDefinition`; `validateSkill(skill)` exported) | **B** |
| `src/agent/skills/types.ts` (extend `SkillDefinition` if needed — contract preserved) | **B** |
| `src/agent/guidelines.md` (one entry per new tool: name, schema, scope, dry-run shape, owning skill) | **B** |
| `src/models/AgentSkillModel.ts` (NEW — user skills persistence; `(userId, name)` unique index; `version` field immutable on update) | **C** |
| `src/models/AgentMemoryModel.ts` (NEW — `userId`, `key`, `value: Mixed`, `confidence`, `lastUsedAt`; index on `(userId, key)`) | **C** |
| `src/models/AgentSkillUsageModel.ts` (NEW — `userId`, `skill`, `count`, `successRate`, `avgIterations`, `lastUsedAt`) | **C** |
| `src/models/AgentFailureModel.ts` (NEW — `userId`, `promptHash`, `lastError`, `count`, `lastAt`; TTL 30 d) | **C** |
| `src/models/dashboardModel.ts` (NEW — pure aggregation functions for `dashboard_stats`; read-only, no schema) | **C** |
| `src/agent/memory/service.ts` (NEW — `MemoryService` concrete impl; `getMemory`, `setMemory`, `recordSkillUse`, `recordFailure`, `recentFailures`, `summarize`) | **C** |
| `src/agent/memory/compaction.ts` (NEW — `summarize(ticketId)` replaces completed-iteration results with digest; LRU cap on `sandbox.queryResults` default 8) | **C** |
| `src/agent/memory/context.ts` (NEW — `assembleContext` impl; pulls preferences + recent traces + relevant skills) | **C** |
| `src/lib/llmClient.ts` (L2.1 per-persona model + temperature via env overrides; L2.2 secondary provider fallback) | **D** |
| `src/agent/prompts/loader.ts` (attach per-persona model + temperature to prompt file JSON) | **D** |
| `src/lib/costCalculator.ts` (NEW — pricing table lookup by model id; `priceFor(provider, model)`) | **D** |
| `tests/agent/eval/golden-prompts.jsonl` (one prompt per new tool in bundles B1-B6) | **D** |
| `tests/agent/eval/negative-prompts.jsonl` (at least 10 negative prompts) | **D** |
| `tests/agent/eval/runner.ts` (assert `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`; on failure dump full `executionTrace` to report JSON) | **D** |
| `tests/agent/eval/stubRunner.ts` (extends Stage 1 harness with assertion fields above) | **D** |
| `tests/agent/eval/reports/<ISO>.json` (persisted JSON report per run; `diffReports.js` summary) | **D** |
| `src/components/ActionBar/AgentConfirmationModal.tsx` (per-action checkboxes for selective merge) | **D** |
| `src/components/ActionBar/SandboxPreviewModal.tsx` (NEW — mounts `FormRenderer` against sandboxed Redis schema) | **D** |

### 2.3 Stage 2 — Tasks per Agent

#### **Agent A — Loop & Orchestration**

**A-S2.1 — Skill Router.** `src/agent/personas/skillRouter.ts` (NEW) — given `state.skill[]` (Drafter can now return multiple skills), resolve each against Agent B's `Skills.loadSkillRegistry()`. For user-skill override: query Agent C's `AgentSkillModel.find({ userId, name })`. Emit `actionPlan[]` by concatenating templates. Reject unknown skill names with `{ allowed: false, reason: "No skill template for X" }`. Frozen contract: `SkillDefinition.tools: ToolRef[]` where `ToolRef = { tool: string; paramsFrom: "requirements" | "memory" | "context" }`. **Verify:** synthetic test: input `["build_form", "manage_custom_views"]`; assert the action plan has both `create_form` and `create_custom_view` steps.

**A-S2.2 — Planner refactor into Mixer.** `src/agent/personas/planner.ts` — instead of inventing `actionPlan` from scratch, fill params into the Skill Router's templates. The LLM call still happens (for param generation), but on a smaller prompt: given the matched skill's `requiredParams` + `optionalParams` + the user's `requirements`, fill each param. Planner output schema unchanged — `actionPlan: AgentAction[]` — but each action now carries `owningSkill: string`. **Verify:** Planner output schema unchanged — `actionPlan: AgentAction[]` — but the actions now have `owningSkill: string` set.

**A-S2.3 — Read-only shortcut via Skill Router.** `src/agent/personas/drafter.ts:216-242` — when `READ_ONLY_SKILLS.has(skill)`, route through Skill Router to pick the read tool instead of hardcoding the dispatch. No change to `agentLoop.ts` (the trace hook from Stage 1 already fires). **Verify:** existing read prompts still produce a single LLM call; the trace shows the matched built-in skill's `skillId`.

**A-S2.4 — Per-skill `maxIterations` enforcement.** `src/agent/agentLoop.ts` — at ticket start, resolve the skill → read `maxIterations` from `SkillDefinition`. Override the default `MAX_ITERATIONS=3` per skill (read=1, build=2-3, multi-skill=4). Check `state.retryCount < skill.maxIterations` on every retry. **Verify:** golden prompt for read skill completes in 1 iteration; multi-skill build allows 4.

**A-S2.5 — Drafter memory hydration.** `src/agent/personas/drafter.ts` — at the top of `runDrafter`, call `MemoryService.getMemory(userId, "recurring_fields")` and `MemoryService.recentFailures(userId, 7d)`. Inject into `state.userContext`. Pre-fill recurring fields when building a new form (the Planner reads them from `state.userContext`). Imported as `import { memoryService } from "@/agent/memory"` (Agent C owns the barrel). **Verify:** a 3-prompt sequence: build a contact form → build another contact form (assert Plan pre-fills Email) → "forget my contact template" (a tool Agent B ships) → build a contact form (assert Email NOT pre-filled).

**A-S2.6 — Evaluator negative-test mode + structured bits.** `src/agent/personas/evaluator.ts` — add a pre-execution deterministic check pass that asserts structural bits from the matched skill's `negativeTests[]` (e.g., `actionPlan[0].params.elements.length >= 1`). Today the Evaluator only runs LLM-based QA after execution. **Verify:** negative prompt `build a contact form with no fields` → the deterministic check fails BEFORE the LLM Evaluator runs; reply says "the contact form must have at least one field".

**A-S2.7 — Communicator selective-merge reply renderer.** `src/agent/personas/communicator.ts` — render `MergeStats` as 6 separate counters and surface the selective checkbox display via `AgentConfirmationModal.tsx` (Agent D owns the UI). The Communicator is the renderer of the merge reply; the loop's reply-construction site in `agentLoop.ts` calls the Communicator. **Verify:** reply text shows "Forms created: 1, updated: 1, deleted: 1, views created: 0".

**A-S2.8 — Role scaffolds for Stage 3.** Create `src/agent/skills/orchestratorBase.ts` (NEW) with an empty abstract `OrchestratorBase` class — interface only, no impl. Create `src/agent/skills/criticBase.ts` (NEW — empty abstract `CriticBase` class). Create `src/agent/executors/base.ts` (NEW — empty abstract `ExecutorBase` class). NO real implementation in Stage 2 — Stage 3 fills them. The scaffolds ensure `npx tsc --noEmit` passes against future imports. **Verify:** compile-check `import { OrchestratorBase } from "@/agent/skills/orchestratorBase"`.

> Note on path: the orchestrator and critic base classes live under `src/agent/` (no new `pi/` subdir), keeping the existing design intact. The executors subdir is also new but it lives under the existing `src/agent/` tree.

#### **Agent B — Tools, Sandbox & Policy**

**B-S2.1 — Bundle B1: element ops.** Add 4 tools to `src/agent/tools.ts`: `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements`. Impl in `src/lib/agentTools.ts` (read paths) and `src/agent/personas/executor.ts` (sandbox queue). All mutations route through sandbox; each declares `expectedUpdatedAt` and `agentIdempotencyKey`. Update `TOOL_TO_SCOPE` in `permissions.ts` and `permissions.json`; add one entry to `guidelines.md`; add to `registry.json` built-in skill `edit_form`. **Verify:** golden prompt "add a Phone Number field to my Contact form" → sandbox has a new element; merge applies it; `expectedUpdatedAt` incremented cleanly.

**B-S2.2 — Bundle B2: form lifecycle.** Add `set_form_status` and `update_form_metadata_settings` (ip/UA/geo/referrer flags) tools. Sandbox-merge extension in `sandboxMerge.ts`: handle new `MergeableKind = "form_status" | "form_metadata"` that does `$set` on `Form.status` / `Form.metadataSettings` under the existing transaction. **Verify:** golden prompt "pause my feedback form" + "track IP addresses on my feedback form" — both sandbox, merge, audit event written.

**B-S2.3 — Bundle B3: user/account.** Add `update_user_profile`, `update_user_preferences`, `update_notification_settings`. Merge extends to `User.updateOne({_id: userId}, {$set: ...})` under the transaction with the `USER_SAFE_FIELDS` allowlist (no `password`, `email`, `isGoogleAuth`, `isAdmin`, `verify*` fields). **Verify:** negative prompt "update my password via agent" → blocked at the merge layer with "cannot touch auth-related fields".

**B-S2.4 — Bundle B4: notifications.** Add `list_notifications`, `mark_notification_read`, `clear_notification`. Notifications are reversible → direct write gated by a strong audit event; **not** through the 24h sandbox. Document in `guidelines.md` that this is the explicit exemption from sandbox required by spec §3.1. **Verify:** golden prompt "mark my last notification as read" → no merge modal pops; direct write; audit event written.

**B-S2.5 — Bundle B5: reads.** Add `dashboard_stats`, `list_agent_audit_events`, `list_agent_tickets`. Aggregation pipelines live in Agent C's `src/models/dashboardModel.ts` etc.; Agent B's `agentTools.ts` calls them and shapes the LLM-readable result. Frozen contract: `getDashboardStats(userId): Promise<DashboardStats>` shape defined in `src/models/dashboardModel.ts` (Agent C owns the type and the impl). **Verify:** golden prompt "show my dashboard stats" → returns metrics without LLM token spend (read shortcut).

**B-S2.6 — Bundle B6: exports.** Add `export_form` (csv/json/pdf) returning a server-signed short-lived URL (NOT inlining the payload — would blow the SSE stream budget). URL has 5-min TTL signed via `crypto.createHmac`. **Verify:** negative prompt "give me the raw CSV bytes in the chat" → deny with "exports are URL-based"; positive prompt returns a signed URL.

**B-S2.7 — Skills Registry population.** `src/agent/skills/registry.json` — populate the 6 built-in skills with full bodies: `build_form` (`maxIterations: 2`, `negativeTests: [{assert: "actionPlan[0].params.elements.length >= 1"}]`); `edit_form` (`maxIterations: 3`); `delete_form_skill` (destructive; `maxIterations: 1`); `filter_responses` (`maxIterations: 1`); `generate_analytics_skill` (`maxIterations: 1`); `manage_custom_views` (`maxIterations: 2`). **Verify:** `npm run agent:validate-skills` (NEW, part of `skills/loader.ts`) loads and Zod-validates every skill.

**B-S2.8 — Sand-box merge extension.** `src/agent/sandbox/sandboxMerge.ts` extends to CustomView updates/deletes and User profile/prefs. Add a `MergeableKind` union (`"form_create" | "form_update" | "form_delete" | "view_create" | "view_update" | "view_delete" | "user_update" | "form_status" | "form_metadata"`). Each kind has its own apply function under the shared Mongo transaction. **Verify:** unit-test each kind against a fixture sandbox with the right `expectedUpdatedAt` and idempotency; assert atomicity (all-or-nothing) for the new kinds.

**B-S2.9 — `USER_SAFE_FIELDS` allowlist.** In `sandboxMerge.ts`, before applying a `user_update` kind, intersect the patch keys with `USER_SAFE_FIELDS = ["name", "country", "language", "theme", "dateFormat", "timeFormat", "notificationSettings"]`. Reject anything else with a `UserUnsafeFieldError`. **Verify:** negative prompt "set my isAdmin to true via agent" → deny.

#### **Agent C — Memory & Models**

**C-S2.1 — `AgentSkillModel`.** `src/models/AgentSkillModel.ts` — `userId`, `name` (unique per user), `version`, `definition: SkillDefinition`, `createdAt`, `updatedAt`. Version is immutable on edit — edits create a new version row. Frozen contract — `SkillDefinition` shape from Agent B's `src/agent/skills/types.ts`. **Verify:** insert 2 versions of the same skill name; assert both rows exist with different `version`.

**C-S2.2 — `AgentMemoryModel`.** `src/models/AgentMemoryModel.ts` — `userId`, `key`, `value: Mixed`, `confidence` (0-1), `lastUsedAt`. Compounded index `(userId, key)`. **Verify:** insert `(u1, "recurring_fields", [...], 0.3)`; `find({userId, key}).sort({lastUsedAt:-1})` returns it.

**C-S2.3 — `AgentSkillUsageModel`.** `src/models/AgentSkillUsageModel.ts` — `userId`, `skill`, `count`, `successRate`, `avgIterations`, `lastUsedAt`. **Verify:** 5 inserts; aggregation returns the most-used skill.

**C-S2.4 — `AgentFailureModel`.** `src/models/AgentFailureModel.ts` — `userId`, `promptHash`, `lastError`, `count`, `lastAt`. TTL index `30 * 24 * 3600` (30 d). **Verify:** insert + auto-expire after 30 days.

**C-S2.5 — `MemoryService` impl.** `src/agent/memory/service.ts` — concrete impl of the `MemoryService` interface frozen in Stage 1. Methods: `getMemory`, `setMemory` (upsert + confidence bump, max 0.9), `recordSkillUse`, `recordFailure`, `recentFailures`, `summarize`. `setMemory` Zod-validates the value (primitives / known shapes) and runs `redactPII` before persistence. Imports `MemoryService` from `src/agent/memory/types.ts` (Stage 1 frozen). Uses `redactPII` from Agent D's helper. Frozen contract: `memoryService` singleton exported from `src/agent/memory/index.ts`. **Verify:** round-trip test: `setMemory(u, "k", {...}, {confidence:0.3})`, `getMemory(u, "k")` returns it; second `setMemory` bumps confidence to 0.4; injected email is masked.

**C-S2.6 — Memory compaction.** `src/agent/memory/compaction.ts` — `summarize(ticketId): Promise<string>` replaces each completed-iteration's raw `sandbox.queryResults` entry with a one-line digest the Evaluator reads on retries. LRU cap on `sandbox.queryResults` (default 8) — older evicted to Mongo `AgentTicket.executionTrace`. **Verify:** force 12 read results into a sandbox; call `summarize`; assert the oldest 4 are evicted, and the digest is the only remaining entry per pre-summary slot.

**C-S2.7 — Dashboard aggregation helper.** `src/models/dashboardModel.ts` — pure aggregation functions: `getDashboardStats(userId)`, `getFormListStats(userId)`. No schema — read-only aggregations over `Form`, `Response`, `CustomView`. Keeping the pipeline in a model file (Agent C) keeps all MongoDB query logic in one team's ownership. Frozen contract — exported function signatures and return shapes. **Verify:** insert 3 forms + 50 responses; `getDashboardStats` returns correct totals.

**C-S2.8 — Context assembly.** `src/agent/memory/context.ts` — `assembleContext(userId, scope)` (the contract method from Stage 1). Pulls preferences + recent traces + relevant skills + procedural, returns `AgentContext`. Used by the Stage 3 Orchestrator before PLAN. For Stage 2 the impl runs against `AgentMemoryModel` + `AgentSkillModel`; vector-search integration lands Stage 3.

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S2.1 — `[GAP L2.1]` Per-persona model + temperature.** `src/lib/llmClient.ts` — read `LLM_MODEL_DRAFTER`, `LLM_MODEL_PLANNER`, `LLM_MODEL_EVALUATOR`, `LLM_MODEL_COMMUNICATOR` from env (default to `LLM_MODEL`). Per-persona temperature constants — defined as `PERSONA_TEMPERATURES: Record<Persona, number>` in `llmClient.ts`. The existing `callLLM` signature gets an optional `persona` field; personas pass `persona` through (Agent A's persona files call `callLLM({persona, ...})` — no Agent A change needed). **Verify:** set `LLM_MODEL_DRAFTER=foo`, mock `callLLM`; assert the request hit model `foo`.

**D-S2.2 — `[GAP L2.2]` Secondary provider fallback.** `src/lib/llmClient.ts` — wrap the LLM call in `callOnceWithFallback`: on `LLMOfflineError` from primary, transparently retry once against `LLM_FALLBACK_*` config. Reset the secondary call's usage into `AgentUsage` (Agent C's model) with the fallback model for cost attribution. Frozen contract: `recordAgentUsage({ ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, costUsd, latencyMs })` exported from `agentUsageModel.ts`. **Verify:** stub test: primary throws `LLMOfflineError`, fallback returns OK; assert result + `AgentUsage` row is attributed to the fallback model.

**D-S2.3 — Replace `console.*` in `src/lib/*` only.** Stage 3 swaps console.* in the agent tree; Stage 2 keeps Agent D's logging scope to its OWN `src/lib/*` files (`llmClient.ts`, `llmHealthMonitor.ts`). The full `agentLoop.ts`/personas swap is Stage 3 (still Agent D's logger, but choreographed across Agent A's owned files). **Verify:** a live prompt; capture one pino line per LLM call with `{userId, ticketId, persona, model, ms, status}`.

**D-S2.4 — Eval: golden prompts expansion.** `tests/agent/eval/golden-prompts.jsonl` — add one row per new tool in bundles B1-B6 (18 prompts). Schema extended with `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`. `runner.ts` asserts them. Integration test ordering: Agent B's tools merge first, then Agent D's eval runs. **Verify:** `npm run agent:eval — --live` detects a regression when any new tool's params change.

**D-S2.5 — Eval: negative prompts.** `tests/agent/eval/negative-prompts.jsonl` + assertion in `runner.ts` — at least 10 negative prompts: (1) attempt to mutate a `Response`; (2) cross-tenant form-id; (3) attempt to delete a form when `destructive_actions=false`; (4) abort signal fires; (5) loop deadline expires; (6) attempt to set `isAdmin=true` via agent; (7) attempt to read another user's notifications; (8) attempt to read raw CSV bytes in chat (must return URL); (9) skill with bad `requiredTools` (allowed-list violation); (10) `update_user_profile` touching auth field. **Verify:** each negative prompt fails with the expected deny message and `isComplete=false`.

**D-S2.6 — Eval: report history + branch coverage.** `tests/agent/eval/reports/<ISO>.json` — run-end JSON report. `tests/agent/eval/diffReports.js` — quick diff of pass-rate, regressions, new failures vs previous. Tag each golden prompt with `branches: string[]` (e.g., `["drafter.vague", "evaluator.retry"]`); runner emits `% branches hit` summary. **Verify:** two consecutive runs produce a diff report with empty regressions.

**D-S2.7 — Selective-merge UI.** `src/components/ActionBar/AgentConfirmationModal.tsx` — add per-action checkboxes (one per sandbox action); a "Select all / none" master checkbox; merge carries ONLY selected actions. The frontend POSTs the array of selected `actionId`s. The contract (3-touch coordination): Agent A's `agentLoop.ts` resume path reads `mergeApprovedActionIds` (one-line passthrough); Agent B's `sandboxMerge.ts` filters by `mergeApprovedActionIds` before applying; Agent D's UI sends the array. Frozen contract: `MergeRequest = { ticketId, userId, mergeApprovedActionIds: string[] }` defined in `src/agent/sandbox/types.ts` (Agent B owns). **Verify:** UI checkbox flow; sandbox with 3 actions; check 2; merge has 2 applied, 1 discarded.

**D-S2.8 — Sandbox preview modal.** `src/components/ActionBar/SandboxPreviewModal.tsx` — mounts the `FormRenderer` against the sandboxed Redis schema. The sandbox schema is fetched via a new read path (Agent B's `agentTools.ts` — `getSandboxPreview(ticketId)`). Frozen contract: returns `{ elements, name, description }` (form shape) without writing to prod. **Verify:** open preview against a 3-field sandbox draft; render shows 3 fields; close doesn't merge.

**D-S2.9 — Stage 2 docs patch.** `.agents/Agent.md` §2 — add new permission scopes (`skill_authoring`, `bulk_operations`, `system_admin`, `integration_management`, `agent_audit`); add new tool list; add selective-merge section. **Verify:** reflects the shipped state; no orphaned passages.

### 2.4 Stage 2 — Integration & Verify Gate

1. **Integration commit order.**
   - Agent C models first (`AgentSkillModel`, `AgentMemoryModel`, `AgentSkillUsageModel`, `AgentFailureModel`, `dashboardModel`).
   - Agent B tools + skills registry + policy next.
   - Agent A personas + loop next (depends on B's registry + C's memory).
   - Agent D eval + llmClient + UI last (depends on the rest).
2. **Verify.** `tsc`, `lint`, `build`, `agent:eval` all pass; `agent:validate-skills` passes; negative-prompt suite fails every negative prompt with the expected deny class.
3. **Stage 2 exit.** All four pass + eval report shows `0 regressions`. Defects D0.x from Stage 1 still pass.

### 2.5 Stage 2 — Why it's conflict-free (proof)

- `agentLoop.ts`, `drafter.ts`, `planner.ts`, `evaluator.ts`, `communicator.ts`, `skillRouter.ts`: only Agent A.
- `tools.ts`, `agentTools.ts`, `permissions.ts`, `permissions.json`, `guidelines.md`, `sandboxMerge.ts`, `sandbox/types.ts`, `executor.ts`: only Agent B.
- `agentSkillModel.ts` (NEW), `agentMemoryModel.ts` (NEW), `agentSkillUsageModel.ts` (NEW), `agentFailureModel.ts` (NEW), `dashboardModel.ts` (NEW), `agentUsageModel.ts`, `memory/service.ts`, `memory/compaction.ts`, `memory/context.ts`: only Agent C.
- `llmClient.ts`, `llmHealthMonitor.ts`, `logger.ts`, `costCalculator.ts` (NEW), `prompts/loader.ts`, `eval/*`: only Agent D.
- `AgentConfirmationModal.tsx`, `SandboxPreviewModal.tsx`: only Agent D.
- Role scaffolds `src/agent/skills/orchestratorBase.ts`, `src/agent/skills/criticBase.ts`, `src/agent/executors/base.ts`: only Agent A.

## Stage 3 — Loop Refactor into Hierarchical Multi-Agent + Hardening (Weeks 4+)

### 3.1 Stage Goal

**Refactor the linear 4-persona loop into the hierarchical multi-agent shape described in `pi_agent_spec.md` — inside the existing `src/agent/` tree, not a new system.** The inline orchestrator machinery in `agentLoop.ts` (budget, deadlines, abort, replan, role dispatch) is **promoted into a named `Orchestrator` class** that `agentLoop.ts` then calls. The existing `Evaluator` persona becomes the **`Critic` role** (pre-flight + post-flight adversarial verification). The monolithic `Executor` persona is **decomposed into domain-specialized executors** (`forms.ts`, `responses.ts`, `views.ts`, `generic.ts`) with strict per-role tool allow-lists. The `Planner` persona becomes a **DAG planner** emitting `ExecutionPlan` with dependency edges. The per-user Redis lock is **augmented** with a per-execution lock (`agent_lock:{userId}:{executionId}`) so independent multi-intent tickets can run concurrently. The existing `POST /api/agent/execute` **route signature stays identical** so active tickets resume without breakage — the loop's new shape is behind that route, exposed via a one-line dispatch.

After this stage: `console.*` is replaced with the pino logger tree-wide; Communicator streams tokens; the Skill Author persona is live; users can author/edit/delete skills; deterministic replay works; the eval suite is PR-gating (stubbed) + nightly (live); the v3 Definition of Done (`agent_spec.md` §11) items 1–9 pass.

**Exit criteria.**
- `agentLoop.ts` is reduced to a thin entry that calls `Orchestrator.execute(...)`.
- `Orchestrator`, `Critic`, domain `executors/*`, and the DAG `Planner` are real classes with the full-loop dispatch + budget + audit + checkpoint behaviors.
- Communicator streams tokens via SSE end-to-end.
- Skill Author persona: user can author/edit/delete a skill; the skill is immediately usable by the Skill Router.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass; stubbed unit eval is PR-gating in CI; live eval is nightly.

### 3.2 Stage 3 — File Ownership Matrix

Stage 3's conflict risk concentrates on three choreographed swaps:
1. **`console.*` → pino across the agent tree.** Agent D owns `logger.ts`; the `console.*` calls live in Agent A's `agentLoop.ts` and persona files. Solution: Agent D ships the *completed* `logger.ts` (named child loggers, App Insights adapter) FIRST in Stage 3 — isolated commit, no other files touched. Then Agent A performs the mechanical `console.*` → `logInfo`/`logWarn`/`logError` swap inside its owned files.
2. **Loop refactor.** Agent A owns `agentLoop.ts` AND all the new role files (`orchestrator/`, `executors/`, `critic/`). No other agent touches the role/scheduling tree.
3. **Per-execution lock + sandbox.** Agent A owns the lock and the loop's sandbox dispatch.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` (reduce to thin entry; console→pino; Communicator streaming wiring) | **A** |
| `src/agent/personas/communicator.ts` (streaming variant) | **A** |
| `src/agent/personas/drafter.ts` (console→pino + multi-intent extraction) | **A** |
| `src/agent/personas/planner.ts` (console→pino + DAG output) | **A** |
| `src/agent/personas/evaluator.ts` (console→pino + rename-via-export to `Critic` role) | **A** |
| `src/agent/personas/executor.ts` (console→pino + slice to dispatcher) | **A** |
| `src/agent/personas/skillRouter.ts` (console→pino) | **A** |
| `src/agent/orchestrator/index.ts` (NEW — `Orchestrator` class; thin-wrap helper exported as `orchestrator`) | **A** |
| `src/agent/orchestrator/loop.ts` (NEW — `execute(input)` impl; the loop budget / deadline / abort / replan gates; ACP message bus) | **A** |
| `src/agent/orchestrator/lock.ts` (NEW — per-execution lock `agent_lock:{userId}:{executionId}`) | **A** |
| `src/agent/orchestrator/budget.ts` (NEW — per-tool-call budget tracker + `BudgetExceededError`) | **A** |
| `src/agent/orchestrator/audit.ts` (NEW — structured audit with decision rationale) | **A** |
| `src/agent/orchestrator/replay.ts` (NEW — deterministic replay from checkpoints) | **A** |
| `src/agent/orchestrator/visualize.ts` (NEW — Mermaid DAG generator for admin dashboard) | **A** |
| `src/agent/orchestrator/legacyShim.ts` (NEW — temporary adapter that routes `/api/agent/execute` through `Orchestrator.execute`; preserves `runAgentLoop` signature) | **A** |
| `src/agent/critic/index.ts` (NEW — `Critic` role impl; pre-flight + post-flight adversarial red-team) | **A** |
| `src/agent/critic/findings.ts` (NEW — `CriticVerdict`, `Finding`, `FixDirective` factories) | **A** |
| `src/agent/executors/base.ts` (fill the Stage-2 scaffold) | **A** |
| `src/agent/executors/forms.ts` (NEW — forms CRUD tools only) | **A** |
| `src/agent/executors/responses.ts` (NEW — read-only response tools only) | **A** |
| `src/agent/executors/views.ts` (NEW — custom-view tools only) | **A** |
| `src/agent/executors/generic.ts` (NEW — read-only `run_database_query` and bulk-tool scaffolds) | **A** |
| `src/agent/personas/skillAuthor.ts` (NEW — off-loop Skill Author persona) | **A** |
| `src/agent/sandbox/agentLock.ts` (extend to per-execution variant) | **A** |
| `src/agent/sandbox/sandboxRedisStore.ts` (add per-execution namespacing) | **A** |
| `src/lib/logger.ts` (full impl — named child loggers + App Insights adapter) | **D** |
| `src/lib/llmClient.ts` (Communicator `stream:true` wiring via `callLLMStream`) | **D** |
| `src/lib/semanticCache.ts` (full wiring — opt-in via env) | **D** |
| `src/lib/costCalculator.ts` (provider rate card accounting + `usageSummary`) | **D** |
| `src/agent/skills/skillAuthorClient.ts` (NEW — клиент `SkillAuthor` uses Agent B's registry + validator) | **B** |
| `src/agent/skills/registry.json` (user-skill override test fixture) | **B** |
| `src/agent/skills/loader.ts` (user-skill find middleware) | **B** |
| `src/agent/skills/validator.ts` (extend for sandbox-test of new skills — `npm run agent:validate-skills`) | **B** |
| `src/agent/policy/permissions.ts` (skill_authoring SCOPE gating runtime check) | **B** |
| `src/agent/permissions.json` (`skill_authoring` default false; `agent_audit` true) | **B** |
| `src/agent/personas/executor.ts` (skill-sandbox guarded tool dispatch — wait, owned by A in this stage too) | **A** |
| `src/agent/sandbox/sandboxMerge.ts` (skill-creation merge extension) | **B** |
| `src/lib/agentTools.ts` (link_google_sheet skeleton — phase-7 placeholder; off by default) | **B** |
| `src/models/AgentSkillModel.ts` (extend: `deprecatedAt`, `versionChain[]) | **C** |
| `src/models/OrchestratorExecutionModel.ts` (NEW — persists `ExecutionState`) | **C** |
| `src/models/OrchestratorCheckpointModel.ts` (NEW — snapshots for replay) | **C** |
| `src/models/OrchestratorAuditModel.ts` (NEW — `AgentAuditEntry` with `rationale`) | **C** |
| `src/agent/memory/vector.ts` (NEW — vector store adapter over Mongo Atlas Vector Search) | **C** |
| `src/agent/memory/preferences.ts` (NEW — implicit preference learning from history) | **C** |
| `src/agent/memory/procedural.ts` (NEW — pattern → skill proposals for Skill Author) | **C** |
| `tests/agent/eval/stubRunner.ts` (PR-gating CI wire-in) | **D** |
| `tests/agent/eval/runner.ts` (nightly live CI wire-in) | **D** |
| `tests/agent/multi-agent/` (NEW — orchestrator integration suite; automated golden scripts only; no code-sharing with Agent A's orchestrator impl) | **D** |
| `tests/agent/multi-agent/load_test.ts` (NEW — 100 concurrent executions; assert P99 < 30 s, 0 data loss, 0 auth bypass) | **D** |
| `tests/agent/eval/diffReports.js` (NEW — quick diff of pass-rate, regressions, new failures vs previous run) | **D** |
| `src/components/AgentSidebarDrawer.tsx` (UX for new tool kinds; typed SSE heartbeat handlers) | **D** |
| `src/components/AgentSkillsDrawer.tsx` (NEW — skill management surface: list / test / edit / delete) | **D** |
| `src/components/AgentVisualizer.tsx` (typed SSE heartbeats: `turn`, `complete`, `cancelled`, `awaiting_approval`) | **D** |
| `src/components/ActionBar/SandboxPreviewModal.tsx` (ghost-field preview polish) | **D** |
| `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md` | **D** |
| `docs/agent/AGENT-OVERVIEW.md` | **D** |
| `docs/agent/ARCHITECTURE.md` (NEW — multi-agent shape overview) | **D** |
| `docs/agent/API.md` (NEW — tool + HTTP API reference) | **D** |
| `docs/agent/RUNBOOK.md` (NEW — operational runbook) | **D** |
| `docs/agent/TROUBLESHOOTING.md` (NEW — diagnostic playbook) | **D** |

> Disambiguation on `executor.ts` ownership: Agent B touched `executor.ts` in Stage 2 (sandbox-queue for new mutating tools). In Stage 3, `executor.ts` becomes the **dispatcher slice** that routes to `executors/{forms,responses,views,generic}.ts` — and that refactor is Agent A's. To avoid owning-it-twice: Agent A's Stage-3 work on `executor.ts` is the **slice into a dispatcher** (delegates to the new role executors) plus console→pino; Agent B's Stage-3 work stays **out of `executor.ts`** (B's Stage-3 task is `skill_sandbox` guarded dispatch — but that lives inside the new `executors/base.ts`, which is **A's** in Stage 3, so B coordinates the allow-list contract only). The matrix above reflects this: `executor.ts` → A only in Stage 3; `executors/base.ts` → A only in Stage 3; B's `skill_sandbox` allow-list is exposed as a pure function in `permissions.ts` (B's), which A's `executors/base.ts` calls.

### 3.3 Stage 3 — Tasks per Agent

#### **Agent A — Loop & Orchestration**

**A-S3.1 — `console.*` → pino in `agentLoop.ts` + persona files.** Replace every `console.log` / `console.warn` in `src/agent/agentLoop.ts` and `src/agent/personas/*.ts` with `logInfo` / `logWarn` / `logError` from Agent D's `src/lib/logger.ts`. Thread per-turn context (`{userId, ticketId, persona, attempt, ms, status, model}`) via `child(context)`. Imports `logInfo`, `logWarn`, `logError` from `@/lib/logger` (Agent D's interface from Stage 1; Stage 3 consumes it). **Verify:** run a prompt end-to-end; one JSON log line per persona transition with the context pair present.

**A-S3.2 — Communicator streaming end-to-end.** `src/agent/personas/communicator.ts` — set `stream: true` on the LLM call. Route each token delta as `{type:"token", persona, delta}` into the SSE stream. Drafter/Planner/Evaluator stay non-stream (their JSON contracts need the full body). Agent D exports `callLLMStream(opts, onChunk)` from `llmClient.ts`; Agent A's `communicator.ts` calls it. Frozen contract: `callLLMStream(opts: { persona, messages, tools? }, onChunk: (delta: string) => void): Promise<LLMResult>`. **Verify:** live golden prompt for Communicator: assert SSE stream emits at least one `stream_chunk` event before `[DONE]`.

**A-S3.3 — `Orchestrator.execute()` full impl.** `src/agent/orchestrator/loop.ts` — the loop from `pi_agent_upgrade_v3.md` §4.3: acquire per-execution lock `agent_lock:{userId}:{executionId}` → budget pre-flight → memory context assembly → PLAN → CRITIC pre-flight → EXECUTE topologically → CRITIC post-flight → AWAITING_USER_APPROVAL → MERGE → LEARN (memory indexing) → RESPOND. Calls Agent B's `Skills.loadSkillRegistry` / `sandboxMerge`, Agent C's `MemoryService.assembleContext`, Agent D's `callLLM`/`callLLMStream`, A's own `Planner` (DAG) / `Critic` / `executors/*`. All contracts frozen in Stages 1–2. **Verify:** E2E test: prompt "build two onboarding forms and link them via a custom view" → trace shows parallel `executor_forms` tasks + `executor_views` after both finish.

**A-S3.4 — DAG Planner.** `src/agent/personas/planner.ts` (extended) — emit `ExecutionPlan` with `TaskNode[]` + `TaskEdge[]` (dependency + conditional). Conditional edges use `result.count > 100` style predicates — **code-evaluated, not LLM-evaluated** (per `inspiration_breakdown.md` §2 "Routers are code, never models"). The existing `runPlanner` signature is preserved; the new DAG output is an extension field `state.executionPlan` that the Orchestrator reads. **Verify:** test: prompt → generate plan → assert topological sort + a conditional edge.

**A-S3.5 — `Critic` role.** `src/agent/critic/index.ts` — promote the existing Evaluator into the `Critic` role: pre-flight (schema-validate the plan, scan for tool-hallucination, scan for cross-tenant form-id) + post-flight (deterministic bit-checks via `negativeTests[]` + LLM-based adversarial red-team) → `CriticVerdict`. `src/agent/personas/evaluator.ts` is refactored to call into `critic/`; the persona name in traces can stay `EVALUATOR` for backward compatibility, but the class is `Critic`. **Verify:** negative prompt injecting `tool: "delete_all_users"` → critic returns `verdict: "fail"`, plan aborted.

**A-S3.6 — Domain-specialized executors.** `src/agent/executors/base.ts` (fill the Stage-2 scaffold with the abstract `ExecutorBase` class), `forms.ts`, `responses.ts`, `views.ts`, `generic.ts` — each owns a strict subset of the tool catalog (ref `pi_agent_spec.md` Appendix A — without the "pi_" prefix; the role identities are: `executor_forms`, `executor_responses`, `executor_views`, `executor_generic`). Tool allow-list per role enforced at the dispatcher via Agent B's `getAllowedTools(role)` (see B-S3.1 disambiguation note). **Verify:** try to call `executor_responses` with `tool: "create_form"` → dispatcher returns `false`.

**A-S3.7 — Per-execution lock + sandbox.** `src/agent/orchestrator/lock.ts` — `acquireExecutionLock(executionId, userId)` keyed on `agent_lock:{userId}:{executionId}` so concurrent executions per user work. `src/agent/sandbox/sandboxRedisStore.ts` extended (Agent A owns it in Stage 3) with `sandbox:{userId}:{executionId}` namespacing for multi-intent tickets; the existing `sandbox:{userId}:{ticketId}` key is preserved for legacy single-intent tickets. **Verify:** two concurrent executions for the same user run in parallel; no lock collision.

**A-S3.8 — Budget tracker + audit.** `src/agent/orchestrator/budget.ts` — enforce at tool-call granularity (per-execution, per-task, per-user-day). Throws `BudgetExceededError` mid-execution; orchestrator routes to `handleFailurePartial` that checkpoints state + returns `status: "partial"`. `src/agent/orchestrator/audit.ts` — every LLM call logged with `{input, output, reasoning, ts}` into Agent C's `OrchestratorAuditModel`. **Verify:** stub a tool call that would exceed budget → `BudgetExceededError` thrown mid-loop, ticket persisted as `partial`, lock released.

**A-S3.9 — Legacy shim (temporary adapter).** `src/agent/orchestrator/legacyShim.ts` — `runAgentLoop(userId, prompt, mergeApproved, ...)` calls `Orchestrator.execute(...)` under the hood, converting legacy `AgentState` ↔ `ExecutionState`. The existing route handler at `src/app/api/agent/execute/route.ts` reads `process.env.AGENT_V3_ENABLED`; if true, routes new tickets via the shim; otherwise the legacy linear path runs unchanged. The shim is **temporary** — it exists to let active tickets resume through the new shape safely; it can be deleted in a follow-up stage once all in-flight tickets are resolved. **Verify:** set `AGENT_V3_ENABLED=true`; submit a creating-form prompt; assert the trace shows `Orchestrator` + `Planner` (DAG) + `executor_forms` roles; ticket status flow ends in `RESOLVED`/`AWAITING_USER_APPROVAL` matching the legacy contract.

**A-S3.10 — Deterministic replay + Mermaid visualization.** `src/agent/orchestrator/replay.ts` — `replayFromCheckpoint(executionId, checkpointId)` reconstructs the sandbox + memory state via Agent C's `OrchestratorCheckpointModel`, re-runs the plan from that point. `src/agent/orchestrator/visualize.ts` — `generateMermaid(plan)` outputs a `graph TD` Mermaid block of the DAG for the admin dashboard. **Verify:** run a 3-task execution to completion; replay from each checkpoint; assert the downstream task results match.

**A-S3.11 — Skill Author persona.** `src/agent/personas/skillAuthor.ts` — off-loop persona. User says "remember this contact-form template as 'weekly_pulse'" → agent generates a `SkillDefinition`, validates via Agent B's `Skills.validate`, stores in Agent C's `AgentSkillModel`, records an `AgentAuditEvent`. The Skill Author lives outside the main loop (like the read-only shortcut), gated by the `skill_authoring` permission scope (default `false`). **Verify:** prompt → creates a user skill → next prompt "build a weekly_pulse form" → Skill Router finds and uses it.

#### **Agent B — Tools, Sandbox & Policy**

**B-S3.1 — Role-allowed-tools helper (NOT in `executor.ts`).** `src/agent/policy/permissions.ts` — add `getAllowedTools(role: "executor_forms" | "executor_responses" | "executor_views" | "executor_generic"): string[]` returning the strict tool subset per role. Agent A's `executors/base.ts` dispatcher calls this. **Disambiguation:** B owns the policy function; A owns the dispatcher. **Verify:** `getAllowedTools("executor_responses")` does NOT include `create_form`.

**B-S3.2 — Skill-sandbox guarded dispatch (in `executors/base.ts` — but A owns that file).** Coordinate via contract: B exposes `checkSkillToolAllowlist(skill: SkillDefinition, userPermissions: Permissions): { allowed: boolean, reason?: string }` in `permissions.ts`; A's `executors/base.ts` calls it before any user-skill tool dispatch. **Verify:** synthesize a skill declaring `requiredTools: ["delete_form"]`; user with `destructive_actions=false` → call denied.

**B-S3.3 — Skill validator sandbox-test.** `src/agent/skills/validator.ts` — extend with `sandboxTest(skillDef)` that runs the skill against a throwaway sandbox id and a stubbed LLM, asserts the result shape matches `outputSchema`. Add `npm run agent:validate-skills` to `package.json`. **Verify:** inject a malformed skill; `npm run agent:validate-skills` exits non-zero.

**B-S3.4 — Skill merge extension.** `src/agent/sandbox/sandboxMerge.ts` — when the Skill Author persona creates a skill, the merge engine applies user-skill writes (gated by the user's `skill_authoring` scope flag) to Agent C's `AgentSkillModel` under a Mongo transaction with idempotency. **Verify:** the skill create queue hits sandbox; merge confirms; audit event emitted.

**B-S3.5 — `link_google_sheet` skeleton (phase-7 placeholder).** `src/lib/agentTools.ts` — add `link_google_sheet`, `sync_to_sheet`, `unlink_google_sheet` as gated-off scopes (`integration_management`, default false). Skeleton bodies that throw `NotImplementedError` until a later phase. **Verify:** tool registered; calling it returns `NotImplementedError`; not in `ALLOWED_TOOLS` for default users.

**B-S3.6 — `guidelines.md` + `skills.md` sync (final).** Complete the spec's mandate: `guidelines.md` has one entry per tool (full 28-tool + skill-authoring tools + external integration stubs). `skills.md` becomes a soft deprecation pointer to `src/agent/skills/registry.json` for built-ins and `AgentSkillModel` for user skills. **Verify:** document-style review against `agent_spec.md` §3.1.

#### **Agent C — Memory & Models**

**C-S3.1 — `OrchestratorExecutionModel`.** `src/models/OrchestratorExecutionModel.ts` — persists `ExecutionState`. Fields: `executionId` (uuid), `userId`, `sessionId`, `status` (planning | executing | verifying | awaiting_approval | completed | failed | partial | cancelled), `rootPlan` (nested `ExecutionPlan`), `taskStates` (Map), `agentStates` (Map), `memoryPointers[]`, `budgetConsumed` (snapshot), `checkpoints[]`, `auditLog[]`. **Verify:** insert + read round-trip; query by `(userId, status)` returns expected rows.

**C-S3.2 — `OrchestratorCheckpointModel`.** `src/models/OrchestratorCheckpointModel.ts` — snapshots for replay. `executionId`, `checkpointId`, `taskStateSnapshot`, `sandboxSnapshotSha256`, `memoryPointers`, `ts`. Agent A's `replay.ts` reads this; `loop.ts` writes a checkpoint after every successful task. **Verify:** generate 3 checkpoints during an execution; replay from #2; downstream matches.

**C-S3.3 — `OrchestratorAuditModel`.** `src/models/OrchestratorAuditModel.ts` — `executionId`, `taskId`, `role`, `event` (plan_start | tool_call | tool_result | verification | retry | checkpoint | merge), `payload`, `metrics` (tokens, latency, cost), `rationale` (LLM-decision text). **Verify:** walk a single execution; query audit log; reconstruct the entire decision flow.

**C-S3.4 — `AgentSkillModel` versioning + soft-delete.** `src/models/AgentSkillModel.ts` — extend with `deprecatedAt: Date | null`, `versionChain: string[]` (prior version IDs). Soft-delete sets `deprecatedAt` (preserves audit). Skill Router filters `deprecatedAt: null`. **Verify:** soft-delete a skill; subsequent ticket resolves with "skill not found"; the deprecated record still exists for audit.

**C-S3.5 — Memory vector store adapter.** `src/agent/memory/vector.ts` — adapter over Mongo Atlas Vector Search (`$vectorSearch` aggregation stage). Methods: `insertEmbedding(id, embedding, metadata)`, `search(queryEmbedding, k, filters)`. Embeddings generated via a small embedding model. Skeleton-only on dev env; full when Mongo Atlas is configured. Use the `appinsights-instrumentation` skill for embedding telemetry when wiring to production on Azure. **Verify:** insert 100 embeddings; `search` returns top-k by cosine similarity; without Atlas configured, gracefully fall back to keyword search in Mongo.

**C-S3.6 — Preference learning + procedural memory.** `src/agent/memory/preferences.ts` — `inferPreferencesFromHistory(userId)` scans last 50 successful traces, infers preferred field types + form names using simple statistics (no LLM call needed to keep cost down in Stage 3; LLM only for ambiguous cases). `src/agent/memory/procedural.ts` — `proposeSkillFromPatterns(userId)` uses LLM to detect recurring workflows and returns `SkillDefinition` proposals for the Skill Author to approve. **Verify:** same user creates 3 NPS+comments forms → `proposeSkillFromPatterns` returns a `weekly_pulse`-shaped skill proposal.

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S3.1 — Communicator streaming helper.** `src/lib/llmClient.ts` — `callLLMStream(opts, onChunk)` exposed. Reuses the existing `thoughtProcess` extraction but as a streaming JSON parser. Under any streaming exception, silently falls back to a non-streaming `messages.create` (per `inspiration_breakdown.md` §2 fail-open). **Verify:** live golden prompt for Communicator emits `stream_chunk` events; killed-stream recovers via non-stream fallback.

**D-S3.2 — Logger with named child loggers + App Insights adapter.** `src/lib/logger.ts` — `logInfo.child({userId, ticketId, persona, ...})` returns a child logger with bound context. Wire the App Insights adapter via the `appinsights-instrumentation` skill (auto-track dependencies + requests). **Verify:** `logInfo.child({userId:"u1"}).warn("test")` produces a JSON line with `userId:"u1"`.

**D-S3.3 — Semantic cache (opt-in).** `src/lib/semanticCache.ts` — Redis-backed cache keyed on normalized query embeddings (Stage 2 was skeleton-only). For repeated read/analytics questions, returns cached results in < 50 ms. Gated by env `SEMANTIC_CACHE_ENABLED=false` by default. **Verify:** two identical analytics prompts within 1 min → second one returns cached result, marked cached.

**D-S3.4 — Cost calculator completion.** `src/lib/costCalculator.ts` — `priceFor(provider, model)` returns `{in, out}` per million tokens via the provider rate card. `usageSummary(userId)` reads `AgentUsage` and derives all-time tokens + dollar cost + per-day and per-provider breakdowns. **Verify:** insert 10 `AgentUsage` rows; `usageSummary` returns the correct total cost.

**D-S3.5 — PR-gating vs nightly eval.** `tests/agent/eval/stubRunner.ts` runs on `npm run agent:eval` (PR-gating; deterministic with mocked LLM; finish in < 30s). `tests/agent/eval/runner.ts` runs on `npm run agent:eval:live` (nightly; real LLM; writes report to `tests/agent/eval/reports/`). CI config gates on the stubbed suite. **Verify:** PR with a stubbed-test failure fails CI. A PR with only `npm run agent:eval:live -- --skip` passes CI.

**D-S3.6 — Multi-agent integration load test.** `tests/agent/multi-agent/load_test.ts` — spawns 100 concurrent `Orchestrator.execute()` calls with mock intents. Asserts P99 latency < 30 s, 0 data-loss via per-ticket sandbox merge integrity check, 0 auth-bypass via negative suite. **Verify:** run against a local Redis + Mongo; assert all three SLAs.

**D-S3.7 — Skills management UI.** `src/components/AgentSkillsDrawer.tsx` (NEW) — list user skills + built-ins, "Test", "Edit", "Delete" actions wired to an API endpoint in `/api/agent/skills/` (NEW — small CRUD routes; Agent D owns them, calls Agent B's `SkillRegistry`). `src/components/AgentSidebarDrawer.tsx` extended to surface new tool kinds (user prefs/notifications/exports) in the trace visualization. `src/components/AgentVisualizer.tsx` — render `{type:"turn", role, ts}` and `{type:"complete", state}` SSE events (typed heartbeats). **Verify:** user opens drawer, sees their skills list, edits a skill, sees version bump.

**D-S3.8 — Final docs sync.** Reconcile `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md`, `docs/agent/AGENT-OVERVIEW.md` with the shipped state. Create `docs/agent/ARCHITECTURE.md`, `docs/agent/API.md`, `docs/agent/RUNBOOK.md`, `docs/agent/TROUBLESHOOTING.md`. Every v3 definition-of-done item (spec §11 1–9) maps to a doc paragraph. **Verify:** spec coverage check — every tool listed in spec §3.1 has a doc entry.

### 3.4 Stage 3 — Choreographed swap proof (no conflict)

**The Riskiest Move — `console.*` → pino across the agent tree.**
- **Problem:** Agent D owns `logger.ts`; the `console.*` calls live in Agent A's `agentLoop.ts` + persona files.
- **Choreography:** Agent D ships the *completed* `logger.ts` (named child loggers, App Insights adapter wired) FIRST in Stage 3 — isolated commit, no other files touched. Then Agent A performs the swap in its owned files (`agentLoop.ts` + persona files). The swap is a mechanical regex (`console.log(...)` → `logInfo(...)`, etc.) with bound context where needed. **No overlapping files.**

**The Second Riskiest Move — Orchestrator role promotion.**
- Agent A writes `src/agent/orchestrator/**` AND `src/agent/critic/**` AND `src/agent/executors/**` entirely in this stage (scaffolds from Stage 2 are filled with real impl). Agent D writes only the new HTTP `/api/agent/skills/*` CRUD routes + the UI; both teams agree only on `SkillRegistry.list/register/delete` (frozen Stage 1). **No overlapping files.**

**The Third Riskiest Move — Memory vector store.**
- Agent C's `src/agent/memory/vector.ts` is a new file; Agent C owns `src/agent/memory/**` entirely (Stage 2 added `service.ts`, `compaction.ts`, `context.ts`; Stage 3 adds `vector.ts`, `preferences.ts`, `procedural.ts`). Agent A's `Orchestrator` calls `memory.assembleContext` (frozen Stage 1). **No overlapping files.**

### 3.5 Stage 3 — Integration & Verify Gate

1. **Integration commit order:**
   - Agent C models (`OrchestratorExecutionModel`, `OrchestratorCheckpointModel`, `OrchestratorAuditModel`, `AgentSkillModel` v2, `memory/vector`, `preferences`, `procedural`).
   - Agent B skills validator + sandbox merge extension + policy + `getAllowedTools` helper.
   - Agent A orchestrator + critic + executors + lock + sandbox store + budget + audit + legacy shim + replay + visualize + skill author + console→pino + communicator streaming + DAG planner.
   - Agent D llmClient streaming + logger + semantic cache + cost calculator + skill CRUD routes + eval CI wiring + UI drawer + visualizer + final docs.
2. **Verify:**
   - `npx tsc --noEmit` — clean cross-file types.
   - `npm run lint` — clean.
   - `npm run build` — Next.js production build clean.
   - `npm run agent:eval` — stubbed suite green; nightly live report compared with previous (no regressions).
   - `npm run agent:validate-skills` — built-in + user skills valid.
   - Manual: open `AgentSkillsDrawer`, edit a skill; verify version bump.
   - Manual: submit a multi-form prompt with `AGENT_V3_ENABLED=true`; verify DAG parallelism + SSE stream.
3. **Stage 3 exit.** All four pass + spec §11 DoD items 1–9 verified → cut the `v3` ship-tag.

---

## 4. Final Definition of Done Mapping (across all stages)

`agent_spec.md` §11 DoD item → stage + agent that delivers it:

| DoD | Stage | Agent(s) |
|---|---|---|
| 1 — 28-tool catalog gated + golden+negative prompts each | 2 | B (catalog), D (prompts) |
| 2 — Mutations via sandbox + transactional idempotent merge | 1 (D0.4) + 2 (sandbox merge extension) | B (+A for reply rendering) |
| 3 — Budget/deadline/abort/replan gates in code | 1 (D0.2, D0.3, D0.7) + 2 (per-skill budget) + 3 (per-tool-call budget) | A |
| 4 — Memory service: recurring fields, skill-usage stats, recent failures; Drafter reads them | 2 | C (models+service), A (Drafter hydration) |
| 5 — User can author/edit/delete a skill; immediately usable by Skill Router | 3 | A (skillAuthor), B (validator+registry), C (AgentSkillModel) |
| 6 — Stubbed unit eval PR-gating; nightly live drift-reporting | 1 (skeleton) + 3 (full) | D |
| 7 — Per-persona latency/token/cost in `AgentUsage` + admin dashboard | 2 (latency field) + 3 (full) | C (field), D (dashboard consumer) |
| 8 — `lint`, `tsc --noEmit`, `build`, `agent:eval` all pass in CI | 1+2+3 | all |
| 9 — Negative-prompt suite gates invariants (`Response` read-only, sandbox-bypass, skip-confirmation-on-delete) | 2 (D-S2.5) | D + B (enforcement) |

---

## 5. Risk Register (drift surfaces to monitor across stages)

| Risk | Where it surfaces | Mitigation |
|---|---|---|
| Schema-migration drift — Agent C adds a Mongo field; Agent A's write path doesn't know about it | Stage 1 (D0.7), Stage 2 | Contract sheet freezes field names BEFORE the stage starts; integration verification runs as a single pass per stage (§1.4, §2.4, §3.5) |
| Skills Registry API drift — Agent A's Skill Router calls `loadSkillRegistry()`, Agent B refactors that signature | Stage 2 | `SkillRegistry` interface frozen in Stage 1 (§0.3) |
| Orchestrator signature drift — Agent A's `Orchestrator.execute(input)` evolves; Agent D's UI/HTTP routes break | Stage 3 | Frozen in §0.3 contract sheet; signed-off at stage entry |
| Eval drift — Agent D adds an assertion field (`expectedSandboxShape`); Agent A's `sandboxRedisStore` returns a different shape | Stage 2 | Same contract sheet; integration gate catches the divergence |
| Doc-rot — New tools land but `guidelines.md` / `permissions.json` are out of sync | Each stage | `design.md` A4 mandate already encoded; per-stage Exit Criteria enforce `agent:validate-skills` pass |
| `console.*`→pino swap causing a logging-format break | Stage 3 | Choreographed: Agent D ships logger first; Agent A's swap is a mechanical regex |
| Mongo TTL index partial-filter drift when adding `CANCELLED` status | Stage 1 (C) | Agent C alone owns the TTL filter expression in `agentTicketModel.ts`; verified with a unit test |
| Loop-refactor breaks active tickets | Stage 3 | `AGENT_V3_ENABLED=false` default; legacy shim routes new tickets through `Orchestrator` only when env flag is set; existing tickets resolve through the unchanged linear path until they drain |

---

## 6. Summary

- **3 stages, sequentially gated.** Each stage ends with one integration commit and one full CI run; no stage starts until the prior stage is green.
- **4 agents in parallel per stage.** Within a stage, file ownership is exclusive — every touched file appears in exactly one agent's column of the matrix; an agent MUST NOT edit a file owned by another.
- **Contracts are frozen up front.** Cross-agent dependencies flow through the contract sheet (§0.3) — never through reading each other's code in real time.
- **Hot-zone files keep a constant owner across stages** (`agentLoop.ts`→A; `tools.ts`/`agentTools.ts`/`permissions.ts`/`sandboxMerge.ts`→B; `llmClient.ts`/`logger.ts`/`tests/agent/eval/**`→D; all Mongo models→C). No ownership transfer mid-stream — predictability of ownership is the precondition for parallel safety.
- **This plan treats both spec pairs as descriptions of the same agent**, not two parallel systems. Stage 1 fixes defects; Stage 2 expands the capability surface; Stage 3 refactors the linear 4-persona loop into the hierarchical multi-agent shape (named `Orchestrator` / `Critic` / `executors/{forms,responses,views,generic}` / DAG `Planner`) inside the existing `src/agent/` tree. The `/api/agent/execute` route signature stays identical so active tickets resume without breakage.
- **Defects first.** Stage 1 fixes every P0 defect before any new capability is built — guarantees that Stages 2–3 build on a non-drifting, deadline-bounded, user-cancellable, typed-error-producing foundation.
- **All invariants preserved end-to-end.** `Response` read-only; sandbox-first mutation; human confirmation on destructive; permission gating; per-user lock (legacy) + per-execution lock (Stage 3 multi-intent parallelism); PII redaction; strict JSON contracts — verified continuously by the negative-prompt suite.

**End of Plan.**
