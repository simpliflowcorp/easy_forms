/**
 * Agent skills service (D-S3.7).
 *
 * Thin business logic for the `/api/agent/skills/*` CRUD routes. Works
 * against the frozen Stage-1 `SkillRegistry` contract surface:
 *   list(userId) | register(skill) | validate(skill) | resolve(name, userId)
 *
 * Built-in skills come from the Skills Registry (B's `loadSkillRegistry`);
 * user-authored skills live in Agent C's `AgentSkillModel`. Both are reached
 * through the same defensive dynamic-import pattern used by the Skill Router
 * so this module stays importable before every Stage-3 dependency lands.
 *
 * Soft-delete: when the model supports `deprecatedAt` (C-S3.4), deletes are
 * soft; otherwise the row is removed. Either way the response shape matches.
 */

import type { SkillDefinition, ValidationResult } from "@/agent/skills/types";

let AgentSkillModel: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AgentSkillModel = require("@/models/AgentSkillModel").default;
} catch {
  AgentSkillModel = null;
}

let loadSkillRegistryFn: (() => SkillDefinition[]) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loader = require("@/agent/skills/loader");
  loadSkillRegistryFn = loader.loadSkillRegistry ?? null;
} catch {
  loadSkillRegistryFn = null;
}

export interface UserSkillRow {
  _id: string;
  userId: string;
  name: string;
  version: string;
  definition: SkillDefinition | Record<string, unknown>;
  deprecatedAt?: string | null;
  source: "user" | "builtin";
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillsListResult {
  skills: UserSkillRow[];
}

/** List a user's authored skills + the built-in registry entries. */
export async function listSkills(userId: string): Promise<SkillsListResult> {
  const skills: UserSkillRow[] = [];

  const builtIns = loadSkillRegistryFn ? loadSkillRegistryFn() : [];
  for (const s of builtIns) {
    skills.push({
      _id: `builtin:${s.skillId}`,
      userId: "system",
      name: s.name,
      version: s.version,
      definition: s,
      source: "builtin",
    });
  }

  if (AgentSkillModel && userId) {
    try {
      const userSkills = await AgentSkillModel.find({ userId })
        .sort({ updatedAt: -1 })
        .lean()
        .exec();
      for (const row of userSkills) {
        skills.push({
          _id: String(row._id),
          userId,
          name: row.name,
          version: row.version,
          definition: row.definition ?? {},
          deprecatedAt: row.deprecatedAt ?? null,
          source: "user",
          createdAt: row.createdAt?.toISOString?.() ?? undefined,
          updatedAt: row.updatedAt?.toISOString?.() ?? undefined,
        });
      }
    } catch {
      // Model query failure degrades to built-ins only.
    }
  }

  return { skills };
}

/** Register a new user skill (idempotent by (userId, name) → version bump). */
export async function registerSkill(
  userId: string,
  skill: Partial<SkillDefinition> & { name: string },
): Promise<UserSkillRow> {
  if (!AgentSkillModel) {
    throw new Error("AgentSkillModel not available — skill persistence is offline");
  }
  const version = skill.version || "1.0.0";
  const definition: SkillDefinition = {
    skillId: skill.skillId || `user_${skill.name.replace(/\W+/g, "_").toLowerCase()}`,
    name: skill.name,
    version,
    permissionScope: skill.permissionScope || "form_management",
    tools: skill.tools || [],
    maxIterations: skill.maxIterations ?? 3,
    negativeTests: skill.negativeTests || [],
    dryRunShape: skill.dryRunShape || {},
    requiredParams: skill.requiredParams || [],
    optionalParams: skill.optionalParams || [],
  };

  const row = await AgentSkillModel.findOneAndUpdate(
    { userId, name: definition.name },
    { $set: { version, definition } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();

  return {
    _id: String(row._id),
    userId,
    name: definition.name,
    version,
    definition,
    source: "user",
    createdAt: row.createdAt?.toISOString?.() ?? undefined,
    updatedAt: row.updatedAt?.toISOString?.() ?? undefined,
  };
}

/** Edit a user skill: bumps the version and updates the definition. */
export async function updateSkill(
  userId: string,
  skillId: string,
  patch: Partial<SkillDefinition>,
): Promise<UserSkillRow> {
  if (!AgentSkillModel) {
    throw new Error("AgentSkillModel not available — skill persistence is offline");
  }
  if (skillId.startsWith("builtin:")) {
    throw new Error("Built-in skills are read-only");
  }

  const existing = await AgentSkillModel.findById(skillId).exec();
  if (!existing || String(existing.userId) !== userId) {
    throw new Error("Skill not found");
  }

  const merged: SkillDefinition = {
    skillId: existing.skillId ?? patch.skillId ?? existing.definition?.skillId ?? `user_${existing.name}`,
    name: patch.name ?? existing.name,
    version: patch.version ?? bumpVersion(existing.version),
    permissionScope: patch.permissionScope ?? existing.definition?.permissionScope ?? "form_management",
    tools: patch.tools ?? existing.definition?.tools ?? [],
    maxIterations: patch.maxIterations ?? existing.definition?.maxIterations ?? 3,
    negativeTests: patch.negativeTests ?? existing.definition?.negativeTests ?? [],
    dryRunShape: patch.dryRunShape ?? existing.definition?.dryRunShape ?? {},
    requiredParams: patch.requiredParams ?? existing.definition?.requiredParams ?? [],
    optionalParams: patch.optionalParams ?? existing.definition?.optionalParams ?? [],
  };

  existing.version = merged.version;
  existing.definition = merged;
  await existing.save();

  return {
    _id: String(existing._id),
    userId,
    name: merged.name,
    version: merged.version,
    definition: merged,
    source: "user",
    createdAt: existing.createdAt?.toISOString?.() ?? undefined,
    updatedAt: existing.updatedAt?.toISOString?.() ?? undefined,
  };
}

/** Soft-delete a user skill (deprecatedAt when supported; else remove). */
export async function deleteSkill(userId: string, skillId: string): Promise<{ deleted: boolean }> {
  if (!AgentSkillModel) {
    throw new Error("AgentSkillModel not available — skill persistence is offline");
  }
  if (skillId.startsWith("builtin:")) {
    throw new Error("Built-in skills are read-only");
  }

  const existing = await AgentSkillModel.findById(skillId).exec();
  if (!existing || String(existing.userId) !== userId) {
    throw new Error("Skill not found");
  }

  const supportsSoftDelete = Object.keys(existing.schema?.paths ?? {}).includes("deprecatedAt");
  if (supportsSoftDelete) {
    existing.deprecatedAt = new Date();
    await existing.save();
  } else {
    await AgentSkillModel.deleteOne({ _id: existing._id }).exec();
  }
  return { deleted: true };
}

/** Validate a skill definition against the frozen contract shape. */
export function validateSkillDefinition(skill: unknown): ValidationResult {
  const errors: string[] = [];
  if (!skill || typeof skill !== "object") {
    errors.push("skill must be an object");
    return { valid: false, errors };
  }
  const s = skill as Record<string, unknown>;
  if (typeof s.name !== "string" || !s.name.trim()) errors.push("name is required");
  if (!Array.isArray(s.tools)) errors.push("tools must be an array");
  if (typeof s.maxIterations !== "number") errors.push("maxIterations must be a number");
  if (!Array.isArray(s.negativeTests)) errors.push("negativeTests must be an array");
  return { valid: errors.length === 0, errors };
}

function bumpVersion(version: string): string {
  const parts = version.split(".").map((p) => parseInt(p, 10) || 0);
  parts[parts.length - 1] = (parts[parts.length - 1] ?? 0) + 1;
  return parts.join(".");
}

export default { listSkills, registerSkill, updateSkill, deleteSkill, validateSkillDefinition };