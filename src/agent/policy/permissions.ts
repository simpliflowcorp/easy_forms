import permissionsConfig from "../permissions.json";

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

/** Canonical list of tools the Executor will actually run. Anything else is a hallucination. */
export const ALLOWED_TOOLS: ReadonlyArray<string> = Object.keys(TOOL_TO_SCOPE);
