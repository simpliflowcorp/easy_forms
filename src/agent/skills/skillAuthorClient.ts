/**
 * B-S3.4: Skill Author Client
 *
 * Thin client that the Skill Author persona (A's skillAuthor.ts) calls to
 * register / update / soft-delete user skills through the sandbox merge path.
 * Gated by skill_authoring scope.
 */

import { checkPermission } from "../policy/permissions.js";
import { loadSkillRegistry } from "./loader.js";
import type { SkillDefinition } from "./types.js";

export interface SkillAuthorResult {
  ok: boolean;
  skill?: SkillDefinition;
  error?: string;
  reason?: string;
}

/** Check whether the user has skill_authoring permission. */
export function canAuthorSkills(userScopes: string[]): boolean {
  return userScopes.includes("skill_authoring");
}

/** Validate that a skill definition is structurally sound before sandbox routing. */
export function validateSkillShape(skill: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!skill || typeof skill !== "object") errors.push("Skill must be an object.");
  else {
    if (!skill.skillId || typeof skill.skillId !== "string") errors.push("Missing skillId.");
    if (!skill.name || typeof skill.name !== "string") errors.push("Missing name.");
    if (!skill.version || typeof skill.version !== "string") errors.push("Missing version.");
    if (!skill.permissionScope || typeof skill.permissionScope !== "string") errors.push("Missing permissionScope.");
    if (!Array.isArray(skill.tools)) errors.push("tools must be an array.");
    if (typeof skill.maxIterations !== "number" || skill.maxIterations < 1) errors.push("maxIterations must be >= 1.");
    if (!Array.isArray(skill.negativeTests)) errors.push("negativeTests must be an array.");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Produce the sandbox params that the Executor uses to queue a skill_create,
 * skill_update, or skill_soft_delete intention.
 */
export function skillSandboxParams(
  operation: "create" | "update" | "soft_delete",
  skill: SkillDefinition,
  existingId?: string,
): Record<string, any> {
  if (operation === "create") {
    return { ...skill, _mergeKind: "skill_create" };
  }
  if (operation === "soft_delete") {
    return { _mergeKind: "skill_soft_delete" };
  }
  return { ...skill, _mergeKind: "skill_update", _id: existingId };
}

/** Find a user skill by name from the registry (for duplicate checks). */
export function findUserSkillByName(skills: SkillDefinition[], name: string): SkillDefinition | undefined {
  return skills.find((s) => s.name === name);
}

/** Merge built-in registry with user skills from AgentSkillModel (Agent C). */
export async function listAllSkills(userId: string, userSkills: SkillDefinition[]): Promise<SkillDefinition[]> {
  const builtIns = loadSkillRegistry();
  return [...builtIns, ...userSkills];
}