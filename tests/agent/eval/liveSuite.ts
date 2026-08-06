/**
 * D-S3.5 — live (nightly) golden/negative eval suite. Real LLM + Mongo + Redis.
 * Imported dynamically by tests/agent/eval/runner.ts (the --skip-aware
 * launcher). Writes run reports into tests/agent/eval/reports/<ISO>.json.
 */
import { runAgentLoop } from "@/agent/agentLoop";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import * as fs from "fs";
import * as path from "path";
import { agentToolsSchema } from "@/agent/tools";
import { runGoldenAssertions, rowId, rowBranches, toolsAvailable } from "./fixtures/goldenContract.ts";
import type { GoldenPromptRow } from "./fixtures/goldenContract.ts";
import { runNegativeAssertions } from "./fixtures/negativeContract.ts";
import type { NegativePromptRow } from "./fixtures/negativeContract.ts";

const EVAL_DIR = path.join(process.cwd(), "tests/agent/eval");
const REPORT_DIR = path.join(EVAL_DIR, "reports");

function parseJsonl<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Set of tools registered in the current schema (B's bundles land at the
 *  integration gate; rows gated on them are skipped until then). */
function buildKnownTools(): Set<string> {
  const known = new Set<string>();
  for (const t of agentToolsSchema as any[]) {
    const name = t?.function?.name;
    if (typeof name === "string") known.add(name);
  }
  return known;
}

const knownTools = buildKnownTools();

function tracePath(index: number): string {
  return path.join(REPORT_DIR, `trace-golden-${String(index).padStart(3, "0")}.json`);
}

async function runGoldenPrompt(
  userId: string,
  row: GoldenPromptRow,
  index: number,
): Promise<{ passed: boolean; skipped: boolean; details: string; state: any }> {
  const id = rowId(row, index);

  if (!toolsAvailable(row, knownTools)) {
    if (row.deferToIntegration === true) {
      return {
        passed: true,
        skipped: true,
        details: `SKIPPED (deferred to integration): tools ${row.expectedTools.join(", ")} not registered`,
        state: null,
      };
    }
    return {
      passed: false,
      skipped: false,
      details: `expected tools not registered and row is not deferToIntegration: ${row.expectedTools.join(", ")}`,
      state: null,
    };
  }

  try {
    const state = await runAgentLoop(userId, row.prompt, false, undefined, undefined, () => {});

    const result = runGoldenAssertions(state, row);
    if (!result.ok && state) {
      // D-S2.4 — dump the FULL execution trace to a report JSON on failure
      try {
        if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(
          tracePath(index),
          JSON.stringify(
            {
              rowId: id,
              prompt: row.prompt,
              timestamp: new Date().toISOString(),
              why: result.why,
              executionTrace: state.executionTrace ?? null,
              actionPlan: state.actionPlan ?? null,
              sandbox: state.sandbox ?? null,
              ticket: state.ticket ?? null,
            },
            null,
            2,
          ),
        );
      } catch (err: any) {
        result.details += ` | trace dump failed: ${err?.message ?? err}`;
      }
    }
    return { passed: result.ok, skipped: false, details: result.details, state };
  } catch (error: any) {
    return {
      passed: false,
      skipped: false,
      details: `THREW: ${error.message}`,
      state: null,
    };
  }
}

async function runNegativePrompt(
  userId: string,
  row: NegativePromptRow,
): Promise<{ passed: boolean; details: string; state: any }> {
  try {
    const state = await runAgentLoop(userId, row.prompt, false, undefined, undefined, () => {});
    const result = runNegativeAssertions(state, row);
    return { passed: result.ok, details: result.details, state };
  } catch (error: any) {
    // A throw is only acceptable when the row declares the error kind.
    const kind = String(error?.name ?? error?.constructor?.name ?? "");
    const expected = row.expectErrorKind;
    const ok = !!expected && kind === expected;
    return {
      passed: ok,
      details: ok
        ? `THREW ${kind} (expected ${expected})`
        : `THREW ${kind}: ${error?.message ?? error} (expected deny "${row.expectedDeny}")`,
      state: null,
    };
  }
}

async function main() {
  console.log("🧪 Starting Agent Evaluation...\n");

  await connectDB();

  const goldenRows = parseJsonl<GoldenPromptRow>(path.join(EVAL_DIR, "golden-prompts.jsonl"));
  const negativeRows = parseJsonl<NegativePromptRow>(path.join(EVAL_DIR, "negative-prompts.jsonl"));

  // Find or create a test user
  let testUser = await User.findOne({ email: "eval@test.local" }).lean();
  if (!testUser) {
    testUser = await User.create({
      username: "evaluser",
      email: "eval@test.local",
      password: "test123",
    });
  }
  const userId = testUser._id.toString();

  console.log(`Running ${goldenRows.length} golden prompts + ${negativeRows.length} negative prompts for user ${userId}...\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const results: Array<{ id: string; prompt: string; passed: boolean; skipped?: boolean; details: string; branches?: string[] }> = [];
  const branchesHit = new Set<string>();
  const branchesTotal = new Set<string>();

  for (let i = 0; i < goldenRows.length; i++) {
    const row = goldenRows[i];
    const id = rowId(row, i);
    const branches = rowBranches(row);
    for (const b of branches) branchesTotal.add(b);

    process.stdout.write(`[${i + 1}/${goldenRows.length}] ${row.category}: "${row.prompt.substring(0, 50)}..." `);

    const result = await runGoldenPrompt(userId, row, i);

    if (result.skipped) {
      console.log("⏭️  SKIP (deferred)");
      skipped++;
    } else if (result.passed) {
      console.log("✅ PASS");
      passed++;
      for (const b of branches) branchesHit.add(b);
    } else {
      console.log("❌ FAIL");
      console.log(`   ${result.details}`);
      failed++;
    }

    results.push({
      id,
      prompt: row.prompt,
      passed: result.passed,
      skipped: result.skipped || undefined,
      details: result.details,
      branches,
    });
  }

  for (let i = 0; i < negativeRows.length; i++) {
    const row = negativeRows[i];
    const id = row.id || `negative_${String(i).padStart(2, "0")}`;
    const branches = row.branches ?? ["security.deny"];
    for (const b of branches) branchesTotal.add(b);

    process.stdout.write(`[N${i + 1}/${negativeRows.length}] neg: "${row.prompt.substring(0, 50)}..." `);

    const result = await runNegativePrompt(userId, row);

    if (result.passed) {
      console.log("✅ DENIED AS EXPECTED");
      passed++;
      for (const b of branches) branchesHit.add(b);
    } else {
      console.log("❌ NOT DENIED");
      console.log(`   ${result.details}`);
      failed++;
    }

    results.push({ id, prompt: row.prompt, passed: result.passed, details: result.details, branches });
  }

  const total = goldenRows.length + negativeRows.length;
  const branchPct =
    branchesTotal.size === 0 ? 100 : Math.round((branchesHit.size / branchesTotal.size) * 100);

  console.log(`\n📊 Results: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped (deferred)`);
  console.log(`🌿 Branch coverage: ${branchesHit.size}/${branchesTotal.size} (${branchPct}%)`);

  // D-S2.6 — persist the run report under reports/<ISO>.json
  try {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const reportFile = path.join(REPORT_DIR, `${new Date().toISOString()}.json`);
    fs.writeFileSync(
      reportFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          kind: "live",
          summary: { passed, failed, skipped, total },
          branches: { hit: [...branchesHit], total: [...branchesTotal], pct: branchPct },
          results,
        },
        null,
        2,
      ),
    );
    console.log(`\n📄 Report saved to: ${reportFile}`);
  } catch (err: any) {
    console.warn(`Could not write report: ${err?.message ?? err}`);
  }

  if (failed > 0) {
    console.log("\n❌ Failures:");
    results.filter((r) => !r.passed && !r.skipped).forEach((r) => {
      console.log(`  - "${r.prompt.substring(0, 60)}..."`);
      console.log(`    ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log("\n✅ All golden + negative prompts passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
