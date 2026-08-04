import * as fs from "fs";
import * as path from "path";
import {
  personaModelFor,
  personaTemperatureFor,
} from "@/lib/llmClient";

const PROMPTS_DIR = path.join(process.cwd(), "src", "agent", "prompts");
const DEFAULT_VERSION = process.env.AGENT_PROMPT_VERSION || "v1";

/**
 * R7: Prompt versioning loader with A/B support.
 * 
 * Loads prompts from versioned JSON files in src/agent/prompts/v{version}/
 * Supports A/B testing via AGENT_PROMPT_AB env var (e.g., "v2:0.1" = 10% get v2)
 * Per-user override via cookie `agent_prompt_version`
 */

export interface PromptFile {
  systemPrompt: string;
  outputSchema: object;
  version: string;
  /**
   * D-S2.1 — resolved per-persona model + temperature (env overrides
   * `LLM_MODEL_<PERSONA>` / `PERSONA_TEMPERATURES`). Exposed alongside the
   * loaded prompt so persona callers can pass `persona` through to
   * `retryLLM({ persona })` without re-resolving. Additive — existing
   * callers that destructure only `systemPrompt`/`outputSchema` are unchanged.
   */
  model?: string;
  temperature?: number;
}

interface ABConfig {
  version: string;
  percentage: number;
}

function parseABFlag(flag?: string): ABConfig | null {
  if (!flag) return null;
  const [version, pctStr] = flag.split(":");
  const percentage = parseFloat(pctStr || "0");
  if (!version || isNaN(percentage)) return null;
  return { version, percentage };
}

function getUserVersionOverride(req: Request | null): string | null {
  if (!req) return null;
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/agent_prompt_version=([^;]+)/);
  return match ? match[1] : null;
}

function getPersonaPromptFile(persona: string, version: string): string {
  return path.join(PROMPTS_DIR, version, `${persona}.json`);
}

function loadPromptFile(filePath: string): PromptFile {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as PromptFile;
  } catch (e) {
    console.error(`[PromptLoader] Failed to load ${filePath}:`, e);
    throw new Error(`Failed to load prompt file: ${filePath}`);
  }
}

/**
 * Resolves the prompt version for a request.
 * Priority: cookie override > A/B flag > env default > v1
 */
export function resolvePromptVersion(req: Request | null): string {
  // 1. Cookie override (highest priority)
  const cookieVersion = getUserVersionOverride(req);
  if (cookieVersion) return cookieVersion;

  // 2. A/B flag from env
  const abFlag = process.env.AGENT_PROMPT_AB;
  const abConfig = parseABFlag(abFlag);
  if (abConfig && Math.random() < abConfig.percentage / 100) {
    return abConfig.version;
  }

  // 3. Env default
  return DEFAULT_VERSION;
}

/**
 * Loads the system prompt for a given persona and request context.
 * Returns the system prompt string and the output schema.
 * D-S2.1: also returns the resolved `model` + `temperature` for the persona.
 */
export function loadPersonaPrompt(persona: string, req: Request | null = null): {
  systemPrompt: string;
  outputSchema: object;
  version: string;
  model?: string;
  temperature?: number;
} {
  const version = resolvePromptVersion(req);
  const filePath = getPersonaPromptFile(persona, version);
  const promptFile = loadPromptFile(filePath);
  
  return {
    systemPrompt: promptFile.systemPrompt,
    outputSchema: promptFile.outputSchema,
    version: promptFile.version,
    model: personaModelFor(persona),
    temperature: personaTemperatureFor(persona),
  };
}

/**
 * Load all prompts for a version (used for validation/admin).
 */
export function loadAllPrompts(version: string): Record<string, PromptFile> {
  const personas = ["drafter", "planner", "evaluator", "communicator"];
  const result: Record<string, PromptFile> = {};
  
  for (const persona of personas) {
    const filePath = getPersonaPromptFile(persona, version);
    if (fs.existsSync(filePath)) {
      result[persona] = loadPromptFile(filePath);
    }
  }
  
  return result;
}

/**
 * List available prompt versions.
 */
export function listPromptVersions(): string[] {
  try {
    const entries = fs.readdirSync(PROMPTS_DIR, { withFileTypes: true });
    return entries
      .filter(d => d.isDirectory() && d.name.startsWith("v"))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Validate a prompt version exists and has all required personas.
 */
export function validatePromptVersion(version: string): boolean {
  const required = ["drafter", "planner", "evaluator", "communicator"];
  const prompts = loadAllPrompts(version);
  return required.every(p => p in prompts);
}