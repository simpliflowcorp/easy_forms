import permissionsConfig from "../permissions.json";
import type { ExecutorRole } from "@/agent/types";

/**
 * Single source of truth for capability checks. Maps each skill in skills.md
 * to the permission scope it needs. Verifies the scope is enabled in
 * permissions.json before any persona other than the Drafter acts on it.
 *
 * Why this exists: the original code only checked `form_management` for
 * `build_form`. `data_analytics` (read responses, run analytics, manage
 * custom views) was not checked at all, and `destructive_actions` (delete
 * form) was also unchecked even though it is `false` by default. Guardrail
 * #4 ("Permission Verification") therefore was not enforced in code.
 */

/** Skill name ⇒ permission scope. Synchronized with `skills.md`. */
const SKILL_TO_SCOPE: Record<string, string> = {
  build_form: "form_management",
  edit_form: "form_management",
  delete_form_skill: "destructive_actions",
  filter_responses: "data_analytics",
  generate_analytics_skill: "data_analytics",
  manage_custom_views: "data_analytics",
  run_database_query: "data_analytics", // STAGE_1 reads of Response/CustomView
  product_guide: "_always_allowed", // Educational; never gated
  unsupported: "_always_allowed",
};

/** Skills that are pure reads and can bypass Planner/Executor/Evaluator. */
export const READ_ONLY_SKILLS = new Set([
  "run_database_query",
  "filter_responses",
  "generate_analytics_skill",
  "manage_custom_views", // read-only custom view operations
]);

/**
 * Canonical enumeration of every togglable permission scope. Stage 1
 * scaffolds the five Stage-2 catalog scopes (keys enum'd here, defaults
 * unchanged in permissions.json — all `false` except `agent_audit`).
 * `_always_allowed` is a pseudo-scope, not a toggled permission, so it is
 * intentionally NOT listed here.
 */
export const ALL_SCOPES: ReadonlyArray<string> = [
  "form_management",
  "data_analytics",
  "destructive_actions",
  "skill_authoring",
  "bulk_operations",
  "system_admin",
  "integration_management",
  "agent_audit",
];

export interface PermissionCheckResult {
  allowed: boolean;
  scope?: string;
  reason?: string;
}

/**
 * Returns whether the given skill is permitted by the currently-loaded
 * permissions.json. Pass the skill name exactly as classified by the
 * Drafter (lowercase, with underscores).
 */
export function checkPermission(skill: string | undefined): PermissionCheckResult {
  if (!skill) {
    return { allowed: false, reason: "No skill provided." };
  }

  const scope = SKILL_TO_SCOPE[skill];
  if (!scope) {
    return { allowed: false, reason: `Unknown skill: ${skill}` };
  }
  if (scope === "_always_allowed") {
    return { allowed: true };
  }

  const perms = (permissionsConfig as any).permissions;
  const enabled = !!(perms && perms[scope]);
  if (!enabled) {
    return {
      allowed: false,
      scope,
      reason: `Permission scope '${scope}' is disabled in permissions.json.`,
    };
  }
  return { allowed: true, scope };
}

/**
 * Tool-level check (defense-in-depth). Used by the Executor before dispatch.
 * Maps each tool name to the scope its underlying skill requires. If the
 * scope is disabled, the executor returns an error action for the loop to
 * handle. This catches hallucinated skills that the Drafter might have let
 * through because the LLM did not output a recognized `skill` field.
 */
const TOOL_TO_SCOPE: Record<string, string> = {
  create_form: "form_management",
  update_form: "form_management",
  read_form: "form_management",
  delete_form: "destructive_actions",
  query_responses: "data_analytics",
  generate_analytics: "data_analytics",
  create_custom_view: "data_analytics",
  get_custom_views: "data_analytics",
  update_custom_view: "data_analytics",
  delete_custom_view: "data_analytics",
  run_database_query: "data_analytics",
  // B-S2.1: Element ops
  add_form_element: "form_management",
  update_form_element: "form_management",
  remove_form_element: "form_management",
  reorder_form_elements: "form_management",
  // B-S2.2: Form lifecycle
  set_form_status: "form_management",
  update_form_metadata_settings: "form_management",
  // B-S2.3: User/account
  update_user_profile: "form_management",
  update_user_preferences: "form_management",
  update_notification_settings: "form_management",
  // B-S2.4: Notifications (exempt from sandbox, but permission-gated)
  list_notifications: "data_analytics",
  mark_notification_read: "data_analytics",
  clear_notification: "data_analytics",
  // B-S2.5: Reads
  dashboard_stats: "data_analytics",
  list_agent_audit_events: "agent_audit",
  list_agent_tickets: "agent_audit",
  // B-S2.6: Exports
  export_form: "data_analytics",
};

export function checkToolPermission(tool: string | undefined): PermissionCheckResult {
  if (!tool) return { allowed: false, reason: "No tool provided." };
  const scope = TOOL_TO_SCOPE[tool];
  if (!scope) {
    return { allowed: false, reason: `Unknown tool: ${tool}` };
  }
  const perms = (permissionsConfig as any).permissions;
  const enabled = !!(perms && perms[scope]);
  return enabled
    ? { allowed: true, scope }
    : { allowed: false, scope, reason: `Permission scope '${scope}' is disabled in permissions.json.` };
}

// B-S3.5: Scope gating for Google Sheets stubs
const TOOL_TO_SCOPE_INTEGRATION: Record<string, string> = {
  link_google_sheet: "integration_management",
  sync_to_sheet: "integration_management",
  unlink_google_sheet: "integration_management",
};
// Merge integration scopes BEFORE computing ALLOWED_TOOLS
Object.assign(TOOL_TO_SCOPE, TOOL_TO_SCOPE_INTEGRATION);

/** Canonical list of tools the Executor will actually run. Anything else is a hallucination. */
export const ALLOWED_TOOLS: ReadonlyArray<string> = Object.keys(TOOL_TO_SCOPE);

// ─── B-S3.1: Role-allowed-tools helper ───────────────────────────────
// Partition of ALL tools by ExecutorRole. Every tool appears in EXACTLY
// one role. A's executors/base.ts dispatcher calls this.
// Overlap means the partition is wrong, not intentional.
const ROLE_TOOL_MAP: Record<ExecutorRole, readonly string[]> = {
  executor_forms: [
    "create_form", "update_form", "delete_form", "read_form",
    "add_form_element", "update_form_element", "remove_form_element", "reorder_form_elements",
    "set_form_status", "update_form_metadata_settings",
  ],
  executor_views: [
    "create_custom_view", "update_custom_view", "delete_custom_view", "get_custom_views",
  ],
  executor_responses: [
    "run_database_query", "query_responses", "generate_analytics", "export_form",
  ],
  executor_generic: [
    "update_user_profile", "update_user_preferences", "update_notification_settings",
    "list_notifications", "mark_notification_read", "clear_notification",
    "dashboard_stats", "list_agent_audit_events", "list_agent_tickets",
    // B-S3.5: external integration stubs — gated off by integration_management scope
    "link_google_sheet", "sync_to_sheet", "unlink_google_sheet",
  ],
};

/** Return the strict tool subset allowed for a given executor role. */
export function getAllowedTools(role: ExecutorRole): readonly string[] {
  return ROLE_TOOL_MAP[role] ?? [];
}

/**
 * B-S3.1 verification invariant: every tool in ALLOWED_TOOLS appears in exactly one role.
 * Run at import time so CI catches partition drift immediately.
 */
{
  const seen = new Set<string>();
  const overlap: string[] = [];
  for (const role of Object.keys(ROLE_TOOL_MAP) as ExecutorRole[]) {
    for (const t of ROLE_TOOL_MAP[role]) {
      if (seen.has(t)) overlap.push(t);
      seen.add(t);
    }
  }
  if (overlap.length > 0) {
    throw new Error(`B-S3.1 PARTITION ERROR: tools appear in more than one role: ${overlap.join(", ")}`);
  }
  // Check coverage
  const missing = (ALLOWED_TOOLS as readonly string[]).filter(t => !seen.has(t));
  if (missing.length > 0) {
    throw new Error(`B-S3.2 COVERAGE ERROR: tools in ALLOWED _TOOLS but not in any role: ${missing.join(", ")}`);
  }
}

// ─── B-S3.2: Skill-tool allowlist check ──────────────────────────────
// A's executors/base.ts calls this before any user-skill tool dispatch.
export interface Permissions {
  scopes: string[];
  userId?: string;
}

export function checkSkillToolAllowlist(
  skill: { tools: { tool: string }[] },
  userPermissions: Permissions,
): { allowed: boolean; reason?: string } {
  const roleUnion = new Set<string>();
  for (const role of Object.keys(ROLE_TOOL_MAP) as ExecutorRole[]) {
    for (const t of ROLE_TOOL_MAP[role]) roleUnion.add(t);
  }

  for (const tRef of skill.tools) {
    const tool = tRef.tool;
    // 1. Must be in the role union.
    if (!roleUnion.has(tool)) {
      return { allowed: false, reason: `Tool "${tool}" is not allow-list in any executor role.` };
    }
    // 2. Must be covered by user permission scopes.
    const scope = TOOL_TO_SCOPE[tool];
    if (!scope) {
      return { allowed: false, reason: `Tool "${tool}" has no permission-scope mapping.` };
    }
    if (scope !== "_always_allowed" && !userPermissions.scopes.includes(scope)) {
      return { allowed: false, reason: `Scope "${scope}" missing for tool "${tool}".` };
    }
  }

  return { allowed: true };
}
