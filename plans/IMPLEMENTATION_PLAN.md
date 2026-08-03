# Easy Forms Agent v3 — Parallel Implementation Plan

> **Source specs:** `plans/agent_spec.md`, `plans/agent_upgrade_v3.md`, `plans/pi_agent_spec.md`, `plans/pi_agent_upgrade_v3.md`, `plans/agy_implementation_plan.md`, `plans/inspiration_breakdown.md`
>
> **Goal:** Ship the v3 Agent (full end-to-end control, defect-free, complete-without-failing) and lay the groundwork for the PI multi-agent system.
>
> **Strategy:** Split the work into **3 sequential stages**. Each stage runs **4 agents in parallel**. Within a stage, every file is owned by exactly **one** agent — no two agents touch the same file. Between stages, ownership can transfer (handoff). This guarantees zero merge conflicts during parallel execution.

---

## Stage 0: Stage / Agent Boundary Rules (READ FIRST)

### 0.1 The Non-Conflict Contract

A merge conflict can ONLY occur when two parallel agents edit the same file. We prevent this by:

1. **File ownership is exclusive within a stage.** The matrix below lists every file touched in a stage against the agent that owns it. If a file does not appear in an agent's column, that agent MUST NOT edit it.
2. **Shared "hot-zone" files are serialized across stages.** Files like `agentLoop.ts`, `tools.ts`, `agentTools.ts`, `permissions.ts`, `sandboxMerge.ts`, `types.ts` are edited by ONE agent per stage, never two in the same stage.
3. **New files have no conflict risk.** Entirely new directories (`src/agent/pi/`, `src/agent/skills/`, `src/agent/memory/`, `tests/agent/pi/`) are partitioned across agents by subdirectory.
4. **Interface contracts are frozen up front.** Before a stage starts, every agent's exported type signatures and function names that another agent will *call* or *import* must be agreed. We do this with a "contract sheet" (§0.3) so agents code against interfaces, not implementations.
5. **No agent may run `git add -A` or `git commit -am`.** Each agent stages only its own owned files. A stage ends with a merge-integration step performed by a single coordinator pass.

### 0.2 The Four Agent Roles (Constant Across Stages)

| Agent | Role | Theme |
|---|---|---|
| **Agent A — Core Loop & Orchestration** | Owns the main loop, orchestrator, types, ACP bus, the legacy shim. The "spine" of the system. | Loop integrity, budget, deadlines, aborts, replan |
| **Agent B — Tools, Sandbox & Policy** | Owns the tool catalog, sandbox store, merge engine, permissions, skills registry. The "hands." | CRUD surface, sandbox isolation, permission gating |
| **Agent C — Memory, Models & Persistence** | Owns all Mongoose models, the Memory Service, migration, vector store. The "brain." | Data persistence, recall, episodic/semantic memory |
| **Agent D — LLMOps, Eval, UI & Docs** | Owns LLM client, eval suite, SSE/WS streaming, UI components, docs. The "voice & evidence." | Model routing, streaming, observability, user surface |

### 0.3 Contract Sheet (Frozen Before Stage 1)

These interface signatures MUST be committed (as `src/agent/pi/types.ts` + `src/agent/skills/types.ts` + `src/agent/memory/types.ts`) by **Stage 1** so downstream stages code against the interface, not the implementation. Each agent commits only its OWN types file.

```typescript
// src/agent/pi/types.ts — owned by Agent A
export interface ExecutionPlan { planId: string; goal: string; tasks: TaskNode[]; edges: TaskEdge[]; ... }
export interface TaskNode { taskId: string; agent: ExecutorIdentity; skill: string; tool: string; params: Record<string, any>; dependsOn: string[]; ... }
export interface CriticVerdict { verdict: "pass"|"conditional_pass"|"fail"|"escalate"; score: number; findings: Finding[]; requiredFixes: FixDirective[]; ... }
export interface ExecutionState { executionId: string; userId: string; status: ExecutionStatus; plan: ExecutionPlan; taskStates: Map<string, TaskState>; ... }
export interface AgentCancelledError extends Error { code: "AGENT_CANCELLED"; ticketId: string; }
export interface LoopTimeoutError extends Error { code: "LOOP_TIMEOUT"; deadlineMs: number; }

// src/agent/skills/types.ts — owned by Agent B
export interface SkillDefinition { skillId: string; name: string; version: string; permissionScope: string; tools: ToolRef[]; maxIterations: number; negativeTests: NegativeTest[]; ... }
export interface SkillRegistry { resolve(skillName: string, userId: string): Promise<SkillDefinition | null>; register(skill: SkillDefinition, author: string): Promise<SkillDefinition>; ... }

// src/agent/memory/types.ts — owned by Agent C
export interface AgentMemory { userId: string; key: string; value: unknown; confidence: number; lastUsedAt: Date; }
export interface MemoryService { getMemory(userId: string, key?: string): Promise<AgentMemory | AgentMemory[]>; setMemory(userId: string, key: string, value: unknown, opts?: { confidence?: number }): Promise<void>; recordSkillUse(userId: string, skill: string, ok: boolean, iterations: number): Promise<void>; recordFailure(userId: string, promptHash: string, err: string): Promise<void>; recentFailures(userId: string, sinceMs: number): Promise<AgentFailure[]>; summarize(ticketId: string): Promise<string>; }
```

### 0.4 Hard Invariants (Preserved Across All Stages)

From `.agents/Agent.md` §2 and `src/agent/guardrails.md`:
- **Form submission responses are strictly read-only.** No `Response` write tool ever.
- **Sandbox isolation before production merge.** Mutations queue in `sandbox:{userId}:{ticketId}` (24h TTL); merge only on user Confirm & Merge click inside a Mongo transaction with `$setOnInsert` idempotency + `expectedUpdatedAt`.
- **Human confirmation for destructive actions.** Deletes halt the loop, surface a confirmation modal with a one-click backup suggestion.
- **Permission verification.** Every tool passes `permissions.ts` against `permissions.json` before execution.
- **Loop budget.** Executor↔Evaluator retries capped (per-skill override via registry).
- **Strict JSON contracts** between personas (`safeJSON`); **PII redaction** (`redactPII`) before any LLM call.
- **Per-user Redis lock** `agent_lock:{userId}` serializes the legacy loop; per-execution lock `pi_lock:{executionId}` for the new PI system (parallel).

### 0.5 Build / Verify Invariants

After **every** stage:
1. `npm run lint` MUST pass.
2. `npx tsc --noEmit` MUST pass.
3. `npm run build` MUST pass.
4. If any agent touched `src/agent/**`, `src/lib/llmClient.ts`, or `src/lib/agentTools.ts`: `npm run agent:eval` MUST pass.
5. **No agent merges its own PR.** The stage ends with a single integration commit; then CI runs once.

The per-stage plan below lists, for each of the 4 agents, the **exact files owned** in that stage and the **exact tasks** to execute. Verify steps are mandatory at the end of each agent's work, before the integration commit.

---

## Stage 1 — Defect Fixes + Foundation Skeleton (Week 1)

### 1.1 Stage Goal

**Fix every P0 defect that breaks the loop today, AND lay the foundation** (types, new directories, contract sheet) for PI multi-agent. After Stage 1, the existing loop never drifts, never runs past the deadline, replan is reachable, trace is PII-redacted, the loop is user-cancellable, typed errors produce typed replies, reads leave a trail, and the Drafter rules are contiguous. Stage 1 also creates the empty skeletons of `src/agent/pi/`, `src/agent/skills/`, and `src/agent/memory/` with the frozen type exports so Stages 2 and 3 can code against interfaces.

**Exit criteria.**
- All P0 defects from `agent_upgrade_v3.md` (D0.1–D0.10) are fixed and have a stubbed unit-eval row each.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass.
- `src/agent/pi/types.ts`, `src/agent/skills/types.ts`, `src/agent/memory/types.ts` exist and export the contract-sheet interfaces (0.3).

### 1.2 Stage 1 — File Ownership Matrix

The key insight for zero conflicts: **the four hot-zone legacy files (`agentLoop.ts`, `agentLoop-adjacent config`, `types.ts` at `src/agent/types.ts`, `agentTicketModel.ts`)** are concentrated in **Agent A** in this stage, because Stage 1's defects are almost all loop-state and trace-shape fixes. Agent B handles tools/policy defects (D0.4 merge stats, D0.8 Drafter prompt numbering lives in `prompts/v1/drafter.json` which is Agent B's), Agent C handles the new model fields (defect D0.7 needs `agentTicketModel` additions — coordinated via a frozen callback contract instead of dual ownership), and Agent D handles LLMOps defects (D0.5, D0.6, D0.9) plus the eval skeleton.

To avoid the one true conflict (D0.7 needs both `agentLoop.ts` and `agentTicketModel.ts`), the contract is: **Agent A** edits `agentLoop.ts` to emit a typed `AgentCancelledError` (defined in `src/agent/types.ts`, owned by A); **Agent C** adds the `CANCELLED` enum value, the `errorKind` field, and the TTL partial-filter extension to `agentTicketModel.ts` independently. Neither touches the other's file.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` | **A** (D0.1, D0.2, D0.3, D0.5, D0.7, D0.9 orchestration, D0.10 trace hook) |
| `src/agent/types.ts` | **A** (add `AgentCancelledError`, `LoopTimeoutError`, `ErrorKind` union) |
| `src/agent/sandbox/agentLock.ts` | **A** (D0.2 — `LOCK_TTL_MS` env-driven, heartbeat) |
| `src/agent/personas/evaluator.ts` | **A** (D0.3 — new `decision: "replan"` enum signal) |
| `src/agent/personas/drafter.ts` | **A** (D0.10 — minimal trace hook in read-only shortcut) |
| `src/agent/prompts.ts` | **A** (D0.8 — deprecate to legacy fallback path, route to v1 JSON) |
| `src/agent/pi/types.ts` | **A** (NEW — freeze `ExecutionPlan`, `TaskNode`, `CriticVerdict`, `ExecutionState`, errors) |
| `src/agent/pi/acp.ts` | **A** (NEW — skeleton `MessageBus` interface + in-memory impl, no consumers yet) |
| `src/app/api/agent/abort/route.ts` | **A** (NEW — D0.7 — POSTs `agent:abort:{ticketId}` flag) |
| `src/agent/sandbox/sandboxMerge.ts` | **B** (D0.4 — split `mergedForms` into 6 raw counters) |
| `src/agent/prompts/v1/drafter.json` | **B** (D0.8 — contiguous rule numbering 1..20) |
| `src/agent/tools.ts` | **B** (skeleton for Stage 2 — add no tools yet, only structurally group for upcoming bundles) |
| `src/agent/policy/permissions.ts` | **B** (skeleton for new scopes — `skill_authoring`, `bulk_operations`, `system_admin`, `integration_management`, `agent_audit` enums only; defaults unchanged) |
| `src/agent/permissions.json` | **B** (skeleton — new scope keys default `false`) |
| `src/agent/guidelines.md` | **B** (template for upcoming tool entries) |
| `src/agent/skills.md` | **B** (note: skills.md will be superseded by Skills Registry in Stage 2; mark a deprecation header) |
| `src/agent/skills/types.ts` | **B** (NEW — freeze `SkillDefinition`, `SkillRegistry` interface) |
| `src/agent/skills/registry.json` | **B** (NEW — empty array `[]` placeholder; built-ins land in Stage 2) |
| `src/models/agentTicketModel.ts` | **C** (D0.7 — add `CANCELLED` to status enum + ttl partial filter; D0.9 — add `errorKind` field + index) |
| `src/models/agentUsageModel.ts` | **C** (add `latencyMs` field + index for L2.1 prep) |
| `src/agent/memory/types.ts` | **C** (NEW — freeze `AgentMemory`, `MemoryService` interface, `AgentFailure`, `AgentSkillUsage`) |
| `src/agent/memory/index.ts` | **C** (NEW — re-export barrel from `types.ts`; service impl lands Stage 2) |
| `src/agent/helper/redact.ts` | **D** (D0.6 — add `redactTracePayload(obj)` tree walker; keep `redactPII` untouched) |
| `src/lib/llmClient.ts` | **D** (D0.9 prep — typed error classes already exist; wire `LLMRateLimitError` / `LLMTimeoutError` surfacing up the call stack, no API change yet) |
| `src/lib/llmHealthMonitor.ts` | **D** (L2.3 — branch probe URL on `LLM_PROVIDER`) |
| `src/lib/logger.ts` | **D** (NEW — thin pino adapter with App Insights stub; no replacements yet, just exports) |
| `tests/agent/eval/stubRunner.ts` | **D** (NEW — wire `__testRetryLLMOverride` into CI; empty fixture set) |
| `tests/agent/eval/fixtures/` | **D** (NEW — empty dir + `.gitkeep`) |
| `tests/agent/eval/reports/` | **D** (NEW — empty dir + `.gitkeep`) |
| `tests/agent/eval/negative-prompts.jsonl` | **D** (NEW — empty file; prompts land Stage 2) |

### 1.3 Stage 1 — Detailed Tasks per Agent

---

#### **Agent A — Core Loop & Orchestration**

**A-S1.1 — `[DEFECT D0.1]` Mongo↔Redis state drift**
- **What:** In `src/agent/agentLoop.ts` around lines 182–229, `shouldPersistToMongo` skips writes on most transitions. Remove the conditional. Call `agentTicketModel.updateOne` on every transition using the existing `compressTraceForMongo` helper (already instrumented; nothing to add to `agentTicketModel.ts` — Agent C will only touch unrelated fields).
- **Why:** A crash between a skipped Mongo write and the next Redis save leaves resumed state stale. Mongo must be authoritative.
- **How:** Delete the `if (shouldPersistToMongo(...))` gate; keep the write unconditional. The compressed trace row is ~3 KB so cost is bounded.
- **Verify:** Add a stubbed unit eval row `tests/agent/eval/stubRunner.ts` (coordinated with Agent D's skeleton — Agent A writes one row, Agent D's harness picks it up) that kills the process between PLANNER and EXECUTOR via a `__testCrash` flag, resumes from Mongo, asserts the persona is PLANNER. Agent D provides the harness; Agent A provides the row.

**A-S1.2 — `[DEFECT D0.2]` Lock TTL shorter than worst-case loop**
- **What:** `src/agent/agentLock.ts` uses a 60 s TTL; `agentLoop.ts` has no deadline. Add `LOOP_DEADLINE_MS` (env, default `120000`), checked at the top of every `while` iteration. On expiry: throw `LoopTimeoutError` (new — added to `src/agent/types.ts`, owned by A). Raise `LOCK_TTL_MS` to `max(LOOP_DEADLINE_MS, 60000) + 5000`.
- **Why:** A 4-persona × 3-retry × 30 s LLM timeout can run ~6 min; the lock expires and parallel runs write stale state.
- **How:** Edit `agentLock.ts` `acquireAgentLock` to read `LOCK_TTL_MS` from `process.env`. Edit `agentLoop.ts` `while (isLooping)` to compute `Date.now() - state.startedAtMs > LOOP_DEADLINE_MS` and throw. The outer `catch` already routes to `handleFailure`; add `instanceof LoopTimeoutError` branch in the next task.
- **Verify:** Chaos unit eval: stub an LLM that sleeps 40 s per call; assert the loop returns `LoopTimeoutError` around the 120 s mark and the lock is released.

**A-S1.3 — `[DEFECT D0.3]` Replan unreachable; 2nd identical retry wastes the budget**
- **What:** `agentLoop.ts:609-618` retries into EXECUTOR_SANDBOX with the same plan on `shouldRetry`. Promote the existing `feedbackPreamble` (`planner.ts:124-128`) into a reachable path: 1st retry → EXECUTOR_SANDBOX; 2nd retry → PLANNER_MIXER with `evaluatorFeedback`; 3rd → COMMUNICATOR asks user.
- **Why:** A structurally-wrong plan (e.g., `update_form` when the user wanted `create_form`) cannot recover — 3 iterations are wasted on identical runs.
- **How:** In `evaluator.ts` (owned by A in this stage), add a `decision` enum: `"retry" | "replan" | "ask_user" | "complete"`. The Evaluator returns `replan` on the 2nd failure. `agentLoop.ts` reads `state.retryCount` and routes accordingly. Cache the failed plan into `state.priorPlans[]` so the Planner sees both the failed plan and the feedback side-by-side (matches `feedbackPreamble`'s existing design).
- **Verify:** Golden prompt with a deliberately bad first plan (stubbed Executor returns `error` on `update_form`); assert the 2nd retry goes through the Planner (trace shows `persona: "PLANNER"` again), and the 3rd surfaces a user question.

**A-S1.4 — `[DEFECT D0.5]` Simulated-offline not hoisted out of branch logic**
- **What:** `agentLoop.ts:576-590` re-checks `simOfflineKey` only inside the PLANNER branch. Hoist a single `isSimulatedOffline` check to the top of `while`, throw immediately before persona dispatch. Drop the duplicate in the Planner branch.
- **Why:** Other branches silently proceed when they should trip uniformly.
- **How:** Single `if (simOfflineKey && /* matches */) throw new SimulatedOfflineError(...)` at the top of `while`. The outer `catch` already routes to `handleFailure`.
- **Verify:** Existing simulate-offline test should now trip in EVERY persona; add a stubbed eval row asserting the throw happens in EXECUTOR_SANDBOX.

**A-S1.5 — `[DEFECT D0.7]` User-abort signal**
- **What:** Add `agent:abort:{ticketId}` Redis flag, polled at the top of every `while` iteration in `agentLoop.ts`. New error class `AgentCancelledError` in `src/agent/types.ts` (Agent A owns both). On detection: call `handleFailure(new AgentCancelledError(...))`, set Mongo ticket status to `CANCELLED` (Agent C adds the enum value), release the lock, emit `{type:"cancelled"}` SSE event before `[DONE]`.
- **Why:** There is no way to cancel a running loop; the server keeps running until the lock releases (minutes).
- **Coordinate with Agent C:** Agent C adds `CANCELLED` to the `status` enum and the ttl partial-filter expression in `agentTicketModel.ts`. Agent A's `handleFailure` writes `status: "CANCELLED"`. They never touch each other's file.
- **Coordinate with Agent D:** Agent D's `src/lib/logger.ts` adapter can be optionally imported by Agent A; if `logger` is undefined, fall back to `console.*` (Stage 1 doesn't replace console.* yet — that's Stage 3).
- **New file:** `src/app/api/agent/abort/route.ts` — POST handler that sets the Redis flag from the client. Agent A owns it.
- **Verify:** Start a 4-persona loop; abort mid-Executor via the new route; assert the lock is released within 1 s, the SSE event fires, the Mongo ticket is `CANCELLED`.

**A-S1.6 — `[DEFECT D0.9]` Communicator double-branches on `LLMOfflineError` only**
- **What:** `agentLoop.ts:232-266` `handleFailure` collapses `LLMRateLimitError` / `LLMTimeoutError` / `LLMHTTPError` into a generic "AI processing interrupted" reply. Branch on each typed error to produce a user-readable recovery message. Set a new `ticket.errorKind` field (Agent C adds the schema field + index) per Mongo ticket.
- **Why:** The user cannot distinguish a timeout from a 5xx today.
- **Coordinate with Agent C:** Agent C adds `errorKind: { type: String, enum: [...], index: true }` to `agentTicketModel.ts`. Agent A's `handleFailure` writes the typed value.
- **Verify:** One stubbed eval row per error kind (timeout, rate-limit, HTTP 5xx, offline) asserting the right reply text.

**A-S1.7 — `[DEFECT D0.10]` Read-only shortcut bypasses trace**
- **What:** `drafter.ts:216-242` calls `executeAgentTool` directly on `READ_ONLY_SKILLS`, leaving no `ExecutionTraceStep` or `AgentUsage` row. Add a minimal trace step in the read-only shortcut.
- **Why:** "List my forms" leaves no persistent trail — observability hole.
- **How:** In `drafter.ts` (owned by A in this stage), after the read `executeAgentTool` call, push a trace step `{ persona: "DRAFTER", message: "Read query: <toolName>", result, ts: Date.now() }` into `state.executionTrace`. The trace is persisted by `addTrace` logic in `agentLoop.ts` (also Agent A).
- **Verify:** Send "list my active forms"; inspect the Mongo `executionTrace` doc; assert a step exists with `persona: "DRAFTER"`.

**A-S1.8 — `[DEFECT D0.8]` Drafter prompt rule numbering jumps 7 → 20**
- **What:** `prompts.ts:20-27` has missing rules 8–19. The versioned JSON at `prompts/v1/drafter.json` is canonical now (loader at `prompts/loader.ts:79`). Deprecate `prompts.ts` to a fallback-only path that logs a warning; renumber `prompts/v1/drafter.json` contiguously from 1.
- **Coordinate with Agent B:** Agent B owns `prompts/v1/drafter.json`. Agent A owns `prompts.ts`. They never touch each other's file. The contract: JSON keys and shape remain identical; only rule numbering changes. Agent A calls `loadPrompt("drafter", "v1")` unconditionally and falls back to the inline string in `prompts.ts` only if the loader throws.
- **Verify:** Diff the loaded prompt byte-by-byte against a canonical string; run `npm run agent:eval` before + after; if results drift, investigate before merging.

**A-S1.9 — PI types skeleton**
- **What:** Create `src/agent/pi/types.ts` exporting the Stage-0 contract-sheet interfaces (`ExecutionPlan`, `TaskNode`, `TaskEdge`, `Checkpoint`, `CriticVerdict`, `ExecutionState`, error classes). Create `src/agent/pi/acp.ts` exporting a `MessageBus` interface and an in-memory stub implementation (no consumers yet — Stages 2 and 3 wire it).
- **Why:** Freeze the contracts so Stage 2's executors (Agent B) and Stage 3's memory (Agent C) can code against interfaces.
- **Verify:** `npx tsc --noEmit` passes with the new files. The new types compile in isolation.

**A-S1.10 — Abort route**
- **What:** `src/app/api/agent/abort/route.ts` — a Next.js POST handler: body `{ ticketId: string }`, sets `agent:abort:{ticketId}` in Redis with a 60 s TTL, returns `{ ok: true }`. Authenticated via the existing NextAuth session (import `getServerSession` like other routes in `src/app/api/agent/`).
- **Verify:** CORS + auth check: unauthenticated requests return 401; missing ticketId returns 400; returns 200 on success.

---

#### **Agent B — Tools, Sandbox & Policy**

**B-S1.1 — `[DEFECT D0.4]` Merge stats inflated**
- **What:** `sandboxMerge.ts:380-385` computes `mergedForms` as `stats.mergedForms + stats.updatesApplied + stats.deletesApplied`. `agentLoop.ts:336-339` then prints "Forms created: X" where X includes updates + deletes. Return the raw `{ mergedForms, mergedViews, updatesApplied, updatesMissed, deletesApplied, deletesMissed }` dict; Agent A edits the reply text in `agentLoop.ts` (Agent A owns it).
- **Why:** "Forms created: 2" when the user actually updated 1 and deleted 1 is a user-faced lie.
- **Coordinate with Agent A:** Agent B changes the *shape returned* by `mergeSandboxToProduction`. Agent A's reply renderer in `agentLoop.ts:336-339` reads the new shape. They code against the agreed contract: `MergeStats = { mergedForms: number; mergedViews: number; updatesApplied: number; updatesMissed: number; deletesApplied: number; deletesMissed: number; }`. Add this type to `src/agent/sandbox/types.ts` (NEW, Agent B owns).
- **How:** Create `src/agent/sandbox/types.ts` exporting `MergeStats`. Edit `sandboxMerge.ts` to return `MergeStats`. The standalone merge path at `sandboxMerge.ts:337` has the same bug — fix it too.
- **Verify:** Unit test: create 1 draft, update 1, delete 1 in the same sandbox; assert `mergeSandboxToProduction` returns `{ mergedForms: 1, updatesApplied: 1, deletesApplied: 1, ... }` not `mergedForms: 3`.

**B-S1.2 — `[DEFECT D0.8]` Drafter rules renumbered**
- **What:** `src/agent/prompts/v1/drafter.json` has rule numbers jumping 7 → 20. Renumber rules 1..N contiguously. Audit each rule against `.agents/design.md` B9 quality gate (every rule true/false testable, has a *why*).
- **Why:** Classic prompt-edit scar; reviewers can't tell if rules 8–19 are deleted, merged, or never existed.
- **Coordinate with Agent A:** Agent A owns `prompts.ts` (the legacy fallback). Agent B owns `prompts/v1/drafter.json`. JSON keys and structure identical; only numbering changes.
- **How:** Open `prompts/v1/drafter.json`, locate the `rules` array or numbered keys, renumber starting from 1 with no gaps. Each rule keeps its existing body; only the `n` field changes.
- **Verify:** Diff the loaded prompt byte-by-byte against a curated canonical string. Run `npm run agent:eval` before + after. If results drift, investigate before merging.

**B-S1.3 — Skills Registry skeleton**
- **What:** Create `src/agent/skills/types.ts` exporting the frozen contract: `SkillDefinition`, `SkillRegistry` interface (`resolve`, `register`, `list`, `delete`, `validate`). Create `src/agent/skills/registry.json` with `[]` (empty built-in skill array). Create `src/agent/skills/loader.ts` exporting `loadSkillRegistry(): SkillDefinition[]` (returns parsed `registry.json`).
- **Why:** Skill Router (Stage 2) and Skill Synthesis (Stage 3) need the contract frozen before they can code.
- **Why zero conflict:** All three files are NEW. No other Stage-1 agent touches `src/agent/skills/`.
- **Verify:** `npx tsc --noEmit` passes. Loading `registry.json` returns `[]`.

**B-S1.4 — Permissions scaffold for new scopes**
- **What:** `src/agent/policy/permissions.ts` — add new scope enum values for the upcoming tool catalog:
  - `skill_authoring` (default `false`)
  - `bulk_operations` (default `false`)
  - `system_admin` (default `false`)
  - `integration_management` (default `false`)
  - `agent_audit` (default `true`)
- Update `src/agent/permissions.json` to include the new scope keys with defaults. No `ALLOWED_TOOLS` additions yet (no new tools in Stage 1).
- Update `src/agent/guidelines.md` to document the new scopes with stub descriptions.
- Add a deprecation header to `src/agent/skills.md` noting that skills will be first-class artifacts in `src/agent/skills/registry.json` starting in Stage 2.
- **Why:** Stage 2 introduces tools that map to these scopes; the policy infra has to ship first to avoid a big-bang Stage 2 PR.
- **Verify:** `npx tsc --noEmit` passes. `permissions.ts` exports the new scopes in `ALL_SCOPES`. A unit-test snippet in `tests/agent/policy.spec.ts` (NEW, Agent B owns) asserts `checkToolPermission("nonexistent_tool", {})` still returns `false` for every scope.

---

#### **Agent C — Memory, Models & Persistence**

**C-S1.1 — `agentTicketModel` status + errorKind extension**
- **What:** `src/models/agentTicketModel.ts`:
  - Add `"CANCELLED"` to `status` enum.
  - Extend the TTL partial-filter expression (`expireAt`) to exclude `CANCELLED` (same treatment as `AWAITING_USER_APPROVAL`).
  - Add `errorKind` field: `{ type: String, enum: ["timeout", "rate_limit", "http_5xx", "offline", "cancelled", "oom", "unknown"], index: true, default: "unknown" }`.
- **Why:** Agent A's `handleFailure` writes `status: "CANCELLED"` and `errorKind: "timeout"` (etc) when the loop dies; the schema must accept them.
- **Coordinate with Agent A:** Agent C does NOT touch `agentLoop.ts`. Agent A's write path is constructed against this schema; they code against the agreed field names.
- **Verify:** Insert a test ticket with `status: "CANCELLED"`, `errorKind: "timeout"`; assert it saves and indexes. The TTL index skips it.

**C-S1.2 — `agentUsageModel` latency field**
- **What:** `src/models/agentUsageModel.ts` — add `latencyMs: { type: Number, index: true, default: 0 }`. This is prep for L2.1 (per-persona latency to `AgentUsage`).
- **Why:** Needs to ship in Stage 1 so the Stage 3 LLMOps agent can populate the field without a schema migration.
- **Verify:** Existing writes still work (the field has a default). Insert a row, assert `latencyMs` defaults to `0`.

**C-S1.3 — Memory Service types skeleton**
- **What:** Create `src/agent/memory/types.ts` exporting the frozen contract: `AgentMemory`, `MemoryService` interface, `AgentFailure`, `AgentSkillUsage`. Create `src/agent/memory/index.ts` re-exporting from `types.ts`. The actual `MemoryService` implementation + Mongo models land in Stage 2.
- **Why:** Stage 2's Drafter (Agent C owns the Drafter in Stage 2) and Skill Router (Agent B owns) call `MemoryService.getMemory` — they need the interface frozen.
- **Verify:** `npx tsc --noEmit` passes with the new files.

---

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S1.1 — `[DEFECT D0.6]` PII redaction in trace**
- **What:** `src/agent/helper/redact.ts` — add `redactTracePayload(obj)` that walks the payload tree, applies key-based redaction recursively, and applies value-based redaction to `llmRawOutput` specifically. Keep `redactPII` untouched (it's used by Executor/Evaluator/Communicator for tool params/results).
- **Why:** Today `addTrace` stores `llmRawOutput` un-redacted; if the LLM echoes email/phone, PII lands in Redis + Mongo + SSE stream.
- **Coordinate with Agent A:** Agent A's `addTrace` in `agentLoop.ts` calls `redactTracePayload`. The function signature is the frozen contract: `redactTracePayload(payload: Record<string, unknown>): Record<string, unknown>`.
- **How:** Implement a recursive walker. For every string value under a key named `llmRawOutput`, apply value-based redaction (regex for email, phone, ssn, credit-card patterns) → `[REDACTED:email]` etc. For all other keys, keep the existing key-name-based behavior from `redactPII`.
- **Verify:** Send `me@example.com` in a prompt; inspect the Mongo `executionTrace` doc; assert the email is `***`-masked.

**D-S1.2 — `[GAP L2.3]` Health monitor branches on provider**
- **What:** `src/lib/llmHealthMonitor.ts` — branch the probe URL on `LLM_PROVIDER`:
  - `nvidia` → `https://integrate.api.nvidia.com/v1/models`
  - `google` → `https://generativelanguage.googleapis.com/v1beta/models`
  - unknown → return `unknown` status (don't probe a wrong URL).
- **Why:** Non-NVIDIA deployments probe against NVIDIA forever and report `unknown`.
- **Verify:** Set `LLM_PROVIDER=google` in test env; assert the probe hits the Google endpoint.

**D-S1.3 — Structured logger skeleton**
- **What:** Create `src/lib/logger.ts` exporting a thin pino adapter with `{userId, ticketId, persona, attempt, ms, status, model}` context fields. Behind an interface: `logInfo`, `logWarn`, `logError`. App Insights adapter is a stub (commented-out `applicationinsights` import — Stage 3 wires it via the `appinsights-instrumentation` skill).
- **Why:** Stage 3 will replace `console.*` calls in `agentLoop.ts` and `personas/*.ts` with this logger; the harness has to exist first. For Stage 1, no `console.*` calls are changed yet — that would touch Agent A's owned files.
- **Verify:** Import `logInfo` in a throwaway test; assert a JSON line is written to stdout with the context fields present.

**D-S1.4 — Stubbed eval runner skeleton (PR-gating prep)**
- **What:** `tests/agent/eval/stubRunner.ts` — wire the existing `__testRetryLLMOverride` hook in `llmClient.ts:376-388` into a Jest-style runner. Empty fixture set for Stage 1 — just the harness, no prompts yet. Create `tests/agent/eval/fixtures/` and `tests/agent/eval/reports/` with `.gitkeep`. Create `tests/agent/eval/negative-prompts.jsonl` as an empty file (Stage 2 will populate).
- **Why:** Stage 2 populates this with one golden prompt per new tool + negative prompts. The runner skeleton must be in CI by end of Stage 1.
- **Coordinate with Agent A:** Agent A's D0.1 chaos test calls `stubRunner.registerRow({...})`. The contract: `registerRow({ id, prompt, setup, llmOverride, assert })` — `llmOverride` is a function `(messages, tools) => { content: string, tool_calls?: any[] }` matching `__testRetryLLMOverride`'s expected shape.
- **Verify:** Add a single toy row (`id: "skeleton_smoke"`, prompt: "ping", assert: `state => true`); CI runs it; passes.

**D-S1.5 — Stage 1 docs patch (no code)**
- **What:** Update `.agents/Agent.md` §2 to add the new `CANCELLED` ticket status and `errorKind` field. Update `docs/agent/AGENT-OVERVIEW.md` §1.2 to mark defects D0.1–D0.10 as resolved. No code changes.
- **Why:** `agent_upgrade_v3.md` Definition of Done item 5 mandates a doc patch in every stage.
- **Verify:** Diff the doc; new content only; nothing removed.

---

### 1.4 Stage 1 — Integration & Verify Gate

After all 4 agents finish:

1. **Integration commit.** One coordinator pass runs `npx tsc --noEmit` to catch cross-agent shape mismatches (e.g., Agent B changed `MergeStats` but Agent A's reply renderer wasn't updated — should not happen given the contract sheet, but verify twice).
2. **Order of verification:**
   - `npx tsc --noEmit` (cross-file type errors).
   - `npm run lint` (style + unused-imports; Agent A and D both add files; each only imports from frozen contracts, so no lint duplication).
   - `npm run build` (Next.js production build — catches any Server/Client Component boundary issues with the new `abort/route.ts`).
   - `npm run agent:eval` — must pass against the existing 50-prompt golden set (Stage 1 doesn't change tool semantics; only fixes defects; eval regression must be zero).
   - Stubbed eval rows from Agents A and D run as a smoke (5 rows max).
3. **Stage 1 exit.** All four pass → check the contract sheet is committed and exported (`import type { ExecutionPlan } from "@/agent/pi/types"` resolves, etc.) → cut Stage 1 ship-tag.

### 1.5 Stage 1 — Why it's conflict-free (proof)

- **No two agents touch the same file.** Confirmed by the matrix in §1.2.
- **All cross-agent dependencies are via frozen contracts** (§0.3): `MergeStats` (B's `sandbox/types.ts`), `AgentCancelledError` (A's `types.ts`), `CANCELLED` enum value (C's `agentTicketModel.ts` via agreed field name), `redactTracePayload` (D's `redact.ts` via agreed signature), `stubRunner.registerRow` (D's `stubRunner.ts` via agreed API).
- **No "oh wait, I also need to edit `agentLoop.ts`" surprises.** Because Stage 1 was designed so that loop-state mutations (`agentLoop.ts`, `evaluator.ts`, `drafter.ts`, `prompts.ts`) are all in Agent A. Stage 2's loop volatile additions are also in Agent A — same owner for the same hot file across stages.
- **All new files are partitioned by subdirectory:**
  - `src/agent/pi/` → Agent A.
  - `src/agent/skills/` → Agent B.
  - `src/agent/memory/` → Agent C.
  - `tests/agent/eval/` → Agent D.

If two parallel agents actually attempt to write the same file (because a task description was ambiguous), the matrix wins: only the listed owner writes.

## Stage 2 — Capability Build-Out (Weeks 2–3)

### 2.1 Stage Goal

**Ship the full CRUD tool catalog (28 tools from spec §3.1), the Skills Registry with built-in skills, the Memory Service, and the per-skill `maxIterations` budget override.** After Stage 2, the agent can do *everything an authenticated user can do* (within the invariant set). The new PI multi-agent directory is **not** wired into production routes yet — Stage 3 does that via the legacy shim and the orchestrator. Stage 2 builds the parts the orchestrator will compose.

**Exit criteria.**
- Tool catalog has 28 tools (10 existing + 18 new across bundles B1–B6).
- All 6 built-in skills (`build_form`, `edit_form`, `delete_form_skill`, `filter_responses`, `generate_analytics_skill`, `manage_custom_views`) are in `registry.json` with `maxIterations` set.
- Memory Service persists: recurring form fields per user, skill-usage stats, recent failures; the Drafter reads them at ticket start.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass; one golden prompt per new tool + at least 10 negative prompts.

### 2.2 Stage 2 — File Ownership Matrix

The Stage 1 contract sheet makes Stage 2 substantially partitionable. The hot files shift: now `agentLoop.ts` (read-only shortcut handler + replan hook) is owned by **Agent A**; the `tools.ts` schema / `agentTools.ts` exec layer are owned by **Agent B**; all new Mongo models go to **Agent C**; `llmClient.ts` per-persona model is owned by **Agent D**. **No stage ever edits a file two agents own.**

A subtle conflict risk: the new `dashboard_stats`, `list_notifications`, `user_profile` reads all need helpers in `src/lib/agentTools.ts` (Agent B) AND might tempt you to add a Mongo query in `src/models/*` (Agent C). Rule: Agent B writes pure functions that accept an already-fetched Mongo document; Agent C is responsible for the Mongo aggregation pipelines + indexes + the read models (e.g., `dashboardModel.ts` is NEW and owned by Agent C). Agent B's `agentTools.ts` *imports* helpers from Agent C's `models/` and *calls* them, never edits them. The contract: functions exported by `src/models/*.ts` are read-only imports for Agent B.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` | **A** (read-only shortcut uses Skill Router; replan enforces per-skill `maxIterations`) |
| `src/agent/personas/drafter.ts` | **A** (multi-skill extraction; memory hydration at ticket start — calls `MemoryService.getMemory`) |
| `src/agent/personas/planner.ts` | **A** (refactor into Planner/Mixer — fills params into Skill Router templates) |
| `src/agent/personas/evaluator.ts` | **A** (negative-test mode + structured-bit checks) |
| `src/agent/personas/skillRouter.ts` | **A** (NEW — resolves Drafter skill name to `SkillDefinition`; built-in vs user override; rejects unknown) |
| `src/agent/pi/orchestrator.ts` | **A** (NEW skeleton — empty `execute()` method; Stage 3 fills it. Skeleton-only in Stage 2.) |
| `src/agent/pi/planner.ts` | **A** (NEW skeleton — empty `plan()` method; Stage 3 fills it) |
| `src/agent/pi/critic.ts` | **A** (NEW skeleton — empty `verify()` method; Stage 3 fills it) |
| `src/agent/pi/executors/base.ts` | **A** (NEW scaffold — abstract `ExecutorBase` class, no impls yet) |
| `src/agent/tools.ts` | **B** (add 18 new tool schemas in dependency-ordered bundles B1-B6) |
| `src/lib/agentTools.ts` | **B** (impl the 18 new read tools + helpers) |
| `src/agent/personas/executor.ts` | **B** (sandbox-queue the 12 new mutating tools) |
| `src/agent/sandbox/sandboxMerge.ts` | **B** (extend merge to CustomView updates/deletes + User profile/prefs/notifications + new user-safe-fields allowlist) |
| `src/agent/sandbox/types.ts` | **B** (extend `MergeStats`, add `MergeableKind` union) |
| `src/agent/policy/permissions.ts` | **B** (`TOOL_TO_SCOPE` for all 18 new tools; `ALLOWED_TOOLS` per scope; `USER_SAFE_FIELDS` allowlist) |
| `src/agent/permissions.json` | **B** (enable new tools under existing scopes; `destructive_actions` still default false for destructive ones) |
| `src/agent/skills/registry.json` | **B** (populate 6 built-in skills with `maxIterations`, `negativeTests`, `dryRunShape`) |
| `src/agent/skills/loader.ts` | **B** (load + cache built-ins; load user skills via `AgentSkillModel.find`) |
| `src/agent/skills/validator.ts` | **B** (NEW — Zod schema for `SkillDefinition`; `validateSkill(skill)` exported) |
| `src/agent/skills/types.ts` | **B** (extend `SkillDefinition` if needed — frozen contract preserved) |
| `src/agent/guidelines.md` | **B** (one entry per new tool: name, schema, scope, dry-run shape, owning skill) |
| `src/agent/personas/communicator.ts` | **B** (the merge reply renderer in `communicator.ts` reads `MergeStats` — wait, this is A's in Stage 1 and now B owns it in Stage 2. Actually no: A still owns `communicator.ts` via the "persona" team. See disambiguation below.) |
| `src/agent/personas/communicator.ts` | **A** (render merge reply with 6 counters; renderer that A introduced in Stage 1 continues — no shift in ownership) |
| `src/models/AgentSkillModel.ts` | **C** (NEW — user skills persistence; `(userId, name)` unique index; `version` field immutable on update) |
| `src/models/AgentMemoryModel.ts` | **C** (NEW — `userId`, `key`, `value: Mixed`, `confidence`, `lastUsedAt`; index on `(userId, key)`) |
| `src/models/AgentSkillUsageModel.ts` | **C** (NEW — `userId`, `skill`, `count`, `successRate`, `avgIterations`, `lastUsedAt`) |
| `src/models/AgentFailureModel.ts` | **C** (NEW — `userId`, `promptHash`, `lastError`, `count`, `lastAt`; TTL 30 d) |
| `src/models/dashboardModel.ts` (or extend existing) | **C** (NEW aggregation-only helper for `dashboard_stats` — pure functions, no schema) |
| `src/agent/memory/service.ts` | **C** (NEW — `MemoryService` concrete impl; `getMemory`, `setMemory`, `recordSkillUse`, `recordFailure`, `recentFailures`, `summarize`) |
| `src/agent/memory/compaction.ts` | **C** (NEW — `summarize(ticketId)` replaces completed-iteration results with digest; LRU cap on `sandbox.queryResults` (default 8)) |
| `src/agent/memory/pi_memory_agent.ts` | **C** (NEW skeleton — empty Memory Agent; Stage 3 fills vector store integration) |
| `src/lib/llmClient.ts` | **D** (L2.1 per-persona model + temperature via env overrides; L2.2 secondary provider fallback skeleton) |
| `src/agent/prompts/loader.ts` | **D** (attach per-persona model + temperature to prompt file JSON; loader already canonical) |
| `src/lib/costCalculator.ts` | **D** (NEW — pricing table lookup by model id; `priceFor(provider, model)` returns `{in, out}` per million tokens) |
| `src/lib/semanticCache.ts` (optional) | **D** (NEW — semantic cache skeleton only; not wired into live path) |
| `tests/agent/eval/golden-prompts.jsonl` | **D** (one prompt per new tool in bundles B1-B6) |
| `tests/agent/eval/negative-prompts.jsonl` | **D** (at least 10 negative prompts: try-mutate-response, cross-tenant-form-id, delete-when-destructive-disabled, abort-signal, etc.) |
| `tests/agent/eval/runner.ts` | **D** (assert `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`; on failure dump full `executionTrace` to report JSON) |
| `tests/agent/eval/stubRunner.ts` | **D** (extends Stage 1 harness with assertion fields above) |
| `tests/agent/eval/reports/<ISO>.json` | **D** (persisted JSON report per run; `diffReports.js` summary) |
| `src/components/ActionBar/AgentConfirmationModal.tsx` | **D** (Select-all / per-action checkboxes for selective merge — ref `agy_implementation_plan.md` Phase 2) |
| `src/components/ActionBar/SandboxPreviewModal.tsx` | **D** (NEW — mounts `FormRenderer` against sandboxed Redis schema; ref `agy_implementation_plan.md` Phase 2) |

> **Communicator.ts ownership disambiguation:** `communicator.ts` was Agent A's in Stage 1 (contiguous with the loop team rendering). Stage 2's only edit is the 6-counter merge reply renderer (the one that consumed Agent B's new `MergeStats` shape from Stage 1). The renderer is a presentation change in `agentLoop.ts`'s reply-construction block — but the **function** is in `communicator.ts`. So: **the merge renderer is in `agentLoop.ts`'s reply-construction site, owned by Agent A.** `communicator.ts` stays Agent A's. Agent B's `sandboxMerge.ts` returns `MergeStats`; Agent A reads it; done.

### 2.3 Stage 2 — Detailed Tasks per Agent

---

#### **Agent A — Core Loop & Orchestration**

**A-S2.1 — Skill Router**
- **What:** `src/agent/personas/skillRouter.ts` (NEW) — given `state.skill[]` (Drafter can now return multiple skills), resolve each against `Skills.loadSkillRegistry()` (Agent B's). For user-skill override: query `AgentSkillModel.find({ userId, name })` (Agent C's). Emit `actionPlan[]` by concatenating templates. Reject unknown skill names with `{ allowed: false, reason: "No skill template for X" }`.
- **Why:** Today the Planner invents the tool list per call (non-deterministic). Skills make multi-skill tickets first-class.
- **Coordinate:** Calls Agent B's `skills/loader.ts` and Agent C's `AgentSkillModel`. Frozen contract: `SkillDefinition.tools: ToolRef[]` where `ToolRef = { tool: string; paramsFrom: "requirements" | "memory" | "context" }`.
- **Verify:** A synthetic test: input `["build_form", "manage_custom_views"]`; assert the action plan has both `create_form` and `create_custom_view` steps.

**A-S2.2 — Planner refactor into Mixer**
- **What:** `src/agent/personas/planner.ts` — instead of inventing `actionPlan` from scratch, fill params into the Skill Router's templates. The LLM call still happens (for param generation), but on a much smaller prompt: given the matched skill's `requiredParams` + `optionalParams` + the user's `requirements`, fill each param.
- **Why:** Kills non-determinism; cuts Planner token cost ~50%.
- **Verify:** Planner output schema unchanged — `actionPlan: AgentAction[]` — but the actions now have `owningSkill: string` set.

**A-S2.3 — Read-only shortcut via Skill Router**
- **What:** `src/agent/personas/drafter.ts:216-242` — when `READ_ONLY_SKILLS.has(skill)`, route through Skill Router to pick the read tool instead of hardcoding the dispatch.
- **Why:** Decouples the read shortcut from the legacy hardcoded tool names. When a new read tool is added (B5 reads bundle), the shortcut works without Drafter edits.
- **Coordinate:** Calls Agent B's `skills/loader.ts`. No change to `agentLoop.ts` (the trace hook from Stage 1 already fires).
- **Verify:** Existing read prompts still produce a single LLM call; the trace shows the matched built-in skill's `skillId`.

**A-S2.4 — Per-skill `maxIterations` enforcement**
- **What:** `src/agent/agentLoop.ts` — at ticket start, resolve the skill → read `maxIterations` from `SkillDefinition`. Override the default `MAX_ITERATIONS=3` per skill (read=1, build=2-3, multi-skill=4). Check `state.retryCount < skill.maxIterations` on every retry.
- **Why:** Spec §4.2 defect — a 1-tool read and a 4-tool multi-skill build share the same budget today.
- **Verify:** Golden prompt for read skill completes in 1 iteration; multi-skill build allows 4.

**A-S2.5 — Drafter memory hydration**
- **What:** `src/agent/personas/drafter.ts` — at the top of `runDrafter`, call `MemoryService.getMemory(userId, "recurring_fields")` and `MemoryService.recentFailures(userId, 7d)`. Inject into `state.userContext`. Pre-fill recurring fields when building a new form (the Planner reads them from `state.userContext`).
- **Why:** Spec §5 — Drafter cannot recall "you always add an Email field" beyond the last 3 prompts today.
- **Coordinate:** Calls Agent C's `MemoryService`. Imported as `import { memoryService } from "@/agent/memory"` (Agent C owns the barrel).
- **Verify:** A 3-prompt sequence: build a contact form → build another contact form (assert Plan pre-fills Email) → "forget my contact template" (a tool Agent B ships) → build a contact form (assert Email NOT pre-filled).

**A-S2.6 — Evaluator negative-test mode + structured bits**
- **What:** `src/agent/personas/evaluator.ts` — add a pre-execution deterministic check pass that asserts structural bits from the matched skill's `negativeTests[]` (e.g., `actionPlan[0].params.elements.length >= 1`). Today the Evaluator only runs LLM-based QA after execution.
- **Why:** Spec §3.1 / §8 — the LLM-only evaluator produces false-positive `isComplete`.
- **Verify:** Negative prompt `build a contact form with no fields` → the deterministic check fails BEFORE the LLM Evaluator runs; reply says "the contact form must have at least one field".

**A-S2.7 — Communicator selective-merge reply renderer**
- **What:** `src/agent/agentLoop.ts` (the reply-rendering block, ~lines 336-339) — render `MergeStats` as 6 separate counters and surface the selective checkbox display via `AgentConfirmationModal.tsx` (Agent D owns the UI). Reply is still built in `agentLoop.ts` (Agent A).
- **Why:** Defect D0.4 and `agy_implementation_plan.md` Phase 2.
- **Verify:** Reply text shows "Forms created: 1, updated: 1, deleted: 1, views created: 0".

**A-S2.8 — PI multi-agent skeletons**
- **What:** `src/agent/pi/orchestrator.ts`, `src/agent/pi/planner.ts`, `src/agent/pi/critic.ts`, `src/agent/pi/executors/base.ts` — empty class scaffolds with the methods declared in the Stage-0 contract. NO real implementation in Stage 2 — Stage 3 fills them. The skeletons ensure `npx tsc --noEmit` passes against future imports.
- **Why:** Avoid last-minute type-tetris in Stage 3.
- **Verify:** Compile-check the new types under `import { PIOrchestrator } from "@/agent/pi/orchestrator"`.

---

#### **Agent B — Tools, Sandbox & Policy**

**B-S2.1 — Bundle B1: element ops**
- **What:** Add 4 tools to `src/agent/tools.ts`: `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements`. Impl in `src/lib/agentTools.ts` (read paths) and `src/agent/personas/executor.ts` (sandbox queue). All mutations route through sandbox; each declares `expectedUpdatedAt` and `agentIdempotencyKey`.
- **Why:** Spec §3.1 row 1 ("Form element") Today=Δ Target=full.
- **Coordinate:** Updates `TOOL_TO_SCOPE` in `permissions.ts` (Agent B) and `permissions.json` (Agent B). Adds one entry to `guidelines.md` (Agent B). Adds to `registry.json` built-in skill `edit_form` (Agent B).
- **Verify:** Golden prompt "add a Phone Number field to my Contact form" → sandbox has a new element; merge applies it; `expectedUpdatedAt` incremented cleanly.

**B-S2.2 — Bundle B2: form lifecycle**
- **What:** Add `set_form_status` and `update_form_metadata_settings` (ip/UA/geo/referrer flags) tools. Sandbox-merge extension in `sandboxMerge.ts`: handle a new `MergeableKind = "form_status" | "form_metadata"` that does `$set` on `Form.status` / `Form.metadataSettings` under the existing transaction.
- **Why:** Spec §3.1 rows 2–3.
- **Verify:** Golden prompt "pause my feedback form" + "track IP addresses on my feedback form" — both sandbox, merge, audit event written.

**B-S2.3 — Bundle B3: user/account**
- **What:** Add `update_user_profile`, `update_user_preferences`, `update_notification_settings`. Merge extends to `User.updateOne({_id: userId}, {$set: ...})` under the transaction with the `USER_SAFE_FIELDS` allowlist (no `password`, `email`, `isGoogleAuth`, `isAdmin`, `verify*` fields).
- **Why:** Spec §3.1 rows 11-13.
- **Verify:** Negative prompt "update my password via agent" → blocked at the merge layer with "cannot touch auth-related fields".

**B-S2.4 — Bundle B4: notifications**
- **What:** Add `list_notifications`, `mark_notification_read`, `clear_notification`. Notifications are reversible → direct write gated by a strong audit event; **not** through the 24h sandbox. Document in `guidelines.md` that this is the explicit exemption from sandbox required by spec §3.1.
- **Why:** Spec §3.1 rows 9-10; "mark read" is reversible enough to skip the user-confirmation gate.
- **Verify:** Golden prompt "mark my last notification as read" → no merge modal pops; direct write; audit event written.

**B-S2.5 — Bundle B5: reads**
- **What:** Add `dashboard_stats`, `list_agent_audit_events`, `list_agent_tickets`. Aggregation pipelines live in Agent C's `src/models/dashboardModel.ts` etc.; Agent B's `agentTools.ts` calls them and shapes the LLM-readable result.
- **Coordinate:** Imports from Agent C's `models/`. Frozen contract: `getDashboardStats(userId): Promise<DashboardStats>` shape defined in `src/models/dashboardModel.ts` (Agent C owns the type and the impl).
- **Why:** Spec §3.1 rows 4, 13, 14.
- **Verify:** Golden prompt "show my dashboard stats" → returns metrics without LLM token spend (read shortcut).

**B-S2.6 — Bundle B6: exports**
- **What:** Add `export_form` (csv/json/pdf) returning a server-signed short-lived URL (NOT inlining the payload — would blow the SSE stream budget). URL has 5-min TTL signed via `crypto.createHmac`.
- **Why:** Spec §3.1 row 12.
- **Verify:** Negative prompt "give me the raw CSV bytes in the chat" → deny with "exports are URL-based"; positive prompt returns a signed URL.

**B-S2.7 — Skills Registry population**
- **What:** `src/agent/skills/registry.json` — populate the 6 built-in skills with full bodies:
  - `build_form` (tools: `create_form`, `maxIterations: 2`, `negativeTests: [{assert: "actionPlan[0].params.elements.length >= 1"}]`)
  - `edit_form` (tools: `update_form`, `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements`, `set_form_status`, `update_form_metadata_settings`; `maxIterations: 3`)
  - `delete_form_skill` (tools: `delete_form`; `destructive`; `maxIterations: 1`)
  - `filter_responses` (tools: `query_responses`; `maxIterations: 1`)
  - `generate_analytics_skill` (tools: `generate_analytics`, `dashboard_stats`; `maxIterations: 1`)
  - `manage_custom_views` (tools: `create_custom_view`, `update_custom_view`, `delete_custom_view`, `get_custom_views`; `maxIterations: 2`)
- **Why:** Spec §6 — first-class versioned artifacts replace free-text `skills.md`.
- **Verify:** `npm run agent:validate-skills` (NEW, part of `skills/loader.ts`) loads and Zod-validates every skill. Stage 2 introduces this script.

**B-S2.8 — Sand-box merge extension**
- **What:** `src/agent/sandbox/sandboxMerge.ts` extends to CustomView updates/deletes and User profile/prefs. Add a `MergeableKind` union (`"form_create" | "form_update" | "form_delete" | "view_create" | "view_update" | "view_delete" | "user_update" | "form_status" | "form_metadata"`). Each kind has its own apply function under the shared Mongo transaction.
- **Why:** Spec §10 blast radius — "extend merge to CustomView updates/deletes + User profile".
- **Verify:** Unit-test each kind against a fixture sandbox with the right `expectedUpdatedAt` and idempotency; assert atomicity (all-or-nothing) for the new kinds.

**B-S2.9 — `USER_SAFE_FIELDS` allowlist**
- **What:** In `sandboxMerge.ts`, before applying a `user_update` kind, intersect the patch keys with `USER_SAFE_FIELDS = ["name", "country", "language", "theme", "dateFormat", "timeFormat", "notificationSettings"]`. Reject anything else with a `UserUnsafeFieldError`.
- **Why:** Spec §3.1 and the "soft-lock their own account" risk noted in the upgrade plan.
- **Verify:** Negative prompt "set my isAdmin to true via agent" → deny.

---

#### **Agent C — Memory, Models & Persistence**

**C-S2.1 — `AgentSkillModel`**
- **What:** `src/models/AgentSkillModel.ts` — `userId`, `name` (unique per user), `version`, `definition: SkillDefinition`, `createdAt`, `updatedAt`. Version is immutable on edit — edits create a new version row.
- **Why:** Stage 3's Skill Author persona writes here; Stage 2's Skill Router reads here.
- **Coordinate:** Frozen contract — `SkillDefinition` shape (Agent B's `src/agent/skills/types.ts`).
- **Verify:** Insert 2 versions of the same skill name; assert both rows exist with different `version`.

**C-S2.2 — `AgentMemoryModel`**
- **What:** `src/models/AgentMemoryModel.ts` — `userId`, `key`, `value: Mixed`, `confidence` (0-1), `lastUsedAt`. Compounded index `(userId, key)`.
- **Why:** Long-term recurring-field memory for the Drafter.
- **Verify:** Insert `(u1, "recurring_fields", [...], 0.3)`. `find({userId, key}).sort({lastUsedAt:-1})` returns it.

**C-S2.3 — `AgentSkillUsageModel`**
- **What:** `src/models/AgentSkillUsageModel.ts` — `userId`, `skill`, `count`, `successRate`, `avgIterations`, `lastUsedAt`.
- **Why:** Skill Router improvements (Stage 3) read this for routingpriority.
- **Verify:** 5 inserts; aggregation returns the most-used skill.

**C-S2.4 — `AgentFailureModel`**
- **What:** `src/models/AgentFailureModel.ts` — `userId`, `promptHash`, `lastError`, `count`, `lastAt`. TTL index `30 * 24 * 3600` (30 d).
- **Why:** Drafter reads `recentFailures(userId, 7d)` at ticket start to pre-empt ambiguity.

**C-S2.5 — `MemoryService` impl**
- **What:** `src/agent/memory/service.ts` — concrete impl of the `MemoryService` interface frozen in Stage 1. Methods: `getMemory`, `setMemory` (upsert + confidence bump, max 0.9), `recordSkillUse`, `recordFailure`, `recentFailures`, `summarize`. `setMemory` Zod-validates the value (primitives / known shapes) and runs `redactPII` before persistence.
- **Why:** The Drafter's hydration in A-S2.5 depends on it.
- **Coordinate:** Imports `MemoryService` from `src/agent/memory/types.ts` (Stage 1 frozen). Uses `redactPII` from Agent D's helper. Frozen contract: `memoryService` singleton exported from `src/agent/memory/index.ts`.
- **Verify:** Round-trip test: `setMemory(u, "k", {...}, {confidence:0.3})`, `getMemory(u, "k")` returns it; second `setMemory` bumps confidence to 0.4; injected email is masked.

**C-S2.6 — Memory compaction**
- **What:** `src/agent/memory/compaction.ts` — `summarize(ticketId): Promise<string>` replaces each completed-iteration's raw `sandbox.queryResults` entry with a one-line digest the Evaluator reads on retries. LRU cap on `sandbox.queryResults` (default 8) — older evicted to Mongo `AgentTicket.executionTrace`.
- **Why:** Spec §5.3 — tickets resumed many times accumulate unbounded sandbox + trace.
- **Verify:** Force 12 read results into a sandbox; call `summarize`; assert the oldest 4 are evicted, and the digest is the only remaining entry per pre-summary slot.

**C-S2.7 — Dashboard aggregation helper**
- **What:** `src/models/dashboardModel.ts` — pure aggregation functions: `getDashboardStats(userId)`, `getFormListStats(userId)`. No schema — read-only aggregations over `Form`, `Response`, `CustomView`.
- **Why:** Agent B's `dashboard_stats` tool needs a Mongo-side aggregation it can just call. Keeping the pipeline in a model file (Agent C) keeps all MongoDB query logic in one team's ownership.
- **Coordinate:** Frozen contract — exported function signatures and return shapes.
- **Verify:** Insert 3 forms + 50 responses; `getDashboardStats` returns correct totals.

**C-S2.8 — PI Memory Agent skeleton**
- **What:** `src/agent/memory/pi_memory_agent.ts` — empty `MemoryAgent` class with declared methods (`storeEpisodic`, `retrieveEpisodic`, `getUserPreferences`, `storeSemantic`, `searchSemantic`, `assembleContext`). Vector DB integration lands in Stage 3.
- **Why:** Stage 3 skeleton wiring depends on this existing.

---

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S2.1 — `[GAP L2.1]` Per-persona model + temperature**
- **What:** `src/lib/llmClient.ts` — read `LLM_MODEL_DRAFTER`, `LLM_MODEL_PLANNER`, `LLM_MODEL_EVALUATOR`, `LLM_MODEL_COMMUNICATOR` from env (default to `LLM_MODEL`). Per-persona temperature constants in the persona files imported by `llmClient.ts` (Agent A owns the persona files; Agent D owns `llmClient.ts`). Resolve: pass temperature through the existing `callLLM` options arg.
- **Why:** Spec §7.
- **Coordinate:** Persona temperature constants are data, not code logic. Agent D defines `PERSONA_TEMPERATURES: Record<Persona, number>` in `llmClient.ts`. Persona files pass `persona` through; Agent A's persona files call `callLLM({persona, ...})` (no Agent A change needed — the existing `callLLM` signature gets an optional `persona` field).
- **Verify:** Set `LLM_MODEL_DRAFTER=foo`, mock `callLLM`; assert the request hit model `foo`.

**D-S2.2 — `[GAP L2.2]` Secondary provider fallback**
- **What:** `src/lib/llmClient.ts` — wrap the LLM call in `callOnceWithFallback`: on `LLMOfflineError` from primary, transparently retry once against `LLM_FALLBACK_*` config. Reset the secondary call's usage into `AgentUsage` (Agent C owns the model) with the fallback model for cost attribution.
- **Coordinate:** Imports `AgentUsage.create` (Agent C's model). Frozen contract: `recordAgentUsage({ ticketId, userId, persona, model, promptTokens, completionTokens, totalTokens, costUsd, latencyMs })` exported from `agentUsageModel.ts` — Agent C implements the function, Agent D calls it.
- **Verify:** Stub test: primary throws `LLMOfflineError`, fallback returns OK; assert result + `AgentUsage` row is attributed to the fallback model.

**D-S2.3 — `[GAP L2.4]` Pino logger wiring in non-`agentLoop` paths**
- **What:** Replace `console.warn` / `console.error` in `src/lib/agentTools.ts` (wait — Agent B owns that) — defer. Actually: Agent D only replaces `console.*` in `src/lib/llmClient.ts` and `src/lib/llmHealthMonitor.ts` (both owned by D). Full `agentLoop.ts`/persons `console.*` replacement lives in Stage 3 (still Agent D in Stage 3, but `agentLoop.ts` is Agent A's, so the cross-agent swap is a SINGLE choreographed transfer — §3.4 covers this. Stage 2 keeps Agent D's logging scope to `src/lib/*`).
- **Verify:** A live prompt; capture one pino line per LLM call with `{userId, ticketId, persona, model, ms, status}`.

**D-S2.4 — Eval: golden prompts expansion**
- **What:** `tests/agent/eval/golden-prompts.jsonl` — add one row per new tool in bundles B1-B6 (18 prompts). Schema extended with `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`. `runner.ts` asserts them.
- **Coordinate:** Agent B's new tools must exist before the prompts can pass. Stage 2 integration test ordering: Agent B's tools merge first, then Agent D's eval runs.
- **Verify:** `npm run agent:eval — --live` detects a regression when any new tool's params change.

**D-S2.5 — Eval: negative prompts**
- **What:** `tests/agent/eval/negative-prompts.jsonl` + assertion in `runner.ts` — at least 10 negative prompts: (1) attempt to mutate a `Response`; (2) cross-tenant form-id; (3) attempt to delete a form when `destructive_actions=false`; (4) abort signal fires; (5) loop deadline expires; (6) attempt to set `isAdmin=true` via agent; (7) attempt to read another user's notifications; (8) attempt to read raw CSV bytes in chat (must return URL); (9) skill with bad `requiredTools` (allowed-list violation); (10) `update_user_profile` touching auth field.
- **Why:** Spec §8 / §11 — negative suite gates the invariants.
- **Verify:** Each negative prompt fails with the expected deny message and `isComplete=false`.

**D-S2.6 — Eval: report history + branch coverage**
- **What:** `tests/agent/eval/reports/<ISO>.json` — run-end JSON report. `tests/agent/eval/diffReports.js` — quick diff of pass-rate, regressions, new failures vs previous. Tag each golden prompt with `branches: string[]` (e.g., `["drafter.vague", "evaluator.retry"]`); runner emits `% branches hit` summary.
- **Verify:** Two consecutive runs produce a diff report with empty regressions.

**D-S2.7 — Selective-merge UI**
- **What:** `src/components/ActionBar/AgentConfirmationModal.tsx` — add per-action checkboxes (one per sandbox action); a "Select all / none" master checkbox; merge carries ONLY selected actions. The backend supports selective merge by virtue of Agent B's `MergeableKind` union (each kind is independently apply-able).
- **Coordinate:** The frontend POSTs the array of selected `actionId`s. `agentLoop.ts` resume path (Agent A) reads `mergeApprovedActionIds`; passes to `sandboxMerge.ts` (Agent B) which skips unselected ones. This is a THREE-touch coordination. To save the conflict, **Agent A's resume-path edit is a one-line passthrough**; **Agent B's `sandboxMerge.ts` filters by `mergeApprovedActionIds` before applying**; **Agent D's UI sends the array**. Frozen contract: `MergeRequest = { ticketId, userId, mergeApprovedActionIds: string[] }` defined in `src/agent/sandbox/types.ts` (Agent B owns).
- **Verify:** UI checkbox flow; sandbox with 3 actions; check 2; merge has 2 applied, 1 discarded.

**D-S2.8 — Sandbox preview modal (NEW)**
- **What:** `src/components/ActionBar/SandboxPreviewModal.tsx` — mounts the `FormRenderer` against the sandboxed Redis schema. The sandbox schema is fetched via a new read path (Agent B's `agentTools.ts` — fetchSandboxPreview). Test validations, fill dummy data, preview responsive layouts before merging.
- **Coordinate:** Agent B adds `getSandboxPreview(ticketId)` to `agentTools.ts`. Frozen contract: returns `{ elements, name, description }` (form shape) without writing to prod.
- **Verify:** Open preview against a 3-field sandbox draft; render shows 3 fields; close doesn't merge.

**D-S2.9 — Stage 2 docs patch**
- **What:** `.agents/Agent.md` §2 — add new permission scopes (`skill_authoring`, `bulk_operations`, `system_admin`, `integration_management`, `agent_audit`); add new tool list; add selective-merge section.
- **Verify:** Reflects the shipped state; no orphaned passages.

---

### 2.4 Stage 2 — Integration & Verify Gate

1. **Integration commit order.**
   - Agent C models first (`AgentSkillModel`, `AgentMemoryModel`, `AgentSkillUsageModel`, `AgentFailureModel`, `dashboardModel`).
   - Agent B tools + skills registry + policy next.
   - Agent A personas + loop next (depends on B's registry + C's memory).
   - Agent D eval + llmClient + UI last (depends on the rest).
2. **Verify.** `tsc`, `lint`, `build`, `agent:eval` all pass; `agent:validate-skills` passes; negative-prompt suite fails every negative prompt with the expected deny class.
3. **Stage 2 exit.** All four pass + eval report shows `0 regressions`. Defects D0.x from Stage 1 still pass.

### 2.5 Stage 2 — Why it's conflict-free (proof)

- `agentLoop.ts`: only Agent A.
- `communicator.ts`, `drafter.ts`, `planner.ts`, `evaluator.ts`, `skillRouter.ts`: only Agent A.
- `tools.ts`, `agentTools.ts`, `permissions.ts`, `permissions.json`, `guidelines.md`, `sandboxMerge.ts`, `sandbox/types.ts`: only Agent B.
- `agentTicketModel.ts`, `agentSkillModel.ts` (NEW), `agentMemoryModel.ts` (NEW), `agentSkillUsageModel.ts` (NEW), `agentFailureModel.ts` (NEW), `dashboardModel.ts` (NEW), `agentUsageModel.ts`, `memory/service.ts` (NEW), `memory/compaction.ts` (NEW), `memory/pi_memory_agent.ts` (NEW): only Agent C.
- `llmClient.ts`, `llmHealthMonitor.ts`, `logger.ts`, `costCalculator.ts` (NEW), `prompts/loader.ts`, `eval/*`: only Agent D.
- UI components `AgentConfirmationModal.tsx`, `SandboxPreviewModal.tsx`: only Agent D.
- All PI skeletons `src/agent/pi/**`: only Agent A.
- All skills files `src/agent/skills/**`: only Agent B.
- All memory files `src/agent/memory/**` (incl. `service.ts`, `compaction.ts`, `pi_memory_agent.ts`, `index.ts`): only Agent C. (`memory/types.ts` was committed in Stage 1 and not modified in Stage 2 — frozen.)

## Stage 3 — PI Multi-Agent Wiring + Hardening (Weeks 4+)

### 3.1 Stage Goal

**Wire the PI multi-agent system into production via the legacy shim, complete the per-persona streaming Communicator, replace `console.*` with pino across the full agent tree, ship the Skill Author persona, deterministic replay, and complete the observability + eval + docs surface.** After Stage 3, the v3 Definition of Done (`agent_spec.md` §11) items 1–9 pass, and the PI orchestrator can execute multi-task DAGs alongside (and reachable from) the legacy loop.

**Exit criteria.**
- `PIOrchestrator.execute()` produces the full event stream (plan → task → tool → verify → awaiting_approval → completed) for a multi-form prompt.
- Legacy `runAgentLoop` consumers can route to PI via `LegacyAgentShim.runAgentLoop` with no caller-side change.
- Communicator streams tokens via SSE end-to-end.
- Skill Author persona: user can author/edit/delete a skill through the agent; the skill is immediately usable by the Skill Router.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run agent:eval` all pass; stubbed unit eval is PR-gating in CI; live eval is nightly.

### 3.2 Stage 3 — File Ownership Matrix

Stage 3's conflict risk concentrates on three choreographed swaps:
1. **`console.*` → pino across the agent tree** — Agent D owns `logger.ts` but the `console.*` calls live in Agent A's `agentLoop.ts` and persona files. Solution: Agent D ships the logger refactor as a PR to **only `src/lib/*` files it owns**; Agent A performs the **single** `console.*`-to-`logInfo` swap inside `agentLoop.ts` + persona files in this stage.
2. **PI orchestrator wiring** — Agent A owns `src/agent/pi/**` entirely in this stage (skeletons from Stage 2 are filled with real impl).
3. **Legacy shim** — Agent A owns it; the legacy `runAgentLoop` continues to run by default, with a feature flag `PI_AGENT_ENABLED` routing new tickets through the shim.

| File | Owner |
|---|:---:|
| `src/agent/agentLoop.ts` (console→pino + flag-routing) | **A** |
| `src/agent/personas/*.ts` (console→pino + communicator streaming) | **A** |
| `src/agent/pi/orchestrator.ts` (full impl) | **A** |
| `src/agent/pi/planner.ts` (full impl) | **A** |
| `src/agent/pi/critic.ts` (full impl) | **A** |
| `src/agent/pi/executors/base.ts`, `forms.ts`, `responses.ts`, `views.ts`, `generic.ts` | **A** |
| `src/agent/pi/sandbox.ts` (per-execution sandbox wrapper) | **A** |
| `src/agent/pi/lock.ts` (per-execution lock) | **A** |
| `src/agent/pi/budget.ts` (per-tool budget tracker) | **A** |
| `src/agent/pi/audit.ts` (structured audit w/ rationale) | **A** |
| `src/agent/pi/legacy_shim.ts` (NEW — wraps PI as legacy interface) | **A** |
| `src/agent/pi/replay.ts` (NEW — deterministic replay) | **A** |
| `src/agent/pi/visualize.ts` (NEW — Mermaid DAG generator) | **A** |
| `src/agent/personas/skillAuthor.ts` (NEW — off-loop Skill Author persona) | **A** |
| `src/agent/skills/skillAuthorClient.ts` | **B** |
| `src/agent/skills/registry.json` (user-skill override test) | **B** |
| `src/agent/skills/loader.ts` (user-skill find middleware) | **B** |
| `src/agent/skills/validator.ts` (sandbox-test for new skills) | **B** |
| `src/agent/skills/types.ts` (extend if needed) | **B** |
| `src/agent/policy/permissions.ts` (skill_authoring SCOPE gating) | **B** |
| `src/agent/permissions.json` (`skill_authoring` default false) | **B** |
| `src/agent/personas/executor.ts` (skill-sandbox guarded tool dispatch) | **B** |
| `src/agent/sandbox/sandboxMerge.ts` (extended with skill-sandbox allow-list merge) | **B** |
| `src/lib/agentTools.ts` (link_google_sheet skeleton — P4 placeholder) | **B** |
| `src/models/AgentSkillModel.ts` (versioning + soft-delete support) | **C** |
| `src/models/PiExecutionModel.ts` (NEW — `PIExecutionState` persistence) | **C** |
| `src/models/PiCheckpointModel.ts` (NEW — checkpoint snapshots for replay) | **C** |
| `src/models/PiAuditLogModel.ts` (NEW — `AgentAuditEntry` with `rationale`) | **C** |
| `src/agent/memory/service.ts` (vector-search skeleton; Mongo Atlas) | **C** |
| `src/agent/memory/vector.ts` (NEW — vector store adapter) | **C** |
| `src/agent/memory/preferences.ts` (NEW — implicit preference learning) | **C** |
| `src/agent/memory/procedural.ts` (NEW — pattern → skill proposals) | **C** |
| `src/agent/memory/context.ts` (NEW — context assembly for prompts) | **C** |
| `src/lib/llmClient.ts` (Communicator `stream:true` wiring) | **D** |
| `src/lib/logger.ts` (agent-tree-wide logger helper, named loggers) | **D** |
| `src/lib/semanticCache.ts` (semantic cache wiring — opt-in) | **D** |
| `src/lib/costCalculator.ts` (provider rate card accounting) | **D** |
| `tests/agent/eval/stubRunner.ts` (PR-gating wire-in) | **D** |
| `tests/agent/eval/runner.ts` (nightly live wire-in) | **D** |
| `tests/agent/pi/` (NEW — PI integration suite) | **D** (automated golden scripts only; no shared code with Agent A's PI impl) |
| `tests/agent/pi/load_test_pi_agent.ts` | **D** |
| `src/app/api/pi-agent/execute/route.ts` (NEW — SSE streaming) | **D** |
| `src/app/api/pi-agent/skills/route.ts` (NEW — CRUD) | **D** |
| `src/app/api/pi-agent/executions/[id]/route.ts` (NEW — state read) | **D** |
| `src/app/api/pi-agent/executions/[id]/resume/route.ts` (NEW — resume) | **D** |
| `src/app/api/pi-agent/executions/[id]/approve/route.ts` (NEW — merge approval) | **D** |
| `src/app/api/pi-agent/memory/search/route.ts` (NEW — semantic search) | **D** |
| `src/components/AgentSidebarDrawer.tsx` (UX for new tool kinds) | **D** |
| `src/components/AgentSkillsDrawer.tsx` (NEW — skill management surface) | **D** |
| `src/components/AgentVisualizer.tsx` (typed SSE heartbeats) | **D** |
| `src/components/ActionBar/SandboxPreviewModal.tsx` (ghost-field preview polish) | **D** |
| `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md` | **D** |
| `docs/agent/AGENT-OVERVIEW.md` | **D** |
| `docs/pi-agent/` (NEW — runbooks + architecture) | **D** |


### 3.3 Stage 3 — Detailed Tasks per Agent

---

#### **Agent A — Core Loop & Orchestration**

**A-S3.1 — `console.*` → pino in `agentLoop.ts` + persona files**
- **What:** Replace every `console.log` / `console.warn` in `src/agent/agentLoop.ts` and `src/agent/personas/*.ts` with `logInfo` / `logWarn` / `logError` from Agent D's `src/lib/logger.ts`. Threading the per-turn context (`{userId, ticketId, persona, attempt, ms, status, model}`) via the logger's child binding.
- **Why:** `agent_upgrade_v3.md` L2.4 — production observability currently means grepping stdout.
- **Coordinate:** Imports `logInfo`, `logWarn`, `logError` from `@/lib/logger` (Agent D's interface from Stage 1; Stage 3 just consumes it). Method signature already frozen in Stage 1.
- **Verify:** Run a prompt end-to-end; one JSON log line per persona transition with the context pair present.

**A-S3.2 — Communicator streaming end-to-end**
- **What:** `src/agent/personas/communicator.ts` — set `stream: true` on the LLM call. Route each token delta as `{type:"token", persona, delta}` into the SSE stream. Drafter/Planner/Evaluator stay non-stream (their JSON contracts need the full body). The `thoughtProcess` extraction at `llmClient.ts:272-301` is in Agent D's owned file — Agent A only consumes a new `callLLMStream` helper exposed by Agent D.
- **Coordinate:** Agent D exports `callLLMStream(opts, onChunk)` from `llmClient.ts`. Agent A's `communicator.ts` calls it. Frozen contract: `callLLMStream(opts: { persona, messages, tools? }, onChunk: (delta: string) => void): Promise<LLMResult>`.
- **Verify:** Live golden prompt for Communicator: assert SSE stream emits at least one `stream_chunk` event before `[DONE]`.

**A-S3.3 — `PIOrchestrator.execute()` full impl**
- **What:** `src/agent/pi/orchestrator.ts` — the loop from `pi_agent_upgrade_v3.md` §4.3: acquire per-execution lock `pi_lock:{executionId}` → budget pre-flight → memory context assembly → PLAN → CRITIC pre-flight → EXECUTE topologically → CRITIC post-flight → AWAITING_USER_APPROVAL → MERGE → LEARN (memory indexing) → RESPOND.
- **Why:** The legacy loop is single-threaded linear; PI enables DAG parallelism (Spec §1 scope control + Spec §3 multi-agent).
- **Coordinate:** Calls Agent B's `Skills.loadSkillRegistry` / `sandboxMerge`, Agent C's `MemoryService.assembleContext`, Agent D's `callLLM`/`callLLMStream`, Agent A's own `PlannerAgent/CriticAgent/ExecutorAgent`. All contracts frozen in Stages 1–2.
- **Verify:** E2E test: prompt "build two onboarding forms and link them via a custom view" → trace shows parallel `pi_executor_forms` tasks + `pi_executor_views` after both finish.

**A-S3.4 — `PlannerAgent` DAG impl**
- **What:** `src/agent/pi/planner.ts` — emit `ExecutionPlan` with `TaskNode[]` + `TaskEdge[]` (dependency + conditional). Conditional edges use `result.count > 100` style predicates (code-evaluated, not LLM-evaluated — per `inspiration_breakdown.md` §2 "Routers are code, never models").
- **Verify:** Test: prompt → generate plan → assert topological sort + a conditional edge.

**A-S3.5 — `CriticAgent` pre-flight + post-flight impl**
- **What:** `src/agent/pi/critic.ts` — pre-flight: schema-validate the plan, scan for tool-hallucination (any tool not in `ALLOWED_TOOLS`), scan for cross-tenant form-id. Post-flight: deterministic bit-checks (negative tests) + LLM-based adversarial red-team. Emit `CriticVerdict`.
- **Verify:** Negative prompt that injects a `tool: "delete_all_users"` → critic returns `verdict: "fail"`, plan aborted.

**A-S3.6 — Domain-specialized executors**
- **What:** `src/agent/pi/executors/base.ts` (abstract base with `execute(task) → TaskResult`), `forms.ts`, `responses.ts`, `views.ts`, `generic.ts` — each owns a strict subset of the tool catalog (ref `pi_agent_spec.md` Appendix A). Tool allow-list per executor enforced at the dispatcher.
- **Verify:** Try to call `pi_executor_responses` with `tool: "create_form"` → dispatcher returns `false`.

**A-S3.7 — Per-execution lock + sandbox wrapper**
- **What:** `src/agent/pi/lock.ts` `acquireExecutionLock(executionId, userId)` keyed on `pi_lock:{executionId}` — independent of the legacy `agent_lock:{userId}` so concurrent PI executions per user work. `src/agent/pi/sandbox.ts` is the per-execution Redis sandbox wrapper — `sandbox:{executionId}` namespacing.
- **Verify:** Two PI executions for the same user run in parallel; no lock collision.

**A-S3.8 — Budget tracker + audit**
- **What:** `src/agent/pi/budget.ts` — enforce at tool-call granularity (per-execution, per-task, per-user-day). Throws `BudgetExceededError` mid-execution; orchestrator routes to `handleFailurePartial` that checkpoints state + returns `status: "partial"`. `src/agent/pi/audit.ts` — every LLM call logged with `{input, output, reasoning, ts}` into `PiAuditLogModel` (Agent C's).
- **Verify:** Stub a tool call that would exceed budget → `BudgetExceededError` thrown mid-loop, ticket persisted as `partial`, lock released.

**A-S3.9 — Legacy shim**
- **What:** `src/agent/pi/legacy_shim.ts` `LegacyAgentShim.runAgentLoop(...)` — calls `PIOrchestrator.execute()` under the hood, converts legacy `AgentState`↔`PIExecutionState`. The existing route handler at `src/app/api/agent/execute/route.ts` (Agent A owns in Stage 3 too, inheriting from Stage 1) reads `process.env.PI_AGENT_ENABLED`; if true, routes new tickets via the shim; otherwise the legacy `runAgentLoop` runs unchanged.
- **Verify:** Set `PI_AGENT_ENABLED=true`; submit a creating-form prompt; assert the trace shows `pi_orchestrator` + `pi_planner` + `pi_executor_forms` personas (not the legacy 5); ticket status flow ends in `RESOLVED`/`AWAITING_USER_APPROVAL` matching the legacy contract.

**A-S3.10 — Deterministic replay + Mermaid visualization**
- **What:** `src/agent/pi/replay.ts` — `replayFromCheckpoint(executionId, checkpointId)` reconstructs the sandbox + memory state via Agent C's `PiCheckpointModel`, re-runs the plan from that point. `src/agent/pi/visualize.ts` — `generateMermaid(plan)` outputs a `graph TD` Mermaid block of the DAG for the admin dashboard.
- **Verify:** Run a 3-task execution to completion; replay from each checkpoint; assert the downstream task results match.

**A-S3.11 — Skill Author persona**
- **What:** `src/agent/personas/skillAuthor.ts` — off-loop persona. User says "remember this contact-form template as 'weekly_pulse'" → agent generates a `SkillDefinition`, validates via `Skills.validate` (Agent B), stores via `MemoryService` indexing in Agent C, persists via `AgentSkillModel` in Agent C, records an `AgentAuditEvent`.
- **Verify:** Prompt → creates a user skill → next prompt "build a weekly_pulse form" → Skill Router finds and uses it.

---

#### **Agent B — Tools, Sandbox & Policy**

**B-S3.1 — Skill sandbox guarded dispatch**
- **What:** `src/agent/personas/executor.ts` — when a Skill Router returns a user-skill, the executor checks the skill's declared `requiredTools` against the user's `ALLOWED_TOOLS` (current permissions) AND the skill's own sandbox allow-list. Reject out-of-allowlist tool calls.
- **Why:** Spec §6 / Hard Invariant 12 — synthesized skills cannot access tools outside their declared list.
- **Verify:** Synthesize a skill declaring `requiredTools: ["delete_form"]`; user with `destructive_actions=false` → call denied.

**B-S3.2 — Skill validator sandbox-test**
- **What:** `src/agent/skills/validator.ts` `sandboxTest(skillDef)` — runs the skill against a throwaway sandbox id and a stubbed LLM, asserts the result shape matches `outputSchema`. Adds `--validate-skills` to `npm run agent:validate-skills` (script entry in `package.json`).
- **Verify:** Inject a malformed skill; `npm run agent:validate-skills` exits non-zero.

**B-S3.3 — Skill merge extension**
- **What:** `src/agent/sandbox/sandboxMerge.ts` — when the Skill Author persona creates a skill, the merge engine applies user-skill writes (vs. the user's `skill_authoring` scope flag) to `AgentSkillModel` under a Mongo transaction (Agent C's model) with idempotency.
- **Why:** Skill persistence is a mutating action → must go through sandbox → merge like any other mutation (Spec §9).
- **Verify:** The skill create queue hits sandbox; merge confirms; audit event emitted.

**B-S3.4 — `link_google_sheet` skeleton (P4 placeholder)**
- **What:** `src/lib/agentTools.ts` — add `link_google_sheet`, `sync_to_sheet`, `unlink_google_sheet` as gated-off scopes (`integration_management`, default false). Skeleton bodies that throw `NotImplementedError` until P4 Phase.
- **Why:** Spec §3.1 rows 38; placeholder keeps the API surface stable for downstream doc/UI work.
- **Verify:** Tool registered; calling it returns NotImplementedError; not in `ALLOWED_TOOLS` for default users.

**B-S3.5 — `guidelines.md` + `skills.md` sync (final)**
- **What:** Complete the spec's mandate: `guidelines.md` has one entry per tool (full 28-tool + skill-authoring tools + external integration stubs). `skills.md` is now a soft deprecation pointer to `src/agent/skills/registry.json` for built-ins and `AgentSkillModel` for user skills.
- **Verify:** Document-style review against `agent_spec.md` §3.1.

---

#### **Agent C — Memory, Models & Persistence**

**C-S3.1 — `PiExecutionModel`**
- **What:** `src/models/PiExecutionModel.ts` — persists `PIExecutionState`. Fields: `executionId` (uuid), `userId`, `sessionId`, `status` planning/executing/verifying/awaiting_approval/completed/failed/partial/cancelled, `rootPlan` (nested ExecutionPlan), `taskStates` (Map), `agentStates` (Map), `memoryPointers[]`, `budgetConsumed` (snapshot), `checkpoints[]`, `auditLog[]`.
- **Verify:** Insert + read round-trip; query by `(userId, status)` returns expected rows.

**C-S3.2 — `PiCheckpointModel`**
- **What:** `src/models/PiCheckpointModel.ts` — snapshots for replay. `executionId`, `checkpointId`, `taskStateSnapshot`, `sandboxSnapshotSha256`, `memoryPointers`, `ts`.
- **Coordinate:** Agent A's `replay.ts` reads this; `orchestrator.ts` writes a checkpoint after every successful task.
- **Verify:** Generate 3 checkpoints during an execution; replay from #2; downstream matches.

**C-S3.3 — `PiAuditLogModel`**
- **What:** `src/models/PiAuditLogModel.ts` — `executionId`, `taskId`, `agent`, `event` (plan_start, tool_call, tool_result, verification, retry, checkpoint, merge), `payload`, `metrics` (tokens, latency, cost), `rationale` (LLM-decision text).
- **Why:** Spec §9 — observability + debug "why did the agent do X".
- **Verify:** Walk a single execution; query audit log; reconstruct the entire decision flow.

**C-S3.4 — `AgentSkillModel` versioning + soft-delete**
- **What:** `src/models/AgentSkillModel.ts` — extend with `deprecatedAt: Date | null`, `versionChain: string[]` (prior version IDs). Soft-delete sets `deprecatedAt` (preserves audit). Skill Router filters `deprecatedAt: null`.
- **Verify:** Soft-delete a skill; subsequent Ticket resolves with "skill not found"; the deprecated record still exists for audit.

**C-S3.5 — Memory vector store adapter**
- **What:** `src/agent/memory/vector.ts` — adapter over Mongo Atlas Vector Search (`$vectorSearch` aggregation stage). Methods: `insertEmbedding(id, embedding, metadata)`, `search(queryEmbedding, k, filters)`. Embeddings generated via a small embedding model (the `embedding-3-large` from Spec §11 env). Skeleton-only on dev env; full when Mongo Atlas is configured.
- **Why:** Spec §3 long-term memory + `pi_agent_upgrade_v3.md` 2.2.
- **Coordinate with Azure:** Use the `appinsights-instrumentation` skill for embedding telemetry when wiring to production on Azure.
- **Verify:** Insert 100 embeddings; `search` returns top-k by cosine similarity; without Atlas configured, gracefully fall back to keyword search in Mongo.

**C-S3.6 — Preference learning + procedural memory**
- **What:** `src/agent/memory/preferences.ts` — `inferPreferencesFromHistory(userId)` scans last 50 successful traces, infers preferred field types + form names using simple statistics (no LLM call needed to keep cost down in Stage 3; LLM-only for ambiguous cases). `src/agent/memory/procedural.ts` — `proposeSkillFromPatterns(userId)` uses LLM to detect recurring workflows and returns `SkillDefinition` proposals for the Skill Author to approve.
- **Verify:** Same user creates 3 NPS+comments forms → `proposeSkillFromPatterns` returns a `weekly_pulse`-shaped skill proposal.

**C-S3.7 — Context assembly**
- **What:** `src/agent/memory/context.ts` — `assembleContext(userId, scope)` (the contract method). Pulls preferences + recent traces + relevant skills + procedural, returns `AgentContext`. Used by `PIOrchestrator` before PLAN.
- **Verify:** For a prompt "build a contact form" by user-u1 (who has built 5 contact forms previously), the assembled context includes the contact skill + the recurring Email field memory.

---

#### **Agent D — LLMOps, Eval, UI & Docs**

**D-S3.1 — Communicator streaming helper**
- **What:** `src/lib/llmClient.ts` — `callLLMStream(opts, onChunk)` exposed. Reuses the existing `thoughtProcess` extraction but as a streaming JSON parser. Under any streaming exception, silently falls back to a non-streaming `messages.create` (per `inspiration_breakdown.md` §2 fail-open).
- **Why:** Agent A's `communicator.ts` consumes this for end-to-end streaming.
- **Verify:** Live golden prompt for Communicator emits `stream_chunk` events; killed-stream recovers via non-stream fallback.

**D-S3.2 — Logger with named child loggers + App Insights adapter**
- **What:** `src/lib/logger.ts` — `logInfo.child({userId, ticketId, persona, ...})` returns a child logger with bound context. Wire the App Insights adapter via the `appinsights-instrumentation` skill (auto-track dependencies + requests). No `console.*` calls in `logger.ts` (it IS the logger).
- **Verify:** `logInfo.child({userId:"u1"}).warn("test")` produces a JSON line with `userId:"u1"`.

**D-S3.3 — Semantic cache (opt-in)**
- **What:** `src/lib/semanticCache.ts` — Redis-backed cache keyed on normalized query embeddings (Stage 1 was skeleton-only). For repeated read/analytics questions, returns cached results in < 50 ms. Gated by env `SEMANTIC_CACHE_ENABLED=false` by default.
- **Verify:** Two identical analytics prompts within 1 min → second one returns cached result, marked cached.

**D-S3.4 — PI agent HTTP API surface**
- **What:** Build 5 routes — all SSE-streaming where the spec calls for streaming:
  - `src/app/api/pi-agent/execute/route.ts` — main entry (SSE)
  - `src/app/api/pi-agent/skills/route.ts` + `/[id]/route.ts` — CRUD
  - `src/app/api/pi-agent/executions/[id]/route.ts` — state read
  - `src/app/api/pi-agent/executions/[id]/resume/route.ts` — replay resume
  - `src/app/api/pi-agent/executions/[id]/approve/route.ts` — merge approval
- **Coordinate:** All routes call into `PIOrchestrator` (Agent A). Frozen contract: `PIOrchestrator.execute(input)` signature from Stage 0.
- **Verify:** Submit a multi-form prompt via `POST /api/pi-agent/execute`; observe SSE stream with `plan` → `task_start` → `tool_call` → `verification` → `awaiting_approval` → `completed` events.

**D-S3.5 — PR-gating vs nightly eval**
- **What:** `tests/agent/eval/stubRunner.ts` runs on `npm run agent:eval` (PR-gating; deterministic with mocked LLM; finish in < 30s). `tests/agent/eval/runner.ts` runs on `npm run agent:eval:live` (nightly; real LLM; writes report to `tests/agent/eval/reports/`). CI config (legacy `.github/workflows/` or equivalent) gates on the stubbed suite.
- **Verify:** PR with a stubbed-test failure fails CI. A PR with only `npm run agent:eval:live -- --skip` passes CI.

**D-S3.6 — PI integration load test**
- **What:** `tests/agent/pi/load_test_pi_agent.ts` — spawns 100 concurrent `PIOrchestrator.execute()` calls with mock intents. Asserts P99 latency < 30 s, 0 data-loss via per-ticket sandbox merge integrity check, 0 auth-bypass via negative suite.
- **Verify:** Run against a local Redis + Mongo; assert all three SLAs.

**D-S3.7 — Skills management UI**
- **What:** `src/components/AgentSkillsDrawer.tsx` (NEW) — list user skills + built-ins, "Test", "Edit", "Delete" actions wired to the HTTP API. `src/components/AgentSidebarDrawer.tsx` extended to surface new tool kinds (user prefs/notifications/exports) in the trace visualization. `src/components/AgentVisualizer.tsx` — render `{type:"turn", persona, ts}` and `{type:"complete", state}` SSE events (typed heartbeats).
- **Verify:** User opens drawer, sees their skills list, edits a skill, sees version bump.

**D-S3.8 — Final docs sync**
- **What:** Reconcile `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md`, `docs/agent/AGENT-OVERVIEW.md` with the shipped state. Create `docs/pi-agent/ARCHITECTURE.md`, `docs/pi-agent/API.md`, `docs/pi-agent/RUNBOOK.md`, `docs/pi-agent/TROUBLESHOOTING.md`. Every v3 definition-of-done item (spec §11 1–9) maps to a doc paragraph.
- **Verify:** Spec coverage check — every tool listed in spec §3.1 has a doc entry.

---

### 3.4 Stage 3 — Choreographed swap proof (no conflict)

**The Riskiest Move — `console.*` → pino across the agent tree.**
- **The problem:** Agent D owns `logger.ts`; the `console.*` calls live in Agent A's `agentLoop.ts` + `personas/*.ts`.
- **The choreography:** Agent D ships the *completed* `logger.ts` (with named child loggers, App Insights adapter wired) FIRST in Stage 3 — as an isolated commit, no other files touched. Then Agent A performs the swap in its owned files (`agentLoop.ts` + persona files). Agent A's swap is a mechanical regex (`console.log(...)` → `logInfo(...)`, etc.) with bound context where needed.
- **Why no conflict:** The two agents edit disjoint files; Agent A imports a frozen interface (`logInfo`, `logWarn`, `logError`, `child`) nothing else. The contract came from Stage 1.

**The Second Riskiest Move — PI orchestrator wiring.**
- Agent A writes `src/agent/pi/orchestrator.ts` and friends. Agent A alone owns `src/agent/pi/**` (per matrix). Agent D writes the HTTP API routes and the UI; both teams agree only on `PI.execute(input)` signature (frozen Stage 0). **No overlapping files.**

**The Third Riskiest Move — Memory vector store.**
- Agent C's `src/agent/memory/vector.ts` is a new file; Agent C owns `src/agent/memory/**` entirely. Agent A's `orchestrator.ts` calls `memory.assembleContext` (frozen Stage 1). **No overlapping files.**

### 3.5 Stage 3 — Integration & Verify Gate

1. **Integration commit order:**
   - Agent C models (`PiExecutionModel`, `PiCheckpointModel`, `PiAuditLogModel`, `AgentSkillModel` v2, memory/vector, preferences, procedural, context).
   - Agent B skills validator + sandbox merge extension + policy.
   - Agent A orchestrator + planner + critic + executors + lock + sandbox + budget + audit + legacy shim + replay + visualize + skill author + console→pino + communicator streaming.
   - Agent D llmClient streaming + logger + semantic cache + HTTP routes + eval CI wiring + UI drawer + visualizer + final docs.
2. **Verify:**
   - `npx tsc --noEmit` — clean cross-file types.
   - `npm run lint` — clean.
   - `npm run build` — Next.js production build clean.
   - `npm run agent:eval` — stubbed suite green; nightly live report compared with previous (no regressions).
   - `npm run agent:validate-skills` — built-in + user skills valid.
   - Manual: open `AgentSkillsDrawer`, edit a skill; verify version bump.
   - Manual: submit a multi-form prompt with `PI_AGENT_ENABLED=true`; verify DAG parallelism + SSE stream.
3. **Stage 3 exit.** All four pass + spec §11 DoD items 1–9 verified → cut the `v3` ship-tag.

---

## 4. Final Definition of Done Mapping (across all stages)

`agent_spec.md` §11 DoD item → stage + agent that delivers it:

| DoD | Stage | Agent(s) |
|---|---|---|
| 1 — 28-tool catalog gated + golden+negative prompts each | 2 | B (catalog), D (prompts) |
| 2 — Mutations via sandbox + transactional idempotent merge | 1 (D0.4) + 2 (B-sandbox-extend) | B (+A for reply rendering) |
| 3 — Budget/deadline/abort/replan gates in code | 1 (D0.2, D0.3, D0.7) + 2 (per-skill budget) | A |
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
| Schema-migration drift — Agent C adds a Mongo field; Agent A's write path doesn't know about it | Stage 1 (D0.7), Stage 2 | Contract sheet freezes field names BEFORE the stage starts; integration verification runs as a single pass per stage (§1.5, §2.4, §3.5) |
| Skills Registry API drift — Agent A's Skill Router calls `loadSkillRegistry()`, Agent B refactors that signature | Stage 2 | `SkillRegistry` interface frozen in Stage 1 (§0.3) |
| PI orchestrator signature drift — Agent A's `PIOrchestrator.execute(input)` evolves; Agent D's HTTP routes break | Stage 3 | Frozen in §0.3 contract sheet; signed-off at stage entry |
| Eval drift — Agent D adds an assertion field (`expectedSandboxShape`); Agent A's `sandboxRedisStore` returns a different shape | Stage 2 | Same contract sheet; integration gate catches the divergence |
| Doc-rot — New tools land but `guidelines.md` / `permissions.json` are out of sync | Each stage | `design.md` A4 mandate already encoded; per-stage Exit Criteria enforce `agent:validate-skills` pass |
| `console.*`→pino swap causing a logging-format break | Stage 3 | Choreographed: Agent D ships logger first; Agent A's swap is a mechanical regex |
| Mongo TTL index partial-filter drift when adding `CANCELLED` status | Stage 1 (C) | Agent C alone owns the TTL filter expression in `agentTicketModel.ts`; verified with a unit test |

---

## 6. Summary

- **3 stages, sequentially gated.** Each stage ends with one integration commit and one full CI run; no stage starts until the prior stage is green.
- **4 agents in parallel per stage.** Within a stage, file ownership is exclusive — every touched file appears in exactly one agent's column of the matrix; an agent MUST NOT edit a file owned by another.
- **Contracts are frozen up front.** Cross-agent dependencies flow through the Stage 0 contract sheet (§0.3) — never through reading each other's code in real time.
- **Hot-zone files are serialized.** `agentLoop.ts` is owned by Agent A in every stage; `tools.ts` / `agentTools.ts` / `permissions.ts` / `sandboxMerge.ts` are Agent B's in every stage; `llmClient.ts` and `tests/agent/eval/**` are Agent D's in every stage; all Mongo models are Agent C's in every stage. **No ownership transfer mid-stream** — predictability of ownership is the precondition for parallel safety.
- **Defects first.** Stage 1 fixes every P0 defect before any new capability is built — guarantees that Stages 2–3 build on a non-drifting, deadline-bounded, user-cancellable, typed-error-producing foundation.
- **All invariants preserved end-to-end.** `Response` read-only; sandbox-first mutation; human confirmation on destructive; permission gating; per-user lock (legacy) + per-execution lock (PI); PII redaction; strict JSON contracts — verified continuously by the negative-prompt suite.

**End of Plan.**

