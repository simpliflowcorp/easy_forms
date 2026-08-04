/**
 * Skills Registry loader — Stage 1 skeleton.
 *
 * Reads `registry.json` from disk (mirrors `src/agent/prompts/loader.ts`),
 * so registry entries authored by the Skill Author (Stage 3) are reflected
 * on the next load without a rebuild. Stage 1 ships an empty registry.
 */
import * as fs from "fs";
import * as path from "path";
import type { SkillDefinition } from "./types.js";

const REGISTRY_PATH = path.join(
  process.cwd(),
  "src",
  "agent",
  "skills",
  "registry.json",
);

export function loadSkillRegistry(): SkillDefinition[] {
  try {
    const content = fs.readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(content) as SkillDefinition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A missing/unparseable registry should not take down the loop; the
    // router treats an unloadable registry as empty (no skills available).
    return [];
  }
}

// Re-export for convenience
 export type { SkillDefinition } from "./types";

/**
 * B-S3.1: Get allowed tools for a given executor role.
 * Centralizes the tool-to-role mapping for dispatcher enforcement.
 */
export function getAllowedTools(role: "executor_forms" | "executor_responses" | "executor_views" | "executor_generic"): Set<string> {
  const roleTools: Record<string, string[]> = {
    executor_forms: [
      "create_form",
      "update_form",
      "delete_form",
      "read_form",
      "set_form_status",
      "update_form_metadata_settings",
    ],
    executor_responses: [
      "query_responses",
      "generate_analytics",
      "export_form",
      "run_database_query",
    ],
    executor_views: [
      "create_custom_view",
      "update_custom_view",
      "delete_custom_view",
      "get_custom_views",
    ],
    executor_generic: [
      "run_database_query",
      "update_user_profile",
      "update_user_preferences",
      "update_notification_settings",
      "list_notifications",
      "mark_notification_read",
      "clear_notification",
      "list_agent_audit_events",
      "list_agent_tickets",
    ],
  };
  return new Set(roleTools[role] || []);
}

/**
 * B-S3.2: Check if a user-authored skill's tools are allowed under current permissions.
 * Called by executors before dispatching user-skill tools.
 */
export function checkSkillToolAllowlist(skillName: string, perms: Record<string, boolean>): boolean {
  const skills = loadSkillRegistry();
  const skill = skills.find(s => s.name === skillName);
  if (!skill) return false;
  
  // Check if the skill's permission scope is enabled
  const scope = skill.permissionScope;
  if (scope && perms[scope] === false) {
    return false;
  }
  
  // Check each tool in the skill
  for (const toolRef of skill.tools) {
    const toolPerm = perms[toolRef.tool];
    if (toolPerm === false) {
      return false;
    }
  }
  
  return true;
}
