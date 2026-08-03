# agent_spec.md — Easy Forms Agent v3

> **Goal.** The Easy Forms Agent must be able to do *everything an authenticated
> user can do*, end to end — read, write, update, and delete every owned
> resource, plus the conversational glue (planning, looping, tool usage,
> skill authoring, memory, and self-improvement) that lets it complete a user
> prompt **without failing**.
>
> This document is the **target spec** for a multi-agent system. It is grounded
> in the *current* implementation under `src/agent/**` (Drafter → Planner →
> Executor → Evaluator → Communicator; sandbox-first; human-confirm-on-merge)
> and stretches it to full end-to-end control. Concrete deltas from today are
> marked **Δ**. Concrete defects blocking the goal are tracked in
> `agent_upgrade_v3.md`.

---

## 1. Scope of Control — "everything a user can do"

The agent must operate every user-owned resource the web app exposes through
`src/app/api/**` and the underlying `src/models/**`. Today it controls ~40%
of the surface. The target is the full table below.

| Resource | Read | Create | Update | Delete | Today | Target |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Form** (schema, elements, expiry, status, metadataSettings) | ✅ | ✅ | ✅ sandbox | ✅ sandbox | partial | full |
| **Form element** (add/remove/reorder a single field) | ✅ | ❌ | ❌ | ❌ | **Δ** | full |
| **Form status** (activate / pause / archive) | ✅ | — | ❌ | — | **Δ** | full |
| **Form submission (Response)** | ✅ (scoped) | ❌ | ❌ | ❌ | read-only (intentional) | **read-only invariant preserved** |
| **Custom view** | ✅ | ✅ sandbox | ✅ sandbox | ✅ sandbox | partial | full |
| **Workspace/dashboard stats** | ❌ | — | — | — | **Δ** | full read |
| **Notifications** (read/unread/list) | ✅ | — | (mark read) | (clear) | **Δ** | full |
| **User profile** | ✅ | — | ❌ | — | **Δ** | full update |
| **User preferences** (language, country, time/date format) | ✅ | — | ❌ | — | **Δ** | full update |
| **User notification settings** (popup/email toggles) | ❌ | — | ❌ | — | **Δ** | full update |
| **Exports** (CSV / JSON / PDF download URLs) | ❌ | — | — | — | **Δ** | full (generate signed URLs) |
| **Analytics** (per-form + workspace-wide) | partial | — | — | — | **Δ** | full read |
| **Webhooks / integrations** (Google Sheet link, etc.) | ❌ | ❌ | ❌ | ❌ | **Δ** | full (out of MVP, scoped read first) |
| **Audit trail** (own AgentAuditEvents) | ❌ | — | — | — | **Δ** | full read |

### 1.1 Invariants that do NOT change

Borrowed verbatim from `.agents/Agent.md` §2 and `src/agent/guardrails.md` —
the goal of "full control" is **not** a license to weaken safety:

- **Form submission responses are strictly read-only.** The agent can read
  and aggregate; it must NEVER write, mutate, or delete a `Response`. The
  `Response` read-only invariant is the one "no" in this spec.
- **Sandbox isolation before production merge.** Mutations queue
  drafts / pending-intentions in the Redis sandbox keyed
  `sandbox:{userId}:{ticketId}` (24h TTL) and merge only on the user's
  explicit **Confirm & Merge** click, inside a Mongo transaction with
  `$setOnInsert` idempotency + `expectedUpdatedAt` optimistic concurrency.
- **Human confirmation for destructive actions.** Deletes (form, custom
  view, future: integration tokens) MUST halt the loop and surface a
  confirmation modal with a one-click export/backup suggestion.
- **Permission verification.** Every tool MUST pass
  `src/agent/policy/permissions.ts` against `src/agent/permissions.json`
  before execution; disabled scopes abort immediately.
- **Loop budget.** Executor↔Evaluator retries are capped at 3 iterations
  (tuneable per skill — see §6).
- **Strict JSON contracts** between personas (`safeJSON` parse) and
  **PII redaction** before any LLM call (`src/agent/helper/redact.ts`).
- **Per-user Redis lock** `agent_lock:{userId}` serializes concurrent loops.

---

## 2. System Architecture — Multi-Agent Target

### 2.1 Topology

```
                       ┌──────────────────────────────────────────────┐
                       │                  Agent Bus                    │
                       │  (runAgentLoop in agentLoop.ts; per-user     │
                       │   Redis lock; SSE/WS streaming; Mongo         │
                       │   authoritative, Redis resume cache)         │
                       └──┬─────────┬─────────┬─────────┬──────────────┘
                          │         │         │         │
            ┌─────────────┘         │         │         └────────────────┐
            ▼                       ▼         ▼                          ▼
      ┌──────────┐            ┌─────────┐  ┌──────────┐            ┌────────────┐
      │ Orchestr │            │ Drafter │  │ Planner  │            │Communicator│
      │  (new)   │            │ Router  │  │ / Mixer  │            │            │
      └────┬─────┘            └────┬────┘  └─────┬────┘            └──────┬─────┘
           │                       │            │                        │
           ▼                       ▼            ▼                        ▼
      ┌──────────┐            ┌─────────┐  ┌──────────────┐      ┌───────────────┐
      │ Memory   │            │ Skill   │  │ Executor    │      │ Evaluator     │
      │ Service  │            │ Router  │  │ (sandbox +  │      │ (QA + plan    │
      │ (new)   │            │ (new)  │  │  tools)     │      │  repair)      │
      └────┬─────┘            └────┬────┘  └──────┬─────┘      └───────┬───────┘
           │                       │            │                    │
           ▼                       ▼            ▼                    ▼
      ┌──────────┐            ┌─────────┐  ┌────────────┐      ┌───────────────┐
      │ Skills   │            │ Skills  │  │ Sandbox +  │      │ Sandbox Merge │
      │ Registry │            │ Library │  │ Tools (CRUD)│      │ (txn, idemp.) │
      │ (new)    │            │(creates)│  │            │      │               │
      └──────────┘            └─────────┘  └────────────┘      └───────────────┘
```

### 2.2 Persona roster (target)

| Persona | Role | New / Existing | Notes |
|---|---|---|---|
| **Orchestrator** | Owns the loop budget, deadlines, abort signals, replan escalation, and cross-persona context; the only persona allowed to call another persona. | **Δ new** | Today `agentLoop.ts` does this inline; promote it to a named persona so budgets, timeouts, and replan gates are first-class. |
| **Drafter / Router** | Intent classification, stage, skill resolution, follow-up detection, vague-clarification. Maps user intent to one or more **skills** (not tools). | existing | Stops outputting raw `requirements.fields` for non-build skills; routes to the Skill Router instead. |
| **Skill Router** | Resolves a skill name to its tool plan template; can compose multiple skills in one ticket. | **Δ new** | Today the Planner invents the tool list per call (non-deterministic). The Skill Router makes multi-skill tickets ("build a form AND set up a custom view") first-class. |
| **Planner / Mixer** | Fills in tool params from requirements + memory; may merge multiple skill templates; produces a typed `actionPlan[]`. | existing (refactor) | Becomes a *param-filler* over Skill Router templates, not a from-scratch plan generator. |
| **Executor (sandbox + tools)** | Executes tool steps against the sandbox for mutations and against prod for reads; records snapshots + idempotency keys. | existing | **Δ** expanded tool list per §3. |
| **Evaluator** | Two-pass QA (deterministic + LLM). Owns `AWAITING_USER_APPROVAL`. Can trigger replan via the Orchestrator. | existing | **Δ** gets a "negative test" mode + structured-bit checks (not just LLM verdict). |
| **Communicator** | Renders user-facing reply; streams tokens; surfaces merge modal / confirmation prompt. | existing | **Δ** enable streaming; never mutates `activePersona`. |
| **Skill Author** | Off-loop persona that creates / edits a skill in the Skills Registry when the user asks the agent to "remember how to do X" or teaches it a new workflow. | **Δ new** | Lives outside the main loop; gated by `destructive_actions`-style scope (`skill_authoring`). |
| **Memory Service** | Provides long-term, per-user, per-workspace memory: recurring fields, preferences, recent failures, skill-usage stats. Read by the Drafter, written by the Evaluator post-merge and by the Executor on read snapshots. | **Δ new** | See §5. |

---

## 3. Tool Layer — full CRUD surface

All tools live in `src/agent/tools.ts` (schema), `src/lib/agentTools.ts` (execution for reads), `src/agent/personas/executor.ts` (sandbox queueing for mutations), `src/agent/sandbox/sandboxMerge.ts` (transactional merge). Every tool MUST also update `src/agent/policy/permissions.ts` (`TOOL_TO_SCOPE` + `ALLOWED_TOOLS`) and `src/agent/skills.md` + `guidelines.md` together (`design.md` A4).

### 3.1 Tool catalog (target)

| Tool | Scope | Sandbox? | New? | Maps to API route |
|---|---|:---:|:---:|---|
| `create_form` | form_management | ✓ | existing | `POST /api/form/create` |
| `update_form` | form_management | ✓ | existing | `PATCH /api/form/update` |
| `delete_form` | destructive_actions | ✓ | existing (gated off by default) | `DELETE /api/form/...` |
| `add_form_element` | form_management | ✓ | **Δ** | sub-op of update_form |
| `update_form_element` | form_management | ✓ | **Δ** | sub-op of update_form |
| `remove_form_element` | form_management | ✓ | **Δ** | sub-op of update_form |
| `reorder_form_elements` | form_management | ✓ | **Δ** | sub-op of update_form |
| `set_form_status` | form_management | ✓ | **Δ** | toggle `form.status` |
| `update_form_metadata_settings` | form_management | ✓ | **Δ** | ip/UA/geo/referrer flags |
| `run_database_query` | data_analytics | — | existing | read |
| `query_responses` | data_analytics | — | existing | read |
| `generate_analytics` | data_analytics | — | existing | `GET /api/form/analyticsView` |
| `dashboard_stats` | data_analytics | — | **Δ** | `GET /api/dashboard` |
| `create_custom_view` | data_analytics | ✓ | existing | `POST /api/views` |
| `update_custom_view` | data_analytics | ✓ | existing | `PATCH /api/views/...` |
| `delete_custom_view` | data_analytics | ✓ | existing gated off | `DELETE /api/views/...` |
| `get_custom_views` | data_analytics | — | existing | read |
| `list_notifications` | notifications | — | **Δ** | `GET /api/notifications/[userId]` |
| `mark_notification_read` | notifications | — | **Δ** | update |
| `clear_notification` | notifications | — | **Δ** | delete |
| `update_user_profile` | user_management | ✓ | **Δ** | `PATCH /api/settings/profile` |
| `update_user_preferences` | user_management | ✓ | **Δ** | `PATCH /api/settings/preferences` |
| `update_notification_settings` | user_management | ✓ | **Δ** | `PATCH /api/settings/notification` |
| `export_form` (csv/json/pdf) | data_analytics | — | **Δ** | `GET /api/export/{csv,json,pdf}` (returns signed URL) |
| `list_agent_audit_events` | agent_audit | — | **Δ** | new read route |
| `list_agent_tickets` | agent_audit | — | **Δ** | new read route |
| `create_skill` | skill_authoring | off-loop | **Δ** | new write route, gated |
| `update_skill` | skill_authoring | off-loop | **Δ** | new write route, gated |
| `delete_skill` | skill_authoring | off-loop | **Δ** | destructive |

Mandatory invariant: any new mutation tool MUST route through the sandbox
(unless explicitly exempted by an Orchestrator decision and a `permissions.json`
flag — e.g. notification "mark read" is reversible enough to be a direct write
gated behind a strong audit event).

### 3.2 Tool parameter contract (`guidelines.md`)

Each tool entry MUST declare:

- name, description (1 sentence), schema (Zod 4 for runtime + JSON Schema for the LLM),
- `required` vs `optional` params and their types,
- whether it's `read`, `mutate`, or `destructive`,
- the permission scope,
- an owning skill (for the Skill Router),
- a dry-run preview shape (what the Evaluator compares against).

---

## 4. Planning Loop — "complete the prompt without failing"

The loop's job is to guarantee progress or fail loudly. The target loop adds
five gates the current loop is missing: **replan escalation**, **per-skill
budget**, **wall-clock deadline**, **user abort**, and **negative-test
evaluation**.

### 4.1 State machine (target)

```
DRAFTER
  ├─ isQuestion / vague / unsupported ─► COMMUNICATOR (asks user)
  ├─ product_guide / general_chat     ─► COMMUNICATOR (renders)
  ├─ read-only skill                   ─► EXECUTOR_SANDBOX (read shortcut) ─► COMMUNICATOR
  └─ mutating/multi-skill              ─► SKILL_ROUTER ─► PLANNER_MIXER ─► EXECUTOR_SANDBOX

EXECUTOR_SANDBOX ─► EVALUATOR
  ├─ failedActions + budget            ─► EXECUTOR_SANDBOX (retry, iteration++)
  ├─ shouldRetry #1 + budget           ─► EXECUTOR_SANDBOX (retry w/ feedback)
  ├─ shouldRetry #2 + budget           ─► ORCHESTRATOR_REPLAN ─► PLANNER_MIXER (with feedback)  [Δ]
  ├─ isComplete + mutating             ─► AWAITING_USER_APPROVAL
  ├─ isComplete + read                 ─► COMMUNICATOR
  ├─ budget exhausted                  ─► COMMUNICATOR (asks user)
  └─ negative-test fail                ─► ORCHESTRATOR_REPLAN                                   [Δ]

AWAITING_USER_APPROVAL
  ├─ user clicks Confirm & Merge       ─► MERGED_TO_PRODUCTION
  ├─ user clicks Reject                ─► COMMUNICATOR (explains) ─► terminal
  └─ sandbox TTL warning (< 2h)        ─► COMMUNICATOR (warns but keeps ticket alive)            [Δ]

COMMUNICATOR ─► persist (Mongo authoritative) ─► terminal
```

### 4.2 Gates (target)

| Gate | Default | Tunable via | Why |
|---|---|---|---|
| `maxIterations` (Executor↔Evaluator) | 3 | per-skill override in `permissions.json` (read=1, build=2-3, multi-skill=4) | Today a 1-tool read and a 4-tool multi-skill build share the same budget. **Defect.** |
| `LOOP_DEADLINE_MS` | 90 000 | env | No wall-clock budget today; a 4-persona × 3-retry loop can outlive the 60 s lock. **Defect.** |
| `LOCK_TTL_MS` | max(`LOOP_DEADLINE_MS`, 60 000) + 5 000 | env | Lock TTL < worst-case loop length today. **Defect.** |
| `ABORT_FLAG` | `agent:abort:{ticketId}` | Redis | No user-cancel today; the server-side loop keeps running once started. **Defect.** |
| Clarification round cap | 5 | env | Drafter clarifications are unbounded → unbounded LLM spend. **Defect.** |
| Replan budget | 1 | config | After 2 failed retries, escalate to Planner instead of a 3rd identical Executor run. **Defect.** |

### 4.3 Loop orchestration by the Orchestrator (new)

- holds the per-user Redis lock for the whole loop lifetime,
- emits typed SSE/WS events at every transition (`{type:"persona", persona}`,
  `{type:"trace", step}`, `{type:"token", persona, delta}`, `{type:"busy"}`,
  `{type:"complete", state}`, `{type:"error", ...}`),
- implements the deadline, abort, and replan gates,
- is the only persona allowed to call sub-personas (so budgets can't be
  silently bypassed by an over-eager sub-call).

---

## 5. Memory — "see through the lifecycle of the agent"

Today memory is fragmented across 5 disconnected stores and capped at a
3-ticket sliding window. The target is a **Memory Service** that the agent
reads at ticket start and writes back after success, providing durable
cross-session continuity.

### 5.1 Memory layers

| Layer | Store | Lifetime | Read by | Written by | Today |
|---|---|---|---|---|---|
| **Ticket state** | Mongo `AgentTicketModel` (authoritative) + Redis resume cache | permanent / cleared on resolve | Orchestrator, all personas | Orchestrator on every transition | partial (Mongo writes are conditional, drift) |
| **Sandbox** | Redis `sandbox:{userId}:{ticketId}`, 24h TTL | 24h sliding | Executor | Executor; reset after merge | existing |
| **Trace** | in-memory + Mongo compressed | 50 entries cap | all personas (last step), Communicator (reply context) | addTrace | existing |
| **Conversation history** | `state.conversationHistory` (10 turns) | per ticket | Drafter | Orchestrator | existing |
| **Recent-context window** | Mongo query, 3 non-error tickets | ad-hoc | Drafter | n/a | existing |
| **User profile + preferences** | `state.userContext` | frozen at ticket start | Drafter, Communicator | (none) | existing (no refresh) |
| **Long-term user memory** | **Δ** new Mongo `AgentMemoryModel` (`userId`, `workspaceId`, `key`, `value`, `confidence`, `lastUsedAt`) | permanent | Drafter, Planner | Evaluator post-merge, Memory Service on every successful tool call | **Δ new** |
| **Skill-usage stats** | **Δ** Mongo `AgentSkillUsageModel` (`userId`, `skill`, `count`, `lastUsedAt`, `successRate`, `avgIterations`) | permanent | Skill Router, Planner | Evaluator on completion | **Δ new** |
| **Recent failures ledger** | **Δ** Mongo `AgentFailureModel` (`userId`, `promptHash`, `lastError`, `count`, `lastAt`) | 30d TTL | Drafter (pre-empt ambiguity) | Executor on `error` | **Δ new** |

### 5.2 Memory Service contract (`src/agent/memory/`)

```
getMemory(userId, key?)                 → AgentMemory | AgentMemory[]
setMemory(userId, key, value, opts)    → void        (upsert, bump confidence)
recordSkillUse(userId, skill, ok, it)  → void
recordFailure(userId, promptHash, err) → void
recentFailures(userId, sinceMs)         → AgentFailure[]
summarize(ticketId)                    → string       (for trace compaction)
```

Long-term memory writes MUST be:

- Zod-validated (reject anything that isn't a primitive / known shape),
- redacted via `redactPII` before persistence (memory is a high-value PII leak surface),
- confidence-scored (a single observation is `0.3`, recurring rises to `0.9`),
- revocable by the user via a "forget" tool.

### 5.3 Compaction

Tickets resumed many times accumulate unbounded sandbox + trace. The target
adds:

- LRU cap on `sandbox.queryResults` (default 8),
- a `summarize(ticketId)` step that replaces completed-iteration results
  with a one-line digest the Evaluator can read (so retries read the digest,
  not the raw payload),
- proactive sandbox-TTL warning (`< 2h` → Communicator message).

---

## 6. Skills — "ability to create skills"

A skill is a **named, versioned, parametrized tool-plan**. Today skills are
free text in `skills.md` (6 of them) and the Planner re-invents the plan
every call — non-deterministic and impossible to extend without code changes.
The target promotes skills to first-class versioned artifacts.

### 6.1 Skill shape (Skills Registry — `src/agent/skills/registry.json`)

```jsonc
{
  "name": "build_form",
  "version": "1.0.0",
  "description": "Create a new form with the given fields.",
  "permissionScope": "form_management",
  "stages": ["STAGE_2"],
  "requiredParams": { "formTitle": "string", "fields": "Field[]" },
  "optionalParams": { "expiryDays": "number", "description": "string" },
  "tools": [
    { "tool": "create_form", "paramsFrom": "requirements" }
  ],
  "maxIterations": 2,
  "negativeTests": [
    { "assert": "actionPlan[0].params.elements.length >= 1" }
  ],
  "dryRunShape": { "_id": "string", "formId": "string" }
}
```

### 6.2 Skill lifecycle

1. **Built-in skills** ship with the repo (`registry.json`); covered by eval.
2. **User skills** are authored off-loop via the **Skill Author** persona:
   the user says "remember how I build my contact forms" → the agent runs a
   canned `build_form` ticket, observes the params, and saves a skill with
   `paramsFrom` reference to long-term memory. Stored in
   `AgentSkillModel` (Mongo), keyed `(userId, name)`.
3. Skill versions are immutable; edits create a new version (so eval and
   audit stay reproducible).
4. The Skill Router resolves a Drafter skill name to either a built-in or
   user skill (user skill wins on name conflict, but is flagged in the
   trace so the user knows).

### 6.3 Skill-creation contract

- A user can ONLY create skills for permission scopes they themselves hold.
  `skill_authoring` is its own scope, default `false` in `permissions.json`;
  the user MUST enable it explicitly.
- Skills MUST be Zod-validated at creation; a skill that fails validation
  is rejected before persistence.
- A skill MUST declare which tools it composes; it CANNOT reference a tool
  that isn't in `ALLOWED_TOOLS`.
- A skill MUST carry an `idempotencyKey` strategy so re-runs are safe.

---

## 7. LLMOps target

| Concern | Today | Target |
|---|---|---|
| Provider routing | single `LLM_PROVIDER` env | keep; add per-persona model override (`LLM_MODEL_DRAFTER`, …) |
| Token accounting | per-call `usage` captured into `AgentUsage` | preserve; add per-persona latency to `AgentUsage` |
| Budget | per-ticket + per-user-daily | preserve; add **per-skill** budget (read skills 5 000 tok, build 20 000) |
| Structured logging | `console.log` / `console.warn` | **Δ** pino with `{userId, ticketId, persona, attempt, ms, status, model}` shipped to App Insights |
| Streaming | only Communicator (`onChunk`) | **Δ** enable `stream: true` for Communicator end-to-end; keep non-stream for Drafter/Planner/Evaluator (they need full JSON) |
| Fallback | none | **Δ** on non-retryable `LLMOfflineError` from primary, one transparent retry against a configured secondary provider before `LLM_ERROR` is raised |
| Health probe | NVIDIA `/models` only | **Δ** branch on `LLM_PROVIDER`; Gemini uses its own `/models` |
| Prompt versioning | v1 in `src/agent/prompts/v1/*.json` + A/B loader | preserve; add `v2` for the new personas; eval per version |
| PII redaction in trace | only `params`/`result`, not `llmRawOutput` | **Δ** redact `llmRawOutput` before `addTrace` |

---

## 8. Evaluation target

| Concern | Today | Target |
|---|---|---|
| Suites | one live suite, 50 golden prompts | **Δ** split: stubbed unit (PR-gating, deterministic) + nightly live (drift) |
| Assertions | `toolsMatch` + `iterationsOk` + `completed` + `noError` | **Δ** add `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`, negative-test prompts |
| Negative prompts | none | **Δ** prompts that should NOT be marked `isComplete` |
| Cleanup | none; eval@test.local accumulates | **Δ** per-prompt `finally` sandbox reset + ticket resolve |
| Reports | stdout | **Δ** `tests/agent/eval/reports/<timestamp>.json` with per-prompt trace + diff vs last run |
| Branch coverage | none | **Δ** tag each golden prompt with the persona-branches it exercises; report `% hit` |

---

## 9. Security posture (target)

- All new mutation tools route through the sandbox + merge transaction — no
  direct production writes from the Executor.
- `Response` stays read-only. **Forever.**
- Tenant isolation: every read tool MUST intersect any user-supplied id
  with the owning user's owned-form ids (existing pattern in
  `agentTools.ts#resolveFormIdFilter`).
- New tools for profile/preferences MUST NOT leak other users' data — they
  operate strictly on `User.findById(userId)`.
- Export tools MUST return server-signed short-lived URLs (not inline the
  payload, which could blow through the SSE stream budget).
- Audit: every mutation tool writes an `AgentAuditEvent` at merge time;
  every read tool logs to `AgentUsage`.
- `skill_authoring` scope defaults to `false`; creating/modifying a skill
  MUST require human confirmation (skills are persistence-level behavior).
- Long-term memory writes are PII-redacted and revocable.

---

## 10. Blast radius of the v3 change

Files / modules touched or introduced (the upgrade plan in
`agent_upgrade_v3.md` opens each one):

| Area | Files |
|---|---|
| New personas | `src/agent/personas/orchestrator.ts`, `src/agent/personas/skillRouter.ts`, `src/agent/personas/skillAuthor.ts` |
| Loop | `src/agent/agentLoop.ts` (extract Orchestrator; add deadline/abort/replan gates) |
| Tools | `src/agent/tools.ts`, `src/lib/agentTools.ts`, `src/agent/personas/executor.ts`, `src/agent/sandbox/sandboxMerge.ts` (add new tools + extend merge to CustomView updates/deletes + User profile) |
| Policy | `src/agent/policy/permissions.ts`, `src/agent/permissions.json`, `src/agent/skills.md`, `src/agent/guidelines.md` (must move together per `design.md` A4) |
| Memory | new `src/agent/memory/` (service + Mongo models `AgentMemoryModel`, `AgentSkillModel`, `AgentSkillUsageModel`, `AgentFailureModel`) |
| Skills | new `src/agent/skills/registry.json` + loader |
| LLMOps | `src/lib/llmClient.ts` (per-persona model, fallback provider, pino logger), `src/lib/llmHealthMonitor.ts` (provider branch) |
| Eval | `tests/agent/eval/runner.ts`, `tests/agent/eval/stubRunner.ts`, `tests/agent/eval/golden-prompts.jsonl` (≥50 prompts; ≥10 negative), `tests/agent/eval/reports/` |
| UI | `src/components/AgentSidebarDrawer.tsx`, `src/components/AgentConfirmationModal.tsx` (new tool kinds; skill-authoring surface) |
| Docs | `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md`, `docs/agent/AGENT-OVERVIEW.md` (sync with this spec) |

---

## 11. Definition of done (v3)

The agent is "full end-to-end control, completes prompts without failing"
when **all** of the following are true:

1. The 28-tool catalog in §3.1 ships, gated by `permissions.json`, each
   covered by at least one golden prompt and one negative prompt.
2. Every mutation tool routes through the sandbox and merges transactionally
   with idempotency keys — no direct production writes from the Executor.
3. The loop's budget, deadline, abort, and replan gates are in code, not
   just in prose. The loop cannot run past `LOOP_DEADLINE_MS`.
4. The Memory Service persists at least: recurring form fields per user,
   skill-usage stats, recent failures. The Drafter reads them at every
   ticket start.
5. A user can author, edit, and delete a **skill** through the agent; that
   skill is immediately usable by the Skill Router.
6. The stubbed unit eval suite is PR-gating and deterministic; the live eval
   suite is nightly and reports drift.
7. Per-persona LLM latency, token usage, and cost are in `AgentUsage` and
   visible in the admin dashboard.
8. `npm run lint`, `npx tsc --noEmit`, `npm run build`, **and**
   `npm run agent:eval` all pass in CI.
9. All invariants in §1.1 are preserved (verified by the negative-prompt
   suite: prompts that *try* to mutate a `Response`, *try* to bypass the
   sandbox, *try* to skip human confirmation on deletes all fail with the
   expected error class).

Until all nine are true, v3 is not done.
