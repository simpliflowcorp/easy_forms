# Easy Forms Agent — API Reference

Tool catalog + HTTP API surface for the agent subsystem (v3). Every tool in
`agent_spec.md` §3.1 has an entry below; `guidelines.md` is the canonical
per-tool parameter contract for prompts.

---

## 1. Tool catalog (§3.1 coverage)

Tools are declared in `src/agent/tools.ts` (schema), executed for reads in
`src/lib/agentTools.ts`, sandbox-queued for mutations by the executor, and
merged by `sandboxMerge.ts`. Permissions live in `src/agent/policy/permissions.ts`
(`TOOL_TO_SCOPE` + `ALLOWED_TOOLS`) and are observable in the UI trace via
`payload.toolKind`.

### form_management (sandboxed mutations)

| Tool | Sandbox | Route mapping |
|---|---|---|
| `create_form` | ✓ | `POST /api/form/create` |
| `update_form` | ✓ | `PATCH /api/form/update` |
| `delete_form` | ✓ (gated off by default, `destructive_actions`) | `DELETE /api/form/...` |
| `add_form_element` | ✓ | sub-op of `update_form` |
| `update_form_element` | ✓ | sub-op of `update_form` |
| `remove_form_element` | ✓ | sub-op of `update_form` |
| `reorder_form_elements` | ✓ | sub-op of `update_form` |
| `set_form_status` | ✓ | `form.status` toggle |
| `update_form_metadata_settings` | ✓ | ip/UA/geo/referrer flags |

### data_analytics (reads)

| Tool | Sandbox | Route mapping |
|---|---|---|
| `run_database_query` | — | read |
| `query_responses` | — | read (Response documents are READ-ONLY) |
| `generate_analytics` | — | `GET /api/form/analyticsView` |
| `dashboard_stats` | — | `GET /api/dashboard` |
| `create_custom_view` | ✓ | `POST /api/views` |
| `update_custom_view` | ✓ | `PATCH /api/views/...` |
| `delete_custom_view` | ✓ (gated off by default) | `DELETE /api/views/...` |
| `get_custom_views` | — | read |
| `export_form` (csv/json/pdf) | — | `GET /api/export/{csv,json,pdf}` (signed URL) |

### notifications (direct writes, audit-gated)

| Tool | Route mapping |
|---|---|
| `list_notifications` | `GET /api/notifications/[userId]` |
| `mark_notification_read` | update |
| `clear_notification` | delete |

### user_management (sandboxed mutations)

| Tool | Route mapping |
|---|---|
| `update_user_profile` | `PATCH /api/settings/profile` |
| `update_user_preferences` | `PATCH /api/settings/preferences` |
| `update_notification_settings` | `PATCH /api/settings/notification` |

### agent_audit (reads)

| Tool | Route mapping |
|---|---|
| `list_agent_audit_events` | read route (audit) |
| `list_agent_tickets` | read route (audit) |

### skill_authoring (off-loop, gated)

| Tool | Route mapping |
|---|---|
| `create_skill` | `POST /api/agent/skills` (see §2.4) |
| `update_skill` | `PUT /api/agent/skills/[id]` |
| `delete_skill` | `DELETE /api/agent/skills/[id]` (destructive) |

### external integration stubs (phase-7 placeholders, gated off)

`link_google_sheet`, `sync_to_sheet`, `unlink_google_sheet` — registered but
throw `NotImplementedError` until a later phase; scope
`integration_management`, not in the default `ALLOWED_TOOLS`.

> Invariant: any NEW mutation tool MUST route through the sandbox unless
> explicitly exempted by `permissions.json` (e.g. reversible notification
> writes) and backed by a strong audit event.

---

## 2. HTTP API

### 2.1 Agent execution

`GET/POST /api/agent/execute` — SSE stream. Query params: `prompt`,
`mergeApproved`, `resumeTicketId`, `sessionId`. Emits `{type:"stream_chunk",
persona, chunk}` deltas, typed `{type:"busy"}` / `{type:"error"}` events, and
`[DONE]`. Honors `AGENT_V3_ENABLED` to route via the legacy shim. `/api/agent/abort`
cancels a running ticket. `/api/agent/simulate-offline` toggles per-ticket
offline simulation. `/api/agent/health-stream` broadcasts `agent:llm_health`.

### 2.2 Agent presets (read/write)

- `GET /api/agent/presets` — list the user's prompts
- `POST /api/agent/presets` — save a preset `{label, prompt, tags}`

### 2.3 Skills registry (D-S3.7)

All routes require auth (`getAuthUserId`) and call
`src/service/agentSkillsService.ts` (frozen `SkillRegistry` surface).

- `GET /api/agent/skills` — `{ skills: SkillRow[] }`; built-ins from
  `skills/registry.json` (`source:"builtin"`) + user skills from
  `AgentSkillModel` (`source:"user"`; `deprecatedAt` respected).
- `POST /api/agent/skills` — register a skill `{ name, tools, maxIterations,
  negativeTests, ... }`. Validates shape → idempotent upsert on `(userId,
  name)`. Returns 201 `{ skill }` or 400 with validation errors.
- `PUT /api/agent/skills/[id]` — edit; bumps `version` (patch `{ name, tools,
  ... }`). Built-ins are read-only (404). Ownership enforced.
- `DELETE /api/agent/skills/[id]` — soft-delete (sets `deprecatedAt` when the
  model supports it; else removes the row). Built-ins read-only.

### 2.4 Misc routes

- `POST /api/form/*` — form CRUD (created/edited via sandbox merge)
- `GET /api/form/analyticsView`, `GET /api/dashboard` — analytics reads
- `/api/views*` — custom view CRUD
- `/api/notifications/*` — notifications
- `/api/settings/profile | preferences | notification` — user settings
- `/api/export/{csv,json,pdf}` — signed export URLs

---

## 3. Tool parameter contract (`guidelines.md`)

Each tool entry declares: name, scope, sandbox flag, route mapping, and a
parameter contract (required/optional params, defaults, allowed values).
Prompts (Drafter/Planner/Executor) must fill params only from the frozen
skill templates or extracted requirements — never hallucinate tool ids.

## 4. Auth & tenancy rules

- **Auth:** all `/api/agent/*` write routes call `getAuthUserId(req)` and
  return 401 unauthenticated.
- **Tenancy:** form lookups must intersect the owning user's form IDs — never
  trust a bare `form_id`. Cross-tenant access is a negative-prompt case in the
  eval suite and the multi-agent load test.
- **Regex:** never build a regex from user input (ReDoS removed intentionally).

## 5. LLMOps call surface (`src/lib/llmClient.ts`)

- `retryLLM(messages, options, retry)` — bounded retry/backoff, typed errors.
- `callLLM(messages, options)` — no-retry convenience wrapper.
- `callLLMStream({persona, messages, tools?, model?, temperature?},
  onChunk)` — streaming for the Communicator; fail-open to non-streaming on
  any stream exception (`streamed:false` on the returned `LLMResult`).
- Per-persona overrides: `LLM_MODEL_<PERSONA>` / `LLM_MODEL`, temperature from
  `PERSONA_TEMPERATURES`.

## 6. Skills API shapes

`SkillDefinition` (frozen): `{ skillId, name, version, permissionScope,
tools: ToolRef[], maxIterations, negativeTests: NegativeTest[], dryRunShape }`
with `ToolRef = { tool, paramsFrom: "requirements" | "memory" | "context" }`
and `NegativeTest = { assert, description? }`.