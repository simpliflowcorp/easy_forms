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
 * B-S3.4: Find a user-authored skill by name from the AgentSkillModel.
 * Returns null if the model is not yet available (Agent C not implemented).
 */
export async function findUserSkillByName(userId: string, name: string): Promise<SkillDefinition | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AgentSkillModel = (await Function('return import("@/models/AgentSkillModel")')() as any).default;
    const doc = await AgentSkillModel.findOne({ user: userId, name, deleted: { $ne: true } }).lean();
    if (!doc) return null;
    return {
      skillId: doc.skillId || doc._id.toString(),
      name: doc.name,
      version: doc.version || "1.0.0",
      permissionScope: doc.permissionScope || "form_management",
      tools: doc.tools || [],
      maxIterations: doc.maxIterations || 3,
      negativeTests: doc.negativeTests || [],
      dryRunShape: doc.dryRunShape || {},
    };
  } catch {
    // Agent C's model not yet deployed — return null
    return null;
  }
}

/**
 * B-S3.4: List all user-authored skills from AgentSkillModel.
 */
export async function listUserSkills(userId: string): Promise<SkillDefinition[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AgentSkillModel = (await Function('return import("@/models/AgentSkillModel")')() as any).default;
    const docs = await AgentSkillModel.find({ user: userId, deleted: { $ne: true } }).lean();
    return docs.map((doc: any) => ({
      skillId: doc.skillId || doc._id.toString(),
      name: doc.name,
      version: doc.version || "1.0.0",
      permissionScope: doc.permissionScope || "form_management",
      tools: doc.tools || [],
      maxIterations: doc.maxIterations || 3,
      negativeTests: doc.negativeTests || [],
      dryRunShape: doc.dryRunShape || {},
    }));
  } catch {
    return [];
  }
}
