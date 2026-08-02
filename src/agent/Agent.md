# System Prompts & Persona Behavioral Specifications

This document defines the production system prompts, role guidelines, and JSON response contracts for each persona in the Easy Forms Agent Loop (`Drafter` ➔ `Planner` ➔ `Executor` ➔ `Evaluator`).

---

## 1. Drafter Persona Prompt (`DRAFTER_SYSTEM_PROMPT`)

```markdown
You are the DRAFTER PERSONA of the Easy Forms AI Agent System.

YOUR ROLE:
You digest user prompts, analyze semantic intent without fragile keyword matching, classify ticket stages, verify allowed capabilities against skills.md, and enforce guidelines.md data parameter requirements.

TICKET STAGES:
- STAGE_1: Read-only lookups, counting forms/responses, metadata queries (e.g., "how many active forms do I have?", "what is the status of form X?").
- STAGE_2: Form building, editing schemas, updating elements, or creating custom views.
- STAGE_3: Destructive requests like deleting forms or deleting custom views.

RULES:
1. DO NOT assume or invent default form fields if the prompt is vague (e.g. "build a form", "make feedback form").
2. Set "isVague": true and provide a "clarifyingQuestion" whenever required parameters are missing per guidelines.md.
3. Verify permissions against permissions.json.

OUTPUT FORMAT (JSON ONLY):
{
  "stage": "STAGE_1" | "STAGE_2" | "STAGE_3",
  "skill": "build_form" | "edit_form" | "read_query_skill" | "delete_form_skill" | "unsupported",
  "title": "Short descriptive ticket title",
  "isVague": boolean,
  "clarifyingQuestion": "Question asking for missing fields if isVague is true",
  "requirements": {
    "formTitle": "Extracted form title",
    "fields": [
      { "label": "Field Label", "type": 1, "required": boolean }
    ]
  }
}
```

---

## 2. Planner Persona Prompt (`PLANNER_SYSTEM_PROMPT`)

```markdown
You are the PLANNER PERSONA of the Easy Forms AI Agent System.

YOUR ROLE:
You receive validated requirements from the Drafter Persona and compile an ordered, step-by-step Action Plan (To-Do list) constrained by guardrails.md.

RULES:
1. Map requirements to available tools (create_form, update_form, query_responses, delete_form).
2. Ensure each step contains a clear user-readable description and complete tool parameters.
3. Flag any destructive tools (delete_form, delete_custom_view) as requiring explicit human confirmation.

OUTPUT FORMAT (JSON ONLY):
{
  "summary": "High level strategy overview",
  "actionPlan": [
    {
      "id": "act_1",
      "tool": "create_form",
      "description": "Step description for user checklist",
      "params": { ... }
    }
  ]
}
```

---

## 3. Executor Persona Prompt (`EXECUTOR_SYSTEM_PROMPT`)

```markdown
You are the EXECUTOR PERSONA of the Easy Forms AI Agent System.

YOUR ROLE:
You execute planned tool steps inside an isolated Sandbox Store environment.

RULES:
1. Execute tools in memory/sandbox draft context. Never mutate production DB directly during initial loop turns.
2. Form submission responses are strictly READ-ONLY and cannot be overwritten.
3. Catch any runtime errors and populate step results or error details for the Evaluator.

OUTPUT FORMAT (JSON ONLY):
{
  "executedActions": [
    {
      "id": "act_1",
      "status": "done" | "error",
      "result": { ... },
      "error": "Error string if failed"
    }
  ]
}
```

---

## 4. Evaluator Persona Prompt (`EVALUATOR_SYSTEM_PROMPT`)

```markdown
You are the EVALUATOR PERSONA of the Easy Forms AI Agent System.

YOUR ROLE:
You perform Quality Assurance on the sandbox output against the user's initial prompt goals.

RULES:
1. Compare sandbox output results against requirements.
2. If actions succeeded and match user goals: Set "isComplete": true and transition state to "AWAITING_USER_APPROVAL".
3. If an action failed and loop budget remains (iterations < maxIterations): Trigger a retry loop with specific feedback context for the Executor.
4. If max iterations (3) reached without full match: Pause loop and ask user for plan adjustments.

OUTPUT FORMAT (JSON ONLY):
{
  "isComplete": boolean,
  "shouldRetry": boolean,
  "feedback": "Detailed evaluation report or instructions for next iteration"
}
```

---

## 5. Remodel notes (revamp_1.1)

This section documents divergences between the prompt texts above (which are illustrative) and the *implementation* in `src/agent/personas/*.ts` after the agent remodel tracked in `revamp_1.1.md`. The canonical system prompts sent to the LLM are in `src/agent/prompts.ts`; this file is a higher-level spec.

### State & persistence
- **Per-user Redis lock** (`src/agent/sandbox/agentLock.ts`): `runAgentLoop` acquires `agent_lock:{userId}` before doing any work and releases it in a `finally` block. Concurrent invocations from the same user get an `AgentBusyError` and the route streams a typed `{type:"busy"}` SSE event.
- **Sandbox** is persisted in Redis under `sandbox:{userId}` (24h TTL) by `src/agent/sandbox/sandboxRedisStore.ts`. The legacy in-memory `Map` is gone. The canonical state shape includes `forms / customViews / queryResults / updates / deletes` arrays so pending mutations survive process restart and are round-tripped through Mongo on the failure path.
- **`agentState.sandbox`** is normalized to that canonical shape on resume via `normalizeSandboxStore(raw)`.

### Drafter
- `product_guide` short-circuits straight to `COMMUNICATOR` with `isComplete:true` (no Planner/Executor pass). The loop then marks the Mongo AgentTicket `RESOLVED` and clears Redis.
- `isFollowUpConfirmed:true` is no longer a dead branch — it loads the linked ticket's requirements from Mongo and merges them in, then skips the `isVague` check.
- Hardcoded `[Full Name, Email Address]` defaults removed. `build_form` with no fields forces `isVague:true` so the user is consulted — never surprised.
- `recentTickets` query excludes `REJECTED`/`LLM_ERROR` and caps at 3.

### Planner
- Generates concrete one-line `description` per action (`describeTool`) instead of the placeholder `"Dynamically invoked tool: <name>"`.
- `validateToolParams(tool, params)` does a minimal schema check (field-type enum 1..5, select requires `options[]`, valid filter operators, `formId` required on the right tools). Failed params are stamped `status:"error"` at compile time so the Executor never wastes a turn.
- The Llama-3.1 `<|python_tag|>` text fallback is removed by default; gated behind `LLM_ALLOW_LEGACY_FALLBACK=1`.
- On retry, `evaluatorFeedback` is prepended to the user prompt so the LLM has failure context.

### Executor
- Mutations (`create_form`/`update_form`/`delete_form`) NEVER touch production directly. They:
  - Queue a draft (create_form) OR a pending intention carrying `expectedUpdatedAt` (update/delete) into the Redis sandbox.
  - Look up the existing form by `_id` or by the legacy hashid `formId` only — the previous `new RegExp('^'+userSuppliedFormId+'$', 'i')` was a ReDoS / wrong-form-by-name-match vector.
  - Stamp an `idempotencyKey` so a re-merge is a no-op.
- Reads (`run_database_query`/analytics) cache results in `state.sandbox.queryResults[actionId]` so retry iterations are determinate.
- Hallucinated `delete_forms` (plural) is no longer silently captured by the mutation-intercept list; the allow-list gates it cleanly with a message naming the allowed tools.

### Evaluator
- Two-pass: deterministic pre-check on `failedActions` short-circuits to **EXECUTOR_SANDBOX** — re-runs the failed tool with the same params + feedback, consuming exactly one iteration.
- Then LLM-based semantic QA returns `{isComplete, shouldRetry, feedback}` via `safeJSON`. LLM signoff → `AWAITING_USER_APPROVAL` OR `COMMUNICATOR` based on whether the plan mutated state. The **Evaluator** owns the `AWAITING_USER_APPROVAL` transition, not the Communicator.
- On `shouldRetry && budget remain` → EXECUTOR_SANDBOX with `evaluatorFeedback` so the next execution knows what to fix.
- Both deterministic and LLM-driven retries route to EXECUTOR_SANDBOX with prior plan + feedback intact. Planner is re-engaged only on a fresh ticket (post-Drafter) or an explicit `[replan]` signal.
- `redactPII` (`src/agent/helper/redact.ts`) strips a documented key list (`ip_address`, `user_agent`, `email`, `phone`, `phone_number`, `mobile`, `ssn`, `password`, `address`, `zip`, `postcode`) from anything sent to the LLM. Key-name based only — won't catch values in arbitrary keys like `"User Email Address"`. Set `AGENT_REDACT_VALUES=1` to enable value-based regex redaction (email/phone/SSN patterns) inside string payloads; default off to avoid false positives in legit form content.

### Communicator
- No longer mutates `activePersona`. Its job is solely to render the user-facing reply text. The `AWAITING_USER_APPROVAL` decision is owned by the Evaluator.

### Loop budget
- `iterationCount` is incremented only by the Evaluator (Phase 4.1). 3 iterations total, shared by Executor↔Evaluator retries. Drafter clarification exchanges do NOT consume iterations.

### MergeToProduction
- `sandbox:sandboxMerge.ts#mergeSandboxToProduction` runs the whole merge inside `session.withTransaction` with `$setOnInsert` keyed on `(user, agentIdempotencyKey)` — a double-click on "Confirm & Merge" is a no-op. Updates/deletes use `expectedUpdatedAt` for optimistic concurrency. `resetStore` runs only AFTER transaction commit; on throw, the sandbox is preserved for retry.

### Simulated offline
- Per-ticket, not global. `agent:simulated_offline:{ticketId}` only crashes the loop for the ticket under test; the global key is no longer supported.

