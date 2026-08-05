# API & Tool Usage Guidelines

This document specifies data parameter schemas, field types, and rules required for tool execution.

---

## Permission Scopes (Stage 1 scaffold)

The following scope keys are enumerated in `policy/permissions.ts`/`permissions.json`.
They default to `false` (except `agent_audit`) — no Stage 1 tool maps to them yet.
Their tool catalogs arrive with Stage 2; these entries are stub descriptions only.

- **`skill_authoring`** — Authoring and registering skills in the Skills Registry.
- **`bulk_operations`** — Batched multi-form / multi-view operations.
- **`system_admin`** — Platform-level administrative tooling.
- **`integration_management`** — Managing external integrations and webhooks.
- **`agent_audit`** — Reading agent audit event logs (default enabled).

---

## Tool Schemas & Parameter Guidelines

### 1. `create_form`
- **Parameters**:
  - `name`: string (Required, max 100 chars)
  - `description`: string (Optional, max 500 chars)
  - `expiry`: ISO Date string (Default: +30 days)
  - `elements`: Array of FormElement objects:
    - `label`: string (Required)
    - `type`: number (1=Text, 2=Number, 3=Select, 4=Textarea, 5=Date)
    - `required`: boolean (Default: false)
    - `options`: Array of `{ id, label, value }` (Required if type=3)

### 2. `update_form`
- **Parameters**:
  - `formId`: string (Required)
  - `updates`: Object containing `name`, `description`, `elements`, or `status`.

### 3. `query_responses`
- **Parameters**:
  - `formId`: string (Required)
  - `filters`: Array of filter objects:
    - `field`: string (e.g. "Full Name", "Rating", "Email")
    - `operator`: "equals" | "contains" | "gt" | "gte" | "lt" | "lte" | "ne"
    - `value`: any
  - `page`: number (Default: 1)
  - `limit`: number (Default: 50)

### 4. `create_custom_view`
- **Parameters**:
  - `formId`: string (Required)
  - `name`: string (Required)
  - `filters`: Array of filter objects
  - `sortField`: string (Default: "submitted_at")
  - `sortOrder`: "asc" | "desc" (Default: "desc")

### 5. `add_form_element` (B-S2.1)
- **Parameters**:
  - `formId`: string (Required)
  - `element`: Object { label: string (Required), type: number (1=Text, 2=Number, 3=Select, 4=Textarea, 5=Date, Required), required: boolean, options?: [{label, value}] }
- **Sandbox**: Yes — queues element add as update intention; merged via Confirm & Merge.

### 6. `update_form_element` (B-S2.1)
- **Parameters**:
  - `formId`: string (Required)
  - `elementId`: string (Preferred identifier)
  - `label`: string (Fallback identifier)
  - `updates`: Partial element fields (label, type, required, options, position, column)
- **Sandbox**: Yes.

### 7. `remove_form_element` (B-S2.1)
- **Parameters**:
  - `formId`: string (Required)
  - `elementId`: string (Preferred identifier)
  - `label`: string (Fallback identifier)
- **Sandbox**: Yes.

### 8. `reorder_form_elements` (B-S2.1)
- **Parameters**:
  - `formId`: string (Required)
  - `order`: Array of `{ elementId: string, newPosition: number }`
- **Sandbox**: Yes.

### 9. `set_form_status` (B-S2.2)
- **Parameters**:
  - `formId`: string (Required)
  - `status`: number (0=active, 1=paused/draft, 2=archived)
- **Sandbox**: Yes — uses _mergeKind: "form_status".

### 10. `update_form_metadata_settings` (B-S2.2)
- **Parameters**:
  - `formId`: string (Required)
  - `settings`: { ip: boolean, userAgent: boolean, geolocation: boolean, referrer: boolean }
- **Sandbox**: Yes — uses _mergeKind: "form_metadata".

### 11. `update_user_profile` (B-S2.3)
- **Parameters**:
  - `profile`: { firstName, lastName, phoneNumber, address, city, state, country, zipCode, about, website }
- **Security**: USER_SAFE_FIELDS allowlist enforced at merge. password/email/isAdmin/verify* REVOKED.
- **Sandbox**: Yes — users _mergeKind: "user_update".

### 12. `update_user_preferences` (B-S2.3)
- **Parameters**:
  - `preferences`: { dateFormat, language, country, timeFormat }
- **Sandbox**: Yes — uses _mergeKind: "user_update".

### 13. `update_notification_settings` (B-S2.3)
- **Parameters**:
  - `settings`: { popup: { formExpired, newResponseAlert }, email: { formExpired, newResponseAlert, responseSummary } }
- **Sandbox**: Yes — uses _mergeKind: "user_update".

### 14. `list_notifications` (B-S2.4 — EXEMPT FROM SANDBOX)
- **Parameters**:
  - `unreadOnly`: boolean (Optional)
  - `limit`: number (Default: 20, max 50)
- **Exemption rationale**: Notifications are reversible — marking read/unread is a direct write with audit, NOT through the 24h sandbox (spec §3.1).

### 15. `mark_notification_read` (B-S2.4 — EXEMPT FROM SANDBOX)
- **Parameters**:
  - `notificationId`: string (Required)
- **Exemption rationale**: Same as above. Writes an AgentAuditEvent with action "mark_notification_read".

### 16. `clear_notification` (B-S2.4 — EXEMPT FROM SANDBOX)
- **Parameters**:
  - `notificationId`: string (Required)
- **Exemption rationale**: Same as above. Writes an AgentAuditEvent with action "clear_notification".

### 17. `dashboard_stats` (B-S2.5 — READ-ONLY)
- **Parameters**: None.
- **Returns**: `{ totalForms, totalResponses, activeForms, archivedForms }` for the current user.

### 18. `list_agent_audit_events` (B-S2.5 — READ-ONLY)
- **Parameters**:
  - `limit`: number (Default: 20, max 100)
  - `action`: string (Optional filter)

### 19. `list_agent_tickets` (B-S2.5 — READ-ONLY)
- **Parameters**:
  - `limit`: number (Default: 20, max 100)
  - `status`: string (Optional filter)

### 20. `export_form` (B-S2.6)
- **Parameters**:
  - `formId`: string (Required)
  - `format`: "csv" | "json" | "pdf"
- **Returns**: HMAC-signed URL with 5-min TTL. NEVER returns inline bytes.
- **Security**: Signature uses sha256 with TOKEN_SECRET. URL is `/api/export/download?payload=<base64url>&sig=<signature>`.

---

## Sandbox Exemption: Notifications (§3.1)

The notification tools (`list_notifications`, `mark_notification_read`, `clear_notification`) are the **explicit exemption** from sandbox routing. Rationale:
- Marking a notification as read is trivially reversible (set read=false again).
- Clearing a notification removes a transient record — the user can re-trigger it.
- Each write produces an `AgentAuditEvent` with action `mark_notification_read` or `clear_notification`.
- These are the ONLY tools that bypass the sandbox. Do NOT extend this exemption to any other tool.

## USER_SAFE_FIELDS Allowlist (B-S2.3 / B-S2.9)

User profile/preference mutations are filtered at the merge layer. Only these fields are allowed:
- `profile.firstName`, `profile.lastName`, `profile.phoneNumber`, `profile.address`
- `profile.city`, `profile.state`, `profile.country`, `profile.zipCode`
- `profile.about`, `profile.website`, `profile.profileImage`
- `preferences.dateFormat`, `preferences.language`, `preferences.country`, `preferences.timeFormat`
- `notificationSettings.popup.*`, `notificationSettings.email.*`

**REVOKED**: `password`, `email`, `isGoogleAuth`, `isAdmin`, `isVerified`, `forgetPasswordToken`, `forgetPasswordExpiry`, `verifyToken`, `verifyTokenExpiry`, `secondaryEmail`, `secondaryEmailVerifyCode`, `secondaryVerifyCodeExpiry`, `GoogleSheetAccessToken`.

Any attempt to set a revoked field is rejected with `UserUnsafeFieldError` at merge time. This prevents catastrophic privilege escalation via the chat.

---

## B-S3.5: Google Sheets Integration Stubs (Phase 7)

### 21. `link_google_sheet` (Phase 7 placeholder)
- **Parameters**: `formId`: string (Required), `sheetId`: string (Required)
- **Scope**: `integration_management` (default `false`)
- **Status**: Throws `NotImplementedError` until phase 7 implementation.

### 22. `sync_to_sheet` (Phase 7 placeholder)
- **Parameters**: `formId`: string (Required)
- **Scope**: `integration_management` (default `false`)
- **Status**: Throws `NotImplementedError`.

### 23. `unlink_google_sheet` (Phase 7 placeholder)
- **Parameters**: `formId`: string (Required)
- **Scope**: `integration_management` (default `false`)
- **Status**: Throws `NotImplementedError`.

---

## B-S3.1: Executor Role Partition

Tools are partitioned into exactly 4 executor roles:

| Role | Tools |
|------|------|
| `executor_forms` | `create_form`, `update_form`, `delete_form`, `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements`, `set_form_status`, `update_form_metadata_settings` |
| `executor_views` | `create_custom_view`, `update_custom_view`, `delete_custom_view`, `get_custom_views` |
| `executor_responses` | `run_database_query`, `query_responses`, `generate_analytics`, `export_form` |
| `executor_generic` | `update_user_profile`, `update_user_preferences`, `update_notification_settings`, `list_notifications`, `mark_notification_read`, `clear_notification`, `dashboard_stats`, `list_agent_audit_events`, `list_agent_tickets`, `link_google_sheet`, `sync_to_sheet`, `unlink_google_sheet` |

Each tool belongs to exactly one role. Verification runs at import time in `permissions.ts`.

## B-S3.4: Skill Merge Extension

User skill mutations go through the sandbox with `MergeableKind`s `skill_create`, `skill_update`, `skill_soft_delete`. Merge is gated by `skill_authoring` scope and writes to Agent C's `AgentSkillModel` with `$setOnInsert` idempotency on `(user, name, version)`.

## B-S4.5: Permissions Shape Stability

The `Permissions` type exported from `policy/permissions.ts` is frozen as:

```typescript
export interface Permissions {
  scopes: string[];
  userId?: string;
}
```

This is the ONLY shape accepted by `getAllowedTools(role)` and `checkSkillToolAllowlist(skill, userPermissions)`. Do NOT mutate it to a `Record<string, boolean>` shape (the v3 drift class). All callers — the executor dispatcher, the skill-tool allowlist checker, and the role partition — consume this single shape.

The `permissions.json` top-level `permissions` block maps scope keys to `true`/`false` booleans. The five permission scopes that gate agent tools are:
- `form_management`, `data_analytics`, `destructive_actions`, `system_admin`, `agent_audit`

## B-S4.4: Track B Merge Kinds

Three new `MergeableKind`s added for Track B (form versioning + resource locking):

| Kind | Behavior |
|------|----------|
| `form_version_snapshot` | No-op-as-mutation; writes `AgentAuditEvent` row. Gated by existing transaction. C's `FormVersionModel` consumes the snapshot when available. |
| `resource_lock_acquire` | No-op-as-mutation; writes `AgentAuditEvent` row. A's `orchestrator/lock.ts` acquires the lock; the audit row records intent. |
| `resource_lock_release` | No-op-as-mutation; writes `AgentAuditEvent` row. Released by A when the ticket completes or aborts. |

## B-S4.1: safeAssert — Negative Test Evaluator

`src/agent/skills/safeAssert.ts` exports `evalNegativeTest(test, ctx)` which replaces all `eval()` calls on skill assertion strings. The evaluator is a recursive-descent parser restricted to:

- Root identifiers: `actionPlan`, `state`
- Property access: `.IDENT`, `[NUM]`
- Comparisons: `===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`
- Logic: `&&`, `||`, `!`, `( ... )`
- Literals: numbers, strings, `true`, `false`, `null`

Banned tokens are rejected at lexer time: `require`, `import`, `eval`, `Function`, `process`, `globalThis`, `window`, `constructor`, `__proto__`, `prototype`, and chain-injection primitives.

Assert fields may also be functions: `(ctx: NegEwalContext) => boolean`. If a function is provided, it is called directly — no string parsing occurs.

`NegEvalContext = { actionPlan: AgentAction[]; state: AgentState }` is frozen; Agent C is flagged to co-export from `memory/types.ts`.
