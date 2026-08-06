/**
 * @deprecated This module is a legacy fallback. The canonical prompts are versioned JSON files
 * in src/agent/prompts/v1/ loaded via src/agent/prompts/loader.ts.
 * 
 * These constants are kept only for documentation/spec reference and should NOT be used
 * by persona code. Personas MUST use loadPersonaPrompt() from ../prompts/loader.
 * 
 * If you see this being imported anywhere outside of tests/docs, it's a bug.
 */

import { loadPersonaPrompt } from "./prompts/loader";

let _deprecationWarned = false;

function warnDeprecated(promptName: string) {
  if (!_deprecationWarned) {
    console.warn(
      `[DEPRECATED] prompts.ts ${promptName} is a legacy fallback. ` +
      `Use loadPersonaPrompt() from prompts/loader.ts instead. ` +
      `The canonical source is src/agent/prompts/v1/${promptName.toLowerCase()}.json.`
    );
    _deprecationWarned = true;
  }
}

/** @deprecated Use loadPersonaPrompt("drafter") instead */
export function getDrafterPrompt(req?: Request | null) {
  warnDeprecated("DRAFTER_SYSTEM_PROMPT");
  return loadPersonaPrompt("drafter", req);
}

/** @deprecated Use loadPersonaPrompt("planner") instead */
export function getPlannerPrompt(req?: Request | null) {
  warnDeprecated("PLANNER_SYSTEM_PROMPT");
  return loadPersonaPrompt("planner", req);
}

/** @deprecated Use loadPersonaPrompt("executor") instead */
export function getExecutorPrompt(req?: Request | null) {
  warnDeprecated("EXECUTOR_SYSTEM_PROMPT");
  return loadPersonaPrompt("executor", req);
}

/** @deprecated Use loadPersonaPrompt("evaluator") instead */
export function getEvaluatorPrompt(req?: Request | null) {
  warnDeprecated("EVALUATOR_SYSTEM_PROMPT");
  return loadPersonaPrompt("evaluator", req);
}

/** @deprecated Use loadPersonaPrompt("communicator") instead */
export function getCommunicatorPrompt(req?: Request | null) {
  warnDeprecated("COMMUNICATOR_SYSTEM_PROMPT");
  return loadPersonaPrompt("communicator", req);
}

// Legacy constants kept for documentation reference only — DO NOT USE IN PRODUCTION CODE
export const DRAFTER_SYSTEM_PROMPT = `LEGACY FALLBACK — Use loadPersonaPrompt("draffer") from prompts/loader.ts`;
export const PLANNER_SYSTEM_PROMPT = `LEGACY FALLBACK — Use loadPersonaPrompt("planner") from prompts/loader.ts`;
export const EXECUTOR_SYSTEM_PROMPT = `LEGACY FALLBACK — Use loadPersonaPrompt("executor") from prompts/loader.ts`;
export const EVALUATOR_SYSTEM_PROMPT = `LEGACY FALLBACK — Use loadPersonaPrompt("evaluator") from prompts/loader.ts`;
export const COMMUNICATOR_SYSTEM_PROMPT = `LEGACY FALLBACK — Use loadPersonaPrompt("communicator") from prompts/loader.ts`;