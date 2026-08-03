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