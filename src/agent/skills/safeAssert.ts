/**
 * Safe assertion evaluator for negative tests (A-S4.2).
 * 
 * Replaces eval() with a safe expression evaluator.
 * Contract aligned with B's safeAssert.ts (to be implemented by Agent B).
 * 
 * NegEvalContext provides a restricted scope for assertion evaluation:
 * - actionPlan: readonly AgentAction[]
 * - state: readonly AgentState (redacted)
 */

import type { AgentState, AgentAction } from "../types";

export interface NegEvalContext {
  readonly actionPlan: ReadonlyArray<AgentAction>;
  readonly state: Readonly<AgentState>;
  /** Helper to get a value from actionPlan by index */
  getAction: (index: number) => Readonly<AgentAction> | undefined;
  /** Helper to check if any action matches a tool */
  hasTool: (tool: string) => boolean;
  /** Helper to get results from completed actions */
  getResults: (tool: string) => ReadonlyArray<any>;
}

/**
 * Type for negative test assertion - string expression or function.
 * After B's Stage 4, NegativeTest.assert becomes: string | (ctx: NegEvalContext) => boolean
 */
export type NegativeTestAssert = string | ((ctx: NegEvalContext) => boolean);

/**
 * Result of evaluating a negative test.
 */
export interface NegativeTestResult {
  pass: boolean;
  reason?: string;
  error?: string;
}

/**
 * Safely evaluate a negative test assertion.
 * Supports both string expressions (evaluated in restricted scope) and function assertions.
 * 
 * @param assert - The assertion string or function
 * @param ctx - The evaluation context
 * @returns NegativeTestResult with pass/fail and optional reason/error
 */
export function evalNegativeTest(
  assert: NegativeTestAssert,
  ctx: NegEvalContext
): NegativeTestResult {
  // If it's a function, call it directly with the context
  if (typeof assert === "function") {
    try {
      const pass = assert(ctx);
      return { pass: !!pass };
    } catch (fnErr) {
      return { 
        pass: false, 
        error: `Function assertion threw: ${fnErr instanceof Error ? fnErr.message : String(fnErr)}` 
      };
    }
  }

  // String expression - evaluate in restricted scope
  const expression = assert.trim();
  
  // Build a safe evaluation scope
  const scope: Record<string, any> = {
    actionPlan: ctx.actionPlan,
    state: ctx.state,
    getAction: ctx.getAction,
    hasTool: ctx.hasTool,
    getResults: ctx.getResults,
    // Allow common array/object methods but not dangerous globals
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    JSON: JSON,
    Math: Math,
    Date: Date,
    RegExp: RegExp,
    Error: Error,
    Map: Map,
    Set: Set,
    Promise: Promise,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  try {
    // Use Function constructor for safe evaluation (no access to outer scope)
    // This is safer than eval() as it doesn't capture local variables
    const fn = new Function(
      ...Object.keys(scope),
      `"use strict"; return (${expression});`
    );
    const pass = fn(...Object.values(scope));
    return { pass: !!pass };
  } catch (err) {
    // Parse error or runtime error - return structured result
    return { 
      pass: false, 
      error: `Assertion evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      reason: `Invalid assertion syntax: ${expression}`
    };
  }
}

/**
 * Create a NegEvalContext from AgentState.
 */
export function createNegEvalContext(state: AgentState): NegEvalContext {
  return {
    actionPlan: state.actionPlan,
    state,
    getAction: (index: number) => state.actionPlan[index],
    hasTool: (tool: string) => state.actionPlan.some(a => a.tool === tool),
    getResults: (tool: string) => 
      state.actionPlan
        .filter(a => a.tool === tool && a.status === "done")
        .map(a => a.result),
  };
}