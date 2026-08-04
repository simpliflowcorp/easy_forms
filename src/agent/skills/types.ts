/**
 * Frozen contracts for the Skills Registry (Stage 1 skeleton).
 *
 * These interfaces are the Stage 1 contract sheet (§0.3) for the skills
 * subsystem. Stages 2 and 3 implement against them: the Skill Router
 * (Agent A) calls `SkillRegistry.resolve`, and the Skill Author (Agent A,
 * Stage 3) calls `register`. Do NOT change these shapes without a new
 * contract-sheet freeze.
 *
 * Stage 1 ships an empty registry (`registry.json` = `[]`); the loader
 * type-checks against `SkillDefinition` but returns no entries yet.
 */

export interface SkillDefinition {
  skillId: string;
  name: string;
  version: string;
  permissionScope: string;
  tools: ToolRef[];
  maxIterations: number;
  negativeTests: NegativeTest[];
  dryRunShape: Record<string, unknown>;
  requiredParams: string[];
  optionalParams: string[];
}

export type ToolRef = {
  tool: string;
  paramsFrom: "requirements" | "memory" | "context";
};

export interface NegativeTest {
  assert: string;
  description: string;
}

export interface SkillRegistry {
  resolve(skillName: string, userId: string): Promise<SkillDefinition | null>;
  register(skill: SkillDefinition, author: string): Promise<SkillDefinition>;
  list(userId: string): Promise<SkillDefinition[]>;
  validate(skill: SkillDefinition): Promise<ValidationResult>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}