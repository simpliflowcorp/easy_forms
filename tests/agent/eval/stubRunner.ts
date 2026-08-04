/**
 * Stage 1 — Stubbed eval runner skeleton (D-S1.4 / E2.5 prep).
 *
 * Jest-style row registration for deterministic, LLM-mocked unit eval.
 * Rows mock the LLM via `__testRetryLLMOverride` in `src/lib/llmClient.ts`.
 *
 * Contract (frozen for Agent A + Stage 2):
 *   registerRow({ id, prompt, setup?, llmOverride, assert })
 *   runStubbedSuite()
 *
 * Stage 1 ships ONE toy row (`skeleton_smoke`). Agent A registers defect-fix
 * rows (D0.1–D0.10). Stage 2 populates fixtures/ + negative-prompts.jsonl.
 *
 * Run: node --experimental-strip-types tests/agent/eval/stubRunner.ts
 *   or: npm run agent:eval:stub
 */

import { __testRetryLLMOverride } from "../../../src/lib/llmClient";
import type { LLMMessage, LLMOptions, LLMResult, RetryOptions } from "../../../src/lib/llmClient";

// ─── Types (frozen contract) ─────────────────────────────────────────────

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
};

export type StubRowResult = {
  id: string;
  prompt: string;
  passed: boolean;
  reason?: string;
  error?: string;
};

export type StubSuiteReport = {
  passed: number;
  failed: number;
  total: number;
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
 * Installs `__testRetryLLMOverride` for the duration of each row so agent-loop
 * callers (Agent A chaos rows) hit the mock. Skeleton rows that only exercise
 * the harness invoke `llmOverride` directly and pass a minimal state to assert.
 */
export async function runStubbedSuite(): Promise<StubSuiteReport> {
  const results: StubRowResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const row of registeredRows) {
    const prevOverride = __testRetryLLMOverride.current;
    __testRetryLLMOverride.current = adaptOverride(row.llmOverride);

    try {
      if (row.setup) {
        await row.setup();
      }

      // Invoke the override once so the hook path is exercised even for
      // skeleton rows that do not run the full agent loop.
      const llmResult = await row.llmOverride([], undefined);
      const state = {
        prompt: row.prompt,
        reply: llmResult.content,
        llmResult,
        isComplete: true,
        ticket: { status: "RESOLVED" },
        actionPlan: [],
        iterationCount: 0,
        executionTrace: [],
      };

      const assertion = normalizeAssert(await row.assert(state));
      if (assertion.pass) {
        passed++;
        results.push({ id: row.id, prompt: row.prompt, passed: true });
        console.log(`✅ PASS  ${row.id}`);
      } else {
        failed++;
        results.push({
          id: row.id,
          prompt: row.prompt,
          passed: false,
          reason: assertion.reason,
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
      });
      console.log(`❌ FAIL  ${row.id}: THREW ${message}`);
    } finally {
      __testRetryLLMOverride.current = prevOverride;
    }
  }

  const total = registeredRows.length;
  console.log(`\n📊 Stub suite: ${passed}/${total} passed, ${failed} failed`);
  return { passed, failed, total, results };
}

// ─── Stage 1 toy row ─────────────────────────────────────────────────────

registerRow({
  id: "skeleton_smoke",
  prompt: "ping",
  llmOverride: () => ({ content: "pong" }),
  assert: () => true,
});

// ─── CLI entry ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🧪 Stubbed eval runner (Stage 1 skeleton)\n");
  const report = await runStubbedSuite();

  // Write a lightweight report under reports/ (Stage 2 expands this)
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const reportDir = path.join(process.cwd(), "tests/agent/eval/reports");
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    const reportFile = path.join(
      reportDir,
      `stub-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(
      reportFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          summary: {
            passed: report.passed,
            failed: report.failed,
            total: report.total,
          },
          results: report.results,
        },
        null,
        2,
      ),
    );
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
