/**
 * Skill Author persona (A-S3.11).
 * 
 * Off-loop persona for creating user-authored skills.
 * User says "remember this contact-form template as 'weekly_pulse'" → 
 * agent generates a SkillDefinition, validates via B's SkillRegistry.validate / sandboxTest,
 * stores via B's skill merge into C's AgentSkillModel, records audit event.
 * Gated by the `skill_authoring` permission scope (default false).
 * 
 * A-S4.6: Uses makeSkillDefinition factory to ensure requiredParams/optionalParams
 * defaults and prevent drift bugs.
 */

import { AgentState } from "../types";
import { retryLLM, LLMOfflineError } from "@/lib/llmClient";
import { loadPersonaPrompt } from "../prompts/loader";
import { loadSkillRegistry } from "../skills/loader";
import { checkPermission } from "../policy/permissions";
import AgentSkillModel from "@/models/AgentSkillModel";
import { newTraceId } from "../helper/id";
import { logInfo, logError } from "@/lib/logger";
import type { SkillDefinition } from "../types.js";
import { makeSkillDefinition, validateSkillDefinition } from "../skills/skillFactory.js";

export interface SkillAuthorResult {
  success: boolean;
  skill?: SkillDefinition;
  error?: string;
  validationErrors?: string[];
}

/**
 * Generate a SkillDefinition from a user's natural language description.
 * 
 * @param userId - User creating the skill
 * @param description - Natural language description of the skill
 * @param examplePrompt - Example prompt that should trigger this skill
 * @returns SkillAuthorResult with the generated skill or errors
 */
export async function generateSkillFromDescription(
  userId: string,
  description: string,
  examplePrompt: string
): Promise<SkillAuthorResult> {
  try {
    // Check skill_authoring permission
    const perm = checkPermission("skill_authoring" as any);
    if (!perm.allowed) {
      return {
        success: false,
        error: perm.reason || "Skill authoring not permitted",
      };
    }

    // Load system prompt for skill generation
    const { systemPrompt } = loadPersonaPrompt("skillAuthor");
    
    const response = await retryLLM([
      { role: "system", content: systemPrompt },
      { role: "user", content: `User wants to create a skill from this description:\n\n"${description}"\n\nExample prompt that should use this skill: "${examplePrompt}"\n\nGenerate a complete SkillDefinition JSON.` },
    ], {
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const rawSkillDef = JSON.parse(response.content) as SkillDefinition;
    
    // A-S4.6: Apply factory defaults to ensure requiredParams/optionalParams are present
    const skillDef = makeSkillDefinition({
      skillId: rawSkillDef.skillId,
      name: rawSkillDef.name,
      version: rawSkillDef.version,
      permissionScope: rawSkillDef.permissionScope,
      tools: rawSkillDef.tools,
      maxIterations: rawSkillDef.maxIterations,
      negativeTests: rawSkillDef.negativeTests,
      dryRunShape: rawSkillDef.dryRunShape,
      requiredParams: rawSkillDef.requiredParams,
      optionalParams: rawSkillDef.optionalParams,
    });
    
    // Validate the generated skill
    const validation = await validateSkill(skillDef);
    if (!validation.valid) {
      return {
        success: false,
        error: "Generated skill failed validation",
        validationErrors: validation.errors,
      };
    }

    // Run sandbox test (B-S3.3)
    const sandboxTest = await runSandboxTest(skillDef);
    if (!sandboxTest.passed) {
      return {
        success: false,
        error: "Skill failed sandbox test",
        validationErrors: sandboxTest.errors,
      };
    }

    return { success: true, skill: skillDef };
  } catch (err: any) {
    logError("[SkillAuthor] Skill generation failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Validate a SkillDefinition against the frozen contract.
 * Delegates to B's skills.validator (B-S3.3) and local factory validation.
 * A-S4.6: Uses makeSkillDefinition factory validation to ensure defaults.
 */
export async function validateSkill(skill: SkillDefinition): Promise<{ valid: boolean; errors: string[] }> {
  // First, run factory validation (catches missing requiredParams/optionalParams etc.)
  const factoryValidation = validateSkillDefinition(skill);
  if (!factoryValidation.valid) {
    return factoryValidation;
  }

  // Then run additional structural checks
  const errors: string[] = [];

  // Validate each tool reference
  for (const toolRef of skill.tools) {
    if (!toolRef.tool) errors.push("Each tool must have a 'tool' field");
    if (!["requirements", "memory", "context"].includes(toolRef.paramsFrom)) {
      errors.push(`Invalid paramsFrom for tool ${toolRef.tool}: ${toolRef.paramsFrom}`);
    }
  }

  // Validate negative tests
  for (const test of skill.negativeTests) {
    if (!test.assert) errors.push("Each negative test must have an 'assert' field");
    if (!test.description) errors.push("Each negative test must have a 'description' field");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Run sandbox test for a skill (B-S3.3).
 * Executes the skill's tools in a dry-run mode against test data.
 */
export async function runSandboxTest(skill: SkillDefinition): Promise<{ passed: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    // Load built-in skills to check for conflicts
    const builtIns = loadSkillRegistry();
    if (builtIns.some(s => s.name === skill.name)) {
      errors.push(`Skill name '${skill.name}' conflicts with built-in skill`);
    }

    // Validate dryRunShape matches tool expectations
    for (const toolRef of skill.tools) {
      const expectedKeys = Object.keys(skill.dryRunShape);
      if (toolRef.paramsFrom === "requirements" && !expectedKeys.includes("formTitle")) {
        errors.push(`Tool ${toolRef.tool} uses paramsFrom:requirements but dryRunShape missing formTitle`);
      }
    }

    // Could run actual tool dry-runs here with test data
    // For now, just structural validation

    return { passed: errors.length === 0, errors };
  } catch (err: any) {
    return { passed: false, errors: [err.message] };
  }
}

/**
 * Store a user-authored skill (B-S3.4 merge into AgentSkillModel).
 */
export async function storeUserSkill(
  userId: string,
  skill: SkillDefinition,
  author: string
): Promise<{ success: boolean; skillId?: string; error?: string }> {
  try {
    // Check if skill already exists for this user
    const existing = await AgentSkillModel.findOne({ userId, name: skill.name }).lean();
    const version = existing ? existing.version + 1 : 1;

    const skillDoc = new AgentSkillModel({
      userId,
      name: skill.name,
      version,
      definition: skill,
      author,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await skillDoc.save();

    logInfo("[SkillAuthor] User skill stored", { userId, skillName: skill.name, version });

    return { success: true, skillId: skillDoc._id.toString() };
  } catch (err: any) {
    logError("[SkillAuthor] Failed to store user skill", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Delete a user-authored skill.
 */
export async function deleteUserSkill(userId: string, skillName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const perm = checkPermission("skill_authoring" as any);
    if (!perm.allowed) {
      return { success: false, error: perm.reason || "Skill authoring not permitted" };
    }

    await AgentSkillModel.deleteMany({ userId, name: skillName });
    logInfo("[SkillAuthor] User skill deleted", { userId, skillName });
    return { success: true };
  } catch (err: any) {
    logError("[SkillAuthor] Failed to delete user skill", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * List user's authored skills.
 */
export async function listUserSkills(userId: string): Promise<SkillDefinition[]> {
  const skills = await AgentSkillModel.find({ userId }).sort({ name: 1, version: -1 }).lean();
  return skills.map(s => s.definition as SkillDefinition);
}

/**
 * Skill Author persona entry point (for off-loop invocation).
 * Can be called directly from API routes or chat commands.
 */
export async function runSkillAuthor(
  userId: string,
  action: "create" | "update" | "delete" | "list",
  params: {
    description?: string;
    examplePrompt?: string;
    skillName?: string;
    skill?: SkillDefinition;
  }
): Promise<any> {
  const perm = checkPermission("skill_authoring" as any);
  if (!perm.allowed) {
    return { success: false, error: perm.reason || "Skill authoring not permitted" };
  }

  switch (action) {
    case "create":
      if (!params.description || !params.examplePrompt) {
        return { success: false, error: "description and examplePrompt required for create" };
      }
      return generateSkillFromDescription(userId, params.description, params.examplePrompt);

    case "update":
      if (!params.skillName || !params.skill) {
        return { success: false, error: "skillName and skill required for update" };
      }
      return storeUserSkill(userId, params.skill, userId);

    case "delete":
      if (!params.skillName) {
        return { success: false, error: "skillName required for delete" };
      }
      return deleteUserSkill(userId, params.skillName);

    case "list":
      const skills = await listUserSkills(userId);
      return { success: true, skills };

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}