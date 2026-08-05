/**
 * SkillDefinition factory (A-S4.6).
 * 
 * Provides a canonical way to create SkillDefinition objects with
 * proper defaults for requiredParams, optionalParams, etc.
 * Prevents drift bugs where fields are accidentally omitted.
 * 
 * Contract aligned with C's future memory/skillFactory.ts.
 * When C ships the official factory, swap the import.
 */

import type { SkillDefinition, ToolRef, NegativeTest } from "../types";

export interface SkillDefinitionInput {
  skillId: string;
  name: string;
  version: string;
  permissionScope: string;
  tools: ToolRef[];
  maxIterations: number;
  negativeTests: NegativeTest[];
  dryRunShape: Record<string, unknown>;
  requiredParams?: string[];
  optionalParams?: string[];
}

/**
 * Create a SkillDefinition with safe defaults.
 * Fills requiredParams/optionalParams with [] if not provided.
 * Ensures all required fields are present.
 * 
 * @param input - Partial skill definition (requiredParams/optionalParams optional)
 * @returns Complete SkillDefinition with defaults applied
 */
export function makeSkillDefinition(input: SkillDefinitionInput): SkillDefinition {
  return {
    skillId: input.skillId,
    name: input.name,
    version: input.version,
    permissionScope: input.permissionScope,
    tools: input.tools,
    maxIterations: input.maxIterations,
    negativeTests: input.negativeTests,
    dryRunShape: input.dryRunShape,
    requiredParams: input.requiredParams ?? [],
    optionalParams: input.optionalParams ?? [],
  };
}

/**
 * Validate that a SkillDefinition has all required fields populated.
 * Useful for catching drift in skill authoring.
 */
export function validateSkillDefinition(skill: SkillDefinition): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!skill.skillId) errors.push("skillId is required");
  if (!skill.name) errors.push("name is required");
  if (!skill.version) errors.push("version is required");
  if (!skill.permissionScope) errors.push("permissionScope is required");
  if (!Array.isArray(skill.tools) || skill.tools.length === 0) errors.push("tools array is required and must not be empty");
  if (typeof skill.maxIterations !== "number" || skill.maxIterations < 1) errors.push("maxIterations must be >= 1");
  if (!Array.isArray(skill.negativeTests)) errors.push("negativeTests array is required");
  if (!skill.dryRunShape || typeof skill.dryRunShape !== "object") errors.push("dryRunShape is required and must be an object");
  if (!Array.isArray(skill.requiredParams)) errors.push("requiredParams must be an array (use makeSkillDefinition to auto-default)");
  if (!Array.isArray(skill.optionalParams)) errors.push("optionalParams must be an array (use makeSkillDefinition to auto-default)");

  // Validate each tool reference
  for (const toolRef of skill.tools) {
    if (!toolRef.tool) errors.push("Each tool must have a 'tool' field");
    if (!["requirements", "memory", "context"].includes(toolRef.paramsFrom)) {
      errors.push(`Invalid paramsFrom for tool ${toolRef.tool}: ${toolRef.paramsFrom}`);
    }
  }

  // Validate negative tests
  for (let i = 0; i < skill.negativeTests.length; i++) {
    const test = skill.negativeTests[i];
    if (!test.assert) errors.push(`negativeTests[${i}]: assert is required`);
    if (!test.description) errors.push(`negativeTests[${i}]: description is required`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a minimal negative test with defaults.
 */
export function makeNegativeTest(
  assert: string,
  description: string
): NegativeTest {
  return { assert, description };
}

/**
 * Create a tool reference with validation.
 */
export function makeToolRef(
  tool: string,
  paramsFrom: "requirements" | "memory" | "context"
): ToolRef {
  if (!["requirements", "memory", "context"].includes(paramsFrom)) {
    throw new Error(`Invalid paramsFrom: ${paramsFrom}`);
  }
  return { tool, paramsFrom };
}