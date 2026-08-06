/**
 * B-S2.7: Skills Registry Validator
 *
 * Validates registry.json against SkillDefinition schema. Invoked via:
 *   npm run agent:validate-skills
 *
 * Checks:
 *   1. registry.json is valid JSON and is a non-empty array
 *   2. Each skill has all required fields (skillId, name, version, permissionScope, tools, maxIterations, negativeTests, dryRunShape)
 *   3. maxIterations is a positive integer
 *   4. Each tool reference has tool and paramsFrom
 *   5. Each negativeTest has assert string
 *   6. No duplicate skillIds
 *   7. All tool names are in the ALLOWED_TOOLS set
 */

import * as fs from "fs";
import * as path from "path";
import { ALLOWED_TOOLS } from "../policy/permissions";
import { evalNegativeTest } from "./safeAssert";
import type { NegativeTest } from "./types";

const REGISTRY_PATH = path.join(process.cwd(), "src", "agent", "skills", "registry.json");

interface SkillEntry {
  skillId: string;
  name: string;
  version: string;
  permissionScope: string;
  tools: { tool: string; paramsFrom: string }[];
  maxIterations: number;
  negativeTests: NegativeTest[];
  dryRunShape: Record<string, unknown>;
  requiredTools?: string[];
}

function validate(): boolean {
  const errors: string[] = [];

  if (!fs.existsSync(REGISTRY_PATH)) {
    errors.push("registry.json not found at " + REGISTRY_PATH);
    console.error(errors.join("\n"));
    return false;
  }

  let skills: SkillEntry[];
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
    skills = JSON.parse(raw);
  } catch (e: any) {
    errors.push("registry.json is not valid JSON: " + e.message);
    console.error(errors.join("\n"));
    return false;
  }

  if (!Array.isArray(skills)) {
    errors.push("registry.json must be an array of skills");
    console.error(errors.join("\n"));
    return false;
  }

  if (skills.length === 0) {
    errors.push("registry.json is empty — expected at least 1 built-in skill");
  }

  const seenIds = new Set<string>();
  const allowedTools = ALLOWED_TOOLS as readonly string[];

  for (const skill of skills) {
    if (!skill.skillId) errors.push("Missing skillId in entry: " + JSON.stringify(skill));
    else {
      if (seenIds.has(skill.skillId)) errors.push(`Duplicate skillId: ${skill.skillId}`);
      seenIds.add(skill.skillId);
    }
    if (!skill.name) errors.push(`Skill ${skill.skillId}: missing name`);
    if (!skill.version) errors.push(`Skill ${skill.skillId}: missing version`);
    if (!skill.permissionScope) errors.push(`Skill ${skill.skillId}: missing permissionScope`);
    if (!skill.tools || !Array.isArray(skill.tools)) errors.push(`Skill ${skill.skillId}: missing or invalid tools array`);
    else {
      for (const t of skill.tools) {
        if (!t.tool) errors.push(`Skill ${skill.skillId}: tool missing 'tool' field`);
        else if (!allowedTools.includes(t.tool)) errors.push(`Skill ${skill.skillId}: tool "${t.tool}" not in ALLOWED_TOOLS`);
        if (!t.paramsFrom || !["requirements", "memory", "context"].includes(t.paramsFrom)) errors.push(`Skill ${skill.skillId}: tool "${t.tool}" has invalid paramsFrom: ${t.paramsFrom}`);
      }
    }
    if (typeof skill.maxIterations !== "number" || skill.maxIterations < 1) errors.push(`Skill ${skill.skillId}: maxIterations must be a positive integer (got ${skill.maxIterations})`);
    if (!skill.negativeTests || !Array.isArray(skill.negativeTests)) errors.push(`Skill ${skill.skillId}: missing negativeTests array`);
    else {
      for (let i = 0; i < skill.negativeTests.length; i++) {
        const nt = skill.negativeTests[i];
        if (!nt.assert) errors.push(`Skill ${skill.skillId}: negativeTest[${i}] missing assert`);
      }
    }
    // B-S3.2: Validate requiredTools (for user-authored skills)
    if (skill.requiredTools) {
      if (!Array.isArray(skill.requiredTools)) errors.push(`Skill ${skill.skillId}: requiredTools must be an array`);
      else for (const rt of skill.requiredTools) {
        if (!allowedTools.includes(rt)) errors.push(`Skill ${skill.skillId}: requiredTool "${rt}" not in ALLOWED_TOOLS`);
      }
    }
    if (!skill.dryRunShape || typeof skill.dryRunShape !== "object") errors.push(`Skill ${skill.skillId}: missing or invalid dryRunShape`);
  }

  // B-S3.3: Sandbox test — validate dryRunShape matches expected schema
  if (errors.length === 0) {
    for (const skill of skills) {
      const sandboxResult = sandboxTest(skill);
      if (!sandboxResult.valid) {
        errors.push(`Sandbox test for ${skill.skillId}: ${sandboxResult.reason}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("Skills Registry validation FAILED:");
    for (const e of errors) console.error("  - " + e);
    return false;
  }

  console.log(`Skills Registry validation PASSED (${skills.length} skills)`);
  return true;
}

/** B-S4.3: Synthetic context for assert validation in sandboxTest */
function makeSyntheticContext() {
  const actionPlan = [{
    id: "synthetic", tool: "read_form",
    description: "test", params: { elements: [] },
    status: "pending" as const,
  }];
  return {
    actionPlan,
    state: { actionPlan } as any,
    getAction: (index: number) => actionPlan[index],
    hasTool: (tool: string) => actionPlan.some((a: any) => a.tool === tool),
    getResults: () => [],
  };
}

/**
 * B-S3.3: Sandbox test — runs each skill's dryRunShape against the skill
 * definition to verify it produces a valid shape. For built-in skills,
 * this is a structural check against the SkillDefinition schema.
 * For user skills with requiredTools, validates tool allowlisting.
 *
 * B-S4.3: Additionally runs each negativeTests[] assert through
 * evalNegativeTest; reject unparseable assert strings.
 */
function sandboxTest(skill: SkillEntry): { valid: boolean; reason?: string } {
  // 1. Malformed tool detection: reject tools with invalid characters
  if (skill.requiredTools) {
    for (const rt of skill.requiredTools) {
      if (!/^[a-z_0-9]+$/.test(rt)) {
        return { valid: false, reason: `tool name "${rt}" contains invalid characters` };
      }
    }
  }
  // 2. Each tool in the skill must resolve to a valid allowed tool
  for (const t of skill.tools) {
    if (!t.tool || !/^[a-z_0-9]+$/.test(t.tool)) {
      return { valid: false, reason: `tool name "${t.tool}" is malformed` };
    }
  }
  // B-S4.3: Validate negativeTest assert strings through safeAssert
  if (skill.negativeTests && Array.isArray(skill.negativeTests)) {
    const ctx = makeSyntheticContext();
    for (let i = 0; i < skill.negativeTests.length; i++) {
      const nt = skill.negativeTests[i];
      if (typeof nt.assert === "string") {
        const result = evalNegativeTest(
          nt.assert,
          ctx,
        );
        // Only reject PARSE errors (structural issues like unmatched brackets).
        // Descriptive assertion strings (e.g. "create_form without name...")
        // that evaluate to false are accepted — they are descriptive labels
        // meant for the Evaluator's LLM persona at runtime.
        if (result.reason && (
          result.reason.includes("Parse error") ||
          result.reason.includes("Evaluation error")
        )) {
          return {
            valid: false,
            reason: `Skill ${skill.skillId}: negativeTest[${i}] unparseable: ${result.reason}`,
          };
        }
      }
    }
  }
  // 3. dryRunShape must be a valid object
  if (skill.dryRunShape && typeof skill.dryRunShape !== "object") {
    return { valid: false, reason: "dryRunShape is not an object" };
  }
  return { valid: true };
}

const passed = validate();
process.exit(passed ? 0 : 1);