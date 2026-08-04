/**
 * D-S3.5 — live eval entry (distribution of work with liveSuite.ts).
 *
 * `npm run agent:eval:live` invokes this launcher. It exists so `--skip` can
 * pass CI without importing the heavy agent + DB graph (whose top-level
 * imports would otherwise fail on a machine with no Mongo / NVIDIA creds).
 *
 *   npm run agent:eval:live            -> full golden/negative live suite
 *   npm run agent:eval:live -- --skip  -> writes a skip report and exits 0
 *
 * The actual suite lives in liveSuite.ts and is imported dynamically.
 */

import * as fs from "fs";
import * as path from "path";

const EVAL_DIR = path.join(process.cwd(), "tests/agent/eval");
const REPORT_DIR = path.join(EVAL_DIR, "reports");

async function main() {
  console.log("🧪 Starting Agent Evaluation...\n");

  const skipRequested = process.argv.includes("--skip");
  if (skipRequested) {
    // D-S3.5 — a PR touching no agent code can pass CI without DB/Redis/NVIDIA
    // by running the live eval with --skip. No agent graph is imported.
    try {
      if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    } catch (err: any) {
      console.warn(`Could not create report dir: ${err?.message ?? err}`);
    }
    const reportFile = path.join(
      REPORT_DIR,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-skip.json`,
    );
    try {
      fs.writeFileSync(
        reportFile,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            kind: "live",
            skipped: true,
            reason: "--skip flag (no agent code change to evaluate)",
            summary: { passed: 0, failed: 0, skipped: 0, total: 0 },
            results: [],
          },
          null,
          2,
        ),
      );
    } catch (err: any) {
      console.warn(`Could not write skip report: ${err?.message ?? err}`);
    }
    console.log(`⏭️  Live evaluation SKIPPED via --skip. Report: ${reportFile}`);
    process.exit(0);
  }

  await import("./liveSuite.ts");
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});