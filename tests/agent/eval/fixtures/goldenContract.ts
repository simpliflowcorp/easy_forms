/**
 * D-S2.4 — shared golden-row schema + assertion suite.
 *
 * Consumed by `runner.ts` (live loop) and `stubRunner.ts` (simulated loop)
 * so both harnesses evaluate the extended schema identically:
 *   expectedParams        — subset shape matched against the action's params
 *   expectedSandboxShape  — subset shape matched against the pending sandbox
 *                           draft (form/view/update/delete intents)
 *   expectedReplyContains — substring required in the final reply
 * Legacy fields (expectedSkills/expectedTools/maxIterations/category) keep
 * their original semantics; all new fields are optional so pre-Stage-2 rows
 * stay valid.
 */

import { shapeMatches, checkAll } from "./shapeMatcher.ts";

export interface GoldenPromptRow {
  id?: string;
  prompt: string;
  expectedSkills: string[];
  expectedTools: string[];
  maxIterations: number;
  category: string;
  expectedParams?: Record<string, unknown>;
  expectedSandboxShape?: Record<string, unknown>;
  expectedReplyContains?: string;
  branches?: string[];
  /** D-S2.4 — rows whose expected tools ship in a later integration stage
   *  (Agent B bundles) are skipped locally and executed at the gate. */
  deferToIntegration?: boolean;
}

export function rowId(row: GoldenPromptRow, index: number): string {
  return row.id || `golden_${String(index).padStart(3, "0")}`;
}

export function rowBranches(row: GoldenPromptRow): string[] {
  return row.branches && row.branches.length > 0 ? row.branches : [row.category];
}

export interface GoldenAssertResult {
  ok: boolean;
  why?: string;
  details: string;
}

/**
 * Assert the extended schema against a loop final state.
 * `state` shape: { actionPlan, sandbox?, reply?, isComplete, ticket, iterationCount }
 */
export function runGoldenAssertions(
  state: any,
  row: GoldenPromptRow,
): GoldenAssertResult {
  const actionPlan: any[] = Array.isArray(state.actionPlan) ? state.actionPlan : [];
  const usedTools = actionPlan.map((a) => a?.tool).filter(Boolean);

  const detailsParts: string[] = [
    `Tools: [${usedTools.join(", ")}] (expected: [${row.expectedTools.join(", ")}])`,
    `Iterations: ${state.iterationCount ?? "?"}/${row.maxIterations}`,
    `Complete: ${state.isComplete === true}`,
    `Status: ${state.ticket?.status ?? "?"}`,
  ];

  const checks: { name: string; ok: boolean; why?: string }[] = [];

  // 1. Tools used must include every expected tool
  const toolsMatch = row.expectedTools.every((t) => usedTools.includes(t));
  checks.push({ name: "expectedTools", ok: toolsMatch, why: "tools mismatch" });

  // 2. Iteration budget
  checks.push({
    name: "maxIterations",
    ok: (state.iterationCount ?? 0) <= row.maxIterations,
    why: "iterations exceeded",
  });

  // 3. Completion + no error/deny status
  checks.push({ name: "isComplete", ok: state.isComplete === true, why: "not complete" });
  checks.push({
    name: "noError",
    ok: state.ticket?.status !== "LLM_ERROR" && state.ticket?.status !== "REJECTED",
    why: `status ${state.ticket?.status}`,
  });

  // 4. D-S2.4 — expectedParams: for each expected tool, the FIRST action using
  //    that tool must have params matching the expected subset shape.
  if (row.expectedParams) {
    for (const expectedTool of row.expectedTools) {
      const action = actionPlan.find((a) => a?.tool === expectedTool);
      if (!action) {
        checks.push({
          name: `expectedParams.${expectedTool}`,
          ok: false,
          why: `no action for tool ${expectedTool}`,
        });
        continue;
      }
      const params = action.params ?? {};
      const match = shapeMatches(params, row.expectedParams);
      checks.push({
        name: `expectedParams.${expectedTool}`,
        ok: match.ok,
        why: match.why,
      });
      detailsParts.push(`Params(${expectedTool}): ${JSON.stringify(params)}`);
      if (!match.ok) detailsParts.push(`MISMATCH ${match.why}`);
    }
  }

  // 5. D-S2.4 — expectedSandboxShape against the pending sandbox draft
  if (row.expectedSandboxShape) {
    const sandbox = state.sandbox ?? {};
    const match = shapeMatches(sandbox, row.expectedSandboxShape);
    checks.push({ name: "expectedSandboxShape", ok: match.ok, why: match.why });
    detailsParts.push(`Sandbox: ${JSON.stringify(sandbox).slice(0, 400)}`);
    if (!match.ok) detailsParts.push(`MISMATCH ${match.why}`);
  }

  // 6. D-S2.4 — expectedReplyContains in the final reply
  if (row.expectedReplyContains) {
    const reply = String(state.reply ?? state.ticket?.reply ?? "");
    const contains = reply.includes(row.expectedReplyContains);
    checks.push({
      name: "expectedReplyContains",
      ok: contains,
      why: `reply does not contain "${row.expectedReplyContains}"`,
    });
    detailsParts.push(`Reply: "${reply.slice(0, 160)}"`);
    if (!contains) detailsParts.push(`MISSING "${row.expectedReplyContains}"`);
  }

  const verdict = checkAll(checks);
  return {
    ok: verdict.ok,
    why: verdict.why,
    details: detailsParts.join(" | "),
  };
}

/** True when every expected tool is registered in the current tool schema. */
export function toolsAvailable(row: GoldenPromptRow, knownTools: Set<string>): boolean {
  return row.expectedTools.every((t) => knownTools.has(t));
}

export default { runGoldenAssertions, rowId, rowBranches, toolsAvailable };
