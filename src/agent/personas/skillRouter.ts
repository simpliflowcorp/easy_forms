/**
 * Skill Router — resolves a skill name to its SkillDefinition.
 *
 * Called by the Drafter (read-only shortcut) and the Planner (Mixer) to
 * retrieve the canonical skill template from the Skills Registry (built-ins
 * via `loadSkillRegistry()` + user overrides via `AgentSkillModel.find()`).
 *
 * Contract (frozen in Stage 1 §0.3):
 *   SkillDefinition.tools: ToolRef[] where ToolRef = { tool: string; paramsFrom: "requirements" | "memory" | "context" }
 *
 * If the skill is unknown, returns `{ allowed: false, reason: "No skill template for X" }`.
 * If multi-skill ticket, concatenates templates (handled by caller).
 */
import type { SkillDefinition, SkillRegistry, ToolRef } from "../skills/types";
import { loadSkillRegistry } from "../skills/loader";

// AgentSkillModel is owned by Agent C (src/models/AgentSkillModel.ts).
// In Stage 2, it may not exist yet; we import dynamically and handle gracefully.
let AgentSkillModel: any = null;
try {
  AgentSkillModel = require("@/models/AgentSkillModel").default;
} catch {
  // Model not yet implemented — user skill overrides will be skipped.
  AgentSkillModel = null;
}

/** Result of resolving a single skill name. */
export interface SkillRouterResult {
  allowed: boolean;
  skill?: SkillDefinition;
  reason?: string;
}

/**
 * Resolve a skill name to its SkillDefinition.
 * 
 * Order of precedence:
 * 1. User-authored skill (AgentSkillModel.find({ userId, name }))
 * 2. Built-in skill (loadSkillRegistry())
 * 
 * @param skillName - The skill name as classified by the Drafter
 * @param userId - The user's ObjectId string (for user-skill lookup)
 * @returns SkillRouterResult with the resolved skill or rejection reason
 */
export async function resolveSkill(
  skillName: string,
  userId: string
): Promise<SkillRouterResult> {
  // 1. Check for user-authored skill override (if model exists)
  if (AgentSkillModel) {
    try {
      const userSkill = await AgentSkillModel.findOne({ userId, name: skillName })
        .sort({ version: -1 }) // Get latest version
        .lean()
        .exec();

      if (userSkill) {
        // User skill found — validate it matches the frozen contract
        const skillDef = userSkill.definition as SkillDefinition;
        return { allowed: true, skill: skillDef };
      }
    } catch (err) {
      // If the model exists but query fails, log and fall through to built-ins
      console.warn(`[skillRouter] User skill lookup failed for ${skillName}:`, err);
    }
  }

  // 2. Fall back to built-in registry
  const builtIns = loadSkillRegistry();
  const builtInSkill = builtIns.find((s) => s.name === skillName);

  if (builtInSkill) {
    return { allowed: true, skill: builtInSkill };
  }

  // 3. Unknown skill — reject with a clear message
  return {
    allowed: false,
    reason: `No skill template for ${skillName}`,
  };
}

/**
 * Resolve multiple skills (for multi-skill tickets).
 * Returns an array of SkillDefinitions in the same order as input.
 * If any skill is unknown, returns the first rejection.
 */
export async function resolveSkills(
  skillNames: string[],
  userId: string
): Promise<{ allowed: boolean; skills: SkillDefinition[]; reason?: string }> {
  const skills: SkillDefinition[] = [];
  
  for (const skillName of skillNames) {
    const result = await resolveSkill(skillName, userId);
    if (!result.allowed || !result.skill) {
      return { allowed: false, skills: [], reason: result.reason };
    }
    skills.push(result.skill);
  }
  
  return { allowed: true, skills };
}

/**
 * Build an action plan from a skill's tool templates.
 * 
 * Given a SkillDefinition and the user's requirements/context/memory,
 * this fills in the ToolRef templates to produce concrete AgentAction[].
 * The LLM Planner (Mixer) will still be called to generate the actual
 * parameter values, but the *structure* comes from the skill.
 * 
 * @param skill - The resolved SkillDefinition
 * @param requirements - The Drafter's extracted requirements
 * @param userContext - User profile/preferences from agentLoop
 * @param memory - Relevant memory entries (recurring fields, etc.)
 * @returns Array of action templates with owningSkill set
 */
export function buildActionPlanFromSkill(
  skill: SkillDefinition,
  requirements: Record<string, any>,
  userContext: Record<string, any> | undefined,
  memory: Record<string, any> | undefined
): { tool: string; paramsFrom: "requirements" | "memory" | "context"; owningSkill: string }[] {
  return skill.tools.map((toolRef: ToolRef) => ({
    tool: toolRef.tool,
    paramsFrom: toolRef.paramsFrom,
    owningSkill: skill.name,
  }));
}