import type { SkillDefinition } from "@/agent/types";

/**
 * Factory function for constructing SkillDefinition objects with safe defaults.
 * Prevents constructor drift where requiredParams / optionalParams or other mandatory fields are omitted.
 */
export function makeSkillDefinition(
  partial: Partial<SkillDefinition> & { name: string }
): SkillDefinition {
  const name = partial.name || "unnamed_skill";
  const skillId =
    partial.skillId ||
    `skill_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;

  return {
    skillId,
    name,
    version: partial.version || "1.0.0",
    permissionScope: partial.permissionScope || "form_management",
    tools: Array.isArray(partial.tools) ? partial.tools : [],
    maxIterations: typeof partial.maxIterations === "number" ? partial.maxIterations : 3,
    negativeTests: Array.isArray(partial.negativeTests) ? partial.negativeTests : [],
    dryRunShape: partial.dryRunShape && typeof partial.dryRunShape === "object" ? partial.dryRunShape : {},
    requiredParams: Array.isArray(partial.requiredParams) ? partial.requiredParams : [],
    optionalParams: Array.isArray(partial.optionalParams) ? partial.optionalParams : [],
  };
}
