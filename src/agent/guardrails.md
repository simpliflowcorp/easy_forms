# Safety Invariants & Guardrails

These safety rules MUST be strictly evaluated before and during loop execution.

---

## Critical Safety Invariants

### 1. Form Responses Are Strictly Read-Only
- **Invariant**: Under no circumstances can form submission responses be edited, mutated, or deleted by any persona or tool.
- **Enforcement**: Only `query_responses` and `generate_analytics` are allowed for response data.

### 2. Sandbox Isolation Before Production Merge
- **Invariant**: All initial form creations, edits, and view modifications MUST execute inside the Sandbox Store.
- **Enforcement**: Direct production database mutation is prohibited until the Evaluator confirms completeness AND the user explicitly clicks **Confirm & Merge**.

### 3. Human Confirmation For Destructive Actions
- **Invariant**: Any request to delete a form or custom view MUST halt the loop and display a visual confirmation modal to the user.

### 4. Permission Verification
- **Invariant**: Before execution, tools must be checked against `permissions.json`. If a scope is disabled (`false`), execution must abort immediately.

### 5. Loop Budget & Maximum Iterations
- **Invariant**: Re-execution loops between Evaluator ➔ Executor are strictly capped at **3 iterations**.
- **Enforcement**: If 3 iterations fail to satisfy requirements, pause the loop and prompt the user for input or plan adjustments.

---

## Remodel notes (revamp_1.1)

The behavioral invariants above are unchanged. The *enforcement mechanisms* have been hardened during the agent remodel tracked in `revamp_1.1.md`:

### 1. Responses read-only
- Enforced in `src/lib/agentTools.ts` `run_database_query` via the `allowedOperations` list (`find`, `findOne`, `countDocuments`, `aggregate` only). No write operations are wired through this code path.
- Additionally, `run_database_query` on the `Response` collection now INTERSECTS any LLM-supplied `form_id` filter with the user's owned-form-Ids (`{ $in: userFormIds, $eq: query.form_id }`) so a forged `form_id` cannot fetch another user's responses (#24). Same intersect guard added for `Form`/`CustomView`.

### 2. Sandbox isolation
- The legacy in-memory `SandboxStoreManager` (`Map<string, SandboxStoreState>`) has been replaced with a Redis-backed store at `src/agent/sandbox/sandboxRedisStore.ts` keyed `sandbox:{userId}`, 24h TTL (#3).
- The sandbox record carries the canonical `SandboxStoreState` shape (`forms`, `customViews`, `queryResults`, `updates: AgentPendingUpdate[]`, `deletes: AgentPendingDelete[]`) so pending mutations survive process restart and are round-tripped through Mongo on the failure path (#17).
- `mergeSandboxToProduction` (`src/agent/sandbox/sandboxMerge.ts`) runs the entire merge inside `mongoose session.withTransaction`:
  - Drafts created via `findOneAndUpdate {$setOnInsert: {…}, $setOnInsert key: (user, agentIdempotencyKey)}` so a re-merge of the same draft is a no-op (#4).
  - Updates / deletes use `expectedUpdatedAt` for optimistic concurrency — a form mutated between snapshot and merge is logged (via stats counters), not silently overwritten.
  - On throw, the transaction aborts and the sandbox is NOT reset, so the user can retry.
- Direct production mutation from the Executor is now impossible — the executor only queues pending intentions; the actual write happens at merge time under the user's explicit "Confirm & Merge" click.

### 3. Human confirmation
- The Evaluator persona (not the Communicator) sets `activePersona = "AWAITING_USER_APPROVAL"` when a mutating tool succeeded in the sandbox. The Communicator preserves that decision instead of overriding it (#1, #14).

### 4. Permissions
- Centralized in `src/agent/policy/permissions.ts`:
  - `checkPermission(skill)` maps every skill in `skills.md` to its required scope and enforces `permissions.json`. All six skills (`build_form`, `edit_form`, `delete_form_skill`, `filter_responses`, `generate_analytics_skill`, `manage_custom_views`) are gated. Previously only `form_management` was checked for `build_form`.
  - `checkToolPermission(tool)` and `ALLOWED_TOOLS` are defense-in-depth at the Executor — the same enforcement catches hallucinated tool names (e.g. the legacy `delete_forms` plural) and tools whose scope the Drafter let through.

### 5. Loop budget
- `iterationCount` is now incremented ONLY by the Evaluator. Drafter clarification exchanges do not consume iterations.
- Retries route to EXECUTOR_SANDBOX (not Planner) on transient executor failure — re-running the same params with the prior `evaluatorFeedback` attached (#1, #23).
- A budget-exhausted path surfaces a user-readable recovery message via the Communicator.

### Concurrency (new invariant post-remodel)
- A per-user Redis lock (`src/agent/sandbox/agentLock.ts`, key `agent_lock:{userId}`, TTL 60s) is acquired by `runAgentLoop` BEFORE any persona work runs and released in a `finally` block via Lua compare-and-del. Concurrent invocations from the same user (double-submit, webhook retry, multi-tab) get an `AgentBusyError`; the SSE route emits a typed `{type:"busy"}` event (#9, #10).

