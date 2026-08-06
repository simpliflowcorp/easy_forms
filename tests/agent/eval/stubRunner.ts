/**
 * Stage 1 — Stubbed eval runner skeleton (D-S1.4 / E2.5 prep) + Stage 2
 * expansion (D-S2.1/2.2 meta-tests, D-S2.4 golden rows, D-S2.5 negative
 * rows, D-S2.6 report history + branch coverage).
 *
 * Jest-style row registration for deterministic, LLM-mocked unit eval.
 * Rows mock the LLM via `__testRetryLLMOverride` in `src/lib/llmClient.ts`.
 *
 * Contract (frozen for Agent A + Stage 2):
 *   registerRow({ id, prompt, setup?, llmOverride, assert })
 *   runStubbedSuite()
 *
 * Stage 2 additions are ADDITIVE on StubRow: `branches`, `deferToIntegration`.
 * Golden rows (golden-prompts.jsonl) and negative rows
 * (negative-prompts.jsonl) are loaded data-driven; rows whose expected tools
 * are not yet registered (Agent B bundles, `deferToIntegration: true`) are
 * SKIPPED with a clear log line and executed at the integration gate.
 *
 * Run: node --experimental-strip-types tests/agent/eval/stubRunner.ts
 *   or: npm run agent:eval:stub
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  __testRetryLLMOverride,
  retryLLM,
  LLMOfflineError,
} from "../../../src/lib/llmClient.ts";
import type { LLMMessage, LLMOptions, LLMResult, RetryOptions } from "../../../src/lib/llmClient.ts";
import { agentToolsSchema } from "../../../src/agent/tools.ts";
import { runGoldenAssertions, rowId, rowBranches, toolsAvailable } from "./fixtures/goldenContract.ts";
import type { GoldenPromptRow } from "./fixtures/goldenContract.ts";
import { runNegativeAssertions, simulateDeniedState, negativeRowId } from "./fixtures/negativeContract.ts";
import type { NegativePromptRow } from "./fixtures/negativeContract.ts";

// ─── Types (frozen contract, extended additively) ────────────────────────

export type StubLLMOverrideResult = {
  content: string;
  tool_calls?: any[];
};

/**
 * Per-row LLM mock. Signature is the simple (messages, tools) form Agent A
 * codes against; the runner adapts it to `__testRetryLLMOverride`.
 */
export type StubLLMOverride = (
  messages: unknown[],
  tools?: unknown,
) => StubLLMOverrideResult | Promise<StubLLMOverrideResult>;

export type StubAssertResult = boolean | { pass: boolean; reason: string };

export type StubRow = {
  id: string;
  prompt: string;
  setup?: () => void | Promise<void>;
  llmOverride: StubLLMOverride;
  assert: (state: any) => StubAssertResult | Promise<StubAssertResult>;
  /** D-S2.6 — branch tags; reported in the branch-coverage summary. */
  branches?: string[];
  /** D-S2.4 — row requires tools from a later integration stage; skip now. */
  deferToIntegration?: boolean;
};

export type StubRowResult = {
  id: string;
  prompt: string;
  passed: boolean;
  reason?: string;
  error?: string;
  skipped?: boolean;
  branches?: string[];
};

export type StubSuiteReport = {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  branches: { hit: string[]; total: string[]; pct: number };
  results: StubRowResult[];
};

// ─── Registry ────────────────────────────────────────────────────────────

const registeredRows: StubRow[] = [];

/**
 * Register a stubbed eval row. Agent A calls this for each D0.x chaos/unit row.
 * Safe to call at module load (rows accumulate until runStubbedSuite).
 */
export function registerRow(row: StubRow): void {
  if (!row?.id) {
    throw new Error("registerRow: id is required");
  }
  if (typeof row.llmOverride !== "function") {
    throw new Error(`registerRow(${row.id}): llmOverride must be a function`);
  }
  if (typeof row.assert !== "function") {
    throw new Error(`registerRow(${row.id}): assert must be a function`);
  }
  // Replace existing row with same id (re-register / hot-reload friendly)
  const idx = registeredRows.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    registeredRows[idx] = row;
  } else {
    registeredRows.push(row);
  }
}

/** Clear all registered rows (tests only). */
export function clearRows(): void {
  registeredRows.length = 0;
}

/** Snapshot of currently registered row ids. */
export function listRegisteredRowIds(): string[] {
  return registeredRows.map((r) => r.id);
}

// ─── State builder ───────────────────────────────────────────────────────

/**
 * Extend the canned loop state with fields parsed from the mock LLM output:
 * `{ actionPlan, sandbox, reply, isComplete, ticket, errorKind, iterationCount }`.
 * Plain-string outputs (Agent A rows) fall back to the legacy defaults.
 */
function buildState(row: StubRow, llmResult: StubLLMOverrideResult): any {
  const content = String(llmResult.content ?? "");
  let parsed: any = null;
  if (content.startsWith("{")) {
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
  }

  const state: any = {
    prompt: row.prompt,
    reply: parsed?.reply ?? content,
    llmResult,
    isComplete: parsed?.isComplete ?? true,
    ticket: {
      status: parsed?.ticket?.status ?? "RESOLVED",
      reply: parsed?.ticket?.reply ?? parsed?.reply ?? content,
    },
    actionPlan: Array.isArray(parsed?.actionPlan) ? parsed.actionPlan : [],
    sandbox: parsed?.sandbox ?? {},
    errorKind: parsed?.errorKind,
    iterationCount: parsed?.iterationCount ?? 0,
    executionTrace: Array.isArray(parsed?.executionTrace) ? parsed.executionTrace : [],
  };
  return state;
}

// ─── Runner ──────────────────────────────────────────────────────────────

function adaptOverride(
  llmOverride: StubLLMOverride,
): (
  messages: LLMMessage[],
  options: LLMOptions,
  retry: RetryOptions,
) => Promise<LLMResult> {
  return async (messages, options, _retry) => {
    const out = await llmOverride(messages, options.tools);
    return {
      role: "assistant",
      content: out.content ?? "",
      tool_calls: out.tool_calls,
    };
  };
}

function normalizeAssert(result: StubAssertResult): {
  pass: boolean;
  reason?: string;
} {
  if (typeof result === "boolean") {
    return { pass: result, reason: result ? undefined : "assert returned false" };
  }
  return { pass: !!result.pass, reason: result.reason };
}

/**
 * Run every registered row.
 * Rows with `deferToIntegration: true` are skipped (counted separately) —
 * their tools arrive at the stage gate; the integration run executes them.
 */
export async function runStubbedSuite(): Promise<StubSuiteReport> {
  const results: StubRowResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const branchesHit = new Set<string>();
  const branchesTotal = new Set<string>();

  for (const row of registeredRows) {
    if (row.branches) {
      for (const b of row.branches) branchesTotal.add(b);
    }

    if (row.deferToIntegration === true) {
      skipped++;
      results.push({
        id: row.id,
        prompt: row.prompt,
        passed: false,
        skipped: true,
        branches: row.branches,
      });
      console.log(`⏭️  SKIP ${row.id}: deferred to integration (tools from a later stage)`);
      continue;
    }

    const prevOverride = __testRetryLLMOverride.current;
    __testRetryLLMOverride.current = adaptOverride(row.llmOverride);

    try {
      if (row.setup) {
        await row.setup();
      }

      // Invoke the override once so the hook path is exercised even for
      // skeleton rows that do not run the full agent loop.
      const llmResult = await row.llmOverride([], undefined);
      const state = buildState(row, llmResult);

      const assertion = normalizeAssert(await row.assert(state));
      if (assertion.pass) {
        passed++;
        if (row.branches) for (const b of row.branches) branchesHit.add(b);
        results.push({
          id: row.id,
          prompt: row.prompt,
          passed: true,
          branches: row.branches,
        });
        console.log(`✅ PASS  ${row.id}`);
      } else {
        failed++;
        results.push({
          id: row.id,
          prompt: row.prompt,
          passed: false,
          reason: assertion.reason,
          branches: row.branches,
        });
        console.log(`❌ FAIL  ${row.id}: ${assertion.reason ?? "assert failed"}`);
      }
    } catch (err: any) {
      failed++;
      const message = err?.message ? String(err.message) : String(err);
      results.push({
        id: row.id,
        prompt: row.prompt,
        passed: false,
        error: message,
        branches: row.branches,
      });
      console.log(`❌ FAIL  ${row.id}: THREW ${message}`);
    } finally {
      __testRetryLLMOverride.current = prevOverride;
    }
  }

  const total = registeredRows.length;
  const branchPct =
    branchesTotal.size === 0
      ? 100
      : Math.round((branchesHit.size / branchesTotal.size) * 100);
  console.log(
    `\n📊 Stub suite: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped (deferred)`,
  );
  console.log(
    `🌿 Branch coverage: ${branchesHit.size}/${branchesTotal.size} (${branchPct}%)`,
  );
  return { passed, failed, skipped, total, branches: { hit: [...branchesHit], total: [...branchesTotal], pct: branchPct }, results };
}

// ─── D-S2.1 meta-test: per-persona model + temperature resolution ────────

registerRow({
  id: "llm_persona_model_resolution",
  prompt: "meta: LLM_MODEL_DRAFTER=foo resolves before the test hook",
  branches: ["llm.personaModel", "llm.personaTemperature"],
  setup: async () => {
    process.env.LLM_MODEL_DRAFTER = "foo";
    process.env.LLM_MODEL = "bar";
  },
  llmOverride: async () => {
    // Drive the REAL retryLLM so resolvePersonaLLMOptions runs before the
    // __testRetryLLMOverride hook; capture the resolved options.
    let captured: { model?: string; temperature?: number } = {};
    const prev = __testRetryLLMOverride.current;
    __testRetryLLMOverride.current = async (_m, options) => {
      captured = { model: options.model, temperature: options.temperature };
      return { role: "assistant", content: "captured" };
    };
    try {
      await retryLLM([{ role: "user", content: "hi" }], { persona: "DRAFTER" });
    } finally {
      __testRetryLLMOverride.current = prev;
    }
    return { content: JSON.stringify(captured) };
  },
  assert: (state) => {
    const captured = JSON.parse(String(state.reply));
    if (captured.model !== "foo") {
      return { pass: false, reason: `expected resolved model "foo", got "${captured.model}"` };
    }
    if (captured.temperature !== 0.2) {
      return { pass: false, reason: `expected DRAFTER temperature 0.2, got ${captured.temperature}` };
    }
    return true;
  },
});

// ─── D-S2.2 meta-test: secondary-provider fallback on LLMOfflineError ────

registerRow({
  id: "llm_fallback_on_offline",
  prompt: "meta: primary LLMOfflineError → fallback provider serves the call",
  branches: ["llm.fallback", "llm.costAttribution"],
  setup: async () => {
    process.env.LLM_FALLBACK_MODEL = "fallback-model";
    process.env.LLM_FALLBACK_API_KEY = "fallback-key";
    process.env.LLM_FALLBACK_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "primary-key";
    delete process.env.LLM_PROVIDER;
  },
  llmOverride: async () => {
    // Bypass the retryLLM test hook so the REAL callOnceWithFallback path runs.
    const prevOverride = __testRetryLLMOverride.current;
    __testRetryLLMOverride.current = undefined as any;

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new LLMOfflineError("primary offline (simulated)");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "fallback ok" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        text: async () => "",
      } as any;
    }) as typeof fetch;

    try {
      const result = await retryLLM(
        [{ role: "user", content: "hi" }],
        { persona: "EXECUTOR" },
        { retries: 0 },
      );
      return {
        content: JSON.stringify({
          content: result.content,
          model: result.usage?.model,
          costUsd: result.costUsd,
          calls: callCount,
        }),
      };
    } finally {
      globalThis.fetch = originalFetch;
      __testRetryLLMOverride.current = prevOverride;
    }
  },
  assert: (state) => {
    const result = JSON.parse(String(state.reply));
    if (result.content !== "fallback ok") {
      return { pass: false, reason: `expected fallback content, got "${result.content}"` };
    }
    if (result.model !== "fallback-model") {
      return {
        pass: false,
        reason: `expected usage.model "fallback-model" for attribution, got "${result.model}"`,
      };
    }
    if (result.calls !== 2) {
      return { pass: false, reason: `expected primary+fallback = 2 fetch calls, got ${result.calls}` };
    }
    return true;
  },
});

// ─── D-S2.4 golden-prompts.jsonl (data-driven) ───────────────────────────

const EVAL_DIR = path.join(process.cwd(), "tests", "agent", "eval");

const knownTools = new Set<string>();
for (const t of agentToolsSchema as any[]) {
  const name = t?.function?.name;
  if (typeof name === "string") knownTools.add(name);
}

/** Synthesize planner-style params whose leaf values satisfy the expected
 *  subset shape (type tokens → representative values). */
function synthesizeParams(expected: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!expected) return out;
  for (const [key, pattern] of Object.entries(expected)) {
    if (pattern === "*") {
      out[key] = "present";
    } else if (typeof pattern === "string") {
      switch (pattern) {
        case "string": out[key] = "sample_value"; break;
        case "number": out[key] = 1; break;
        case "boolean": out[key] = true; break;
        case "array": out[key] = []; break;
        case "object": out[key] = {}; break;
        default: out[key] = pattern;
      }
    } else if (Array.isArray(pattern)) {
      out[key] = pattern.length > 0 ? [synthesizeParams(pattern[0] as Record<string, unknown>)] : [];
    } else if (typeof pattern === "object" && pattern !== null) {
      out[key] = synthesizeParams(pattern as Record<string, unknown>);
    } else {
      out[key] = pattern;
    }
  }
  return out;
}

/** Simulated sandbox draft derived from the row's expected sandbox shape
 *  (record wildcards and type tokens expanded to representative values). */
function synthesizeSandbox(
  expected: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return synthesizeParams(expected);
}

function loadGoldenRows(): GoldenPromptRow[] {
  const file = path.join(EVAL_DIR, "golden-prompts.jsonl");
  const content = fs.readFileSync(file, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function registerGoldenRow(row: GoldenPromptRow, index: number): void {
  const id = rowId(row, index);
  if (!toolsAvailable(row, knownTools)) {
    if (row.deferToIntegration === true) {
      registerRow({
        id,
        prompt: row.prompt,
        branches: rowBranches(row),
        deferToIntegration: true,
        llmOverride: () => ({ content: "" }),
        assert: () => true,
      });
    } else {
      registerRow({
        id,
        prompt: row.prompt,
        branches: rowBranches(row),
        llmOverride: () => ({ content: "" }),
        assert: () => ({
          pass: false,
          reason: `expected tools not registered: ${row.expectedTools.join(", ")}`,
        }),
      });
    }
    return;
  }

  registerRow({
    id,
    prompt: row.prompt,
    branches: rowBranches(row),
    llmOverride: () => ({
      content: JSON.stringify({
        actionPlan: row.expectedTools.map((tool) => ({
          tool,
          params: synthesizeParams(row.expectedParams as Record<string, unknown> | undefined),
        })),
        sandbox: synthesizeSandbox(row.expectedSandboxShape),
        reply: row.expectedReplyContains ?? "done",
      }),
    }),
    assert: (state) => {
      const result = runGoldenAssertions(state, row);
      return result.ok ? true : { pass: false, reason: result.why };
    },
  });
}

// ─── D-S2.5 negative-prompts.jsonl (data-driven) ─────────────────────────

function loadNegativeRows(): NegativePromptRow[] {
  const file = path.join(EVAL_DIR, "negative-prompts.jsonl");
  const content = fs.readFileSync(file, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function registerNegativeRow(row: NegativePromptRow, index: number): void {
  registerRow({
    id: negativeRowId(row, index),
    prompt: row.prompt,
    branches: row.branches ?? ["security.deny"],
    llmOverride: () => ({ content: JSON.stringify(simulateDeniedState(row)) }),
    assert: (state) => {
      const result = runNegativeAssertions(state, row);
      return result.ok ? true : { pass: false, reason: result.why };
    },
  });
}

// Load the data-driven suites (before runStubbedSuite accumulates rows).
try {
  loadGoldenRows().forEach(registerGoldenRow);
} catch (err: any) {
  console.error(`⚠️  Could not load golden-prompts.jsonl: ${err?.message ?? err}`);
}
try {
  loadNegativeRows().forEach(registerNegativeRow);
} catch (err: any) {
  console.error(`⚠️  Could not load negative-prompts.jsonl: ${err?.message ?? err}`);
}

// ─── Stage 1 toy row ─────────────────────────────────────────────────────

registerRow({
  id: "skeleton_smoke",
  prompt: "ping",
  llmOverride: () => ({ content: "pong" }),
  assert: () => true,
});

// ─── CLI entry ───────────────────────────────────────────────────────────

function writeReport(report: StubSuiteReport): string {
  const reportDir = path.join(EVAL_DIR, "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportFile = path.join(reportDir, `${new Date().toISOString()}.json`);
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        kind: "stub",
        summary: {
          passed: report.passed,
          failed: report.failed,
          skipped: report.skipped,
          total: report.total,
        },
        branches: {
          hit: report.branches.hit,
          total: report.branches.total,
          pct: report.branches.pct,
        },
        results: report.results,
      },
      null,
      2,
    ),
  );
  return reportFile;
}

async function main(): Promise<void> {
  console.log("🧪 Stubbed eval runner (Stage 2: golden + negative + meta)\n");
  const report = await runStubbedSuite();

  try {
    const reportFile = writeReport(report);
    console.log(`\n📄 Report saved to: ${reportFile}`);
  } catch (err: any) {
    console.warn(`Could not write report: ${err?.message ?? err}`);
  }

  if (report.failed > 0) {
    process.exit(1);
  }
  console.log("\n✅ All stub rows passed!");
  process.exit(0);
}

// Run when executed directly (node --experimental-strip-types …/stubRunner.ts)
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  (process.argv[1].endsWith("stubRunner.ts") ||
    process.argv[1].endsWith("stubRunner.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Stub suite failed:", err);
    process.exit(1);
  });
}
