#!/usr/bin/env node
/**
 * D-S2.6 — eval report history diff.
 *
 * Reads the persisted JSON reports under tests/agent/eval/reports/ and diffs
 * the two most recent runs (or the two passed as positional args):
 *   - pass-rate delta
 *   - regressions (rows that passed before and fail now)
 *   - new failures (rows that newly fail / were absent in the previous run)
 *   - new passes (rows that failed before and pass now)
 *
 * Usage:
 *   node tests/agent/eval/diffReports.js
 *   node tests/agent/eval/diffReports.js <prev.json> <current.json>
 *
 * Exit code: 0 even when regressions exist (this is a reporting tool);
 * the eval suites themselves gate on failures.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPORT_DIR = path.join(process.cwd(), "tests", "agent", "eval", "reports");

function loadReport(file) {
  const content = fs.readFileSync(file, "utf-8");
  const report = JSON.parse(content);
  const byId = new Map();
  const rows = Array.isArray(report.results) ? report.results : [];
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return {
    file,
    timestamp: report.timestamp,
    summary: report.summary ?? { passed: 0, failed: 0, skipped: 0, total: 0 },
    branches: report.branches ?? { hit: [], total: [], pct: 0 },
    byId,
  };
}

function isPass(row) {
  return row.passed === true && row.skipped !== true;
}

function isSkip(row) {
  return row.skipped === true;
}

function main() {
  let files = process.argv.slice(2).filter((a) => a.endsWith(".json"));

  if (files.length === 0) {
    if (!fs.existsSync(REPORT_DIR)) {
      console.error(`No reports directory at ${REPORT_DIR}`);
      process.exit(1);
    }
    files = fs
      .readdirSync(REPORT_DIR)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => !f.startsWith("trace-"))
      .map((f) => path.join(REPORT_DIR, f))
      .sort()
      .slice(-2);
  }

  if (files.length < 2) {
    console.log("Need at least two reports to diff.");
    process.exit(1);
  }

  const [prevFile, curFile] = files;
  const prev = loadReport(prevFile);
  const cur = loadReport(curFile);

  const allIds = new Set([...prev.byId.keys(), ...cur.byId.keys()]);

  const regressions = [];
  const newFailures = [];
  const newPasses = [];
  const bothFailed = [];
  let curPassed = 0;
  let curSkipped = 0;
  let curTotal = 0;

  for (const id of allIds) {
    const prevRow = prev.byId.get(id);
    const curRow = cur.byId.get(id);

    if (!curRow) continue; // removed from the suite — not a failure
    curTotal++;

    if (isSkip(curRow)) {
      curSkipped++;
      continue;
    }
    if (isPass(curRow)) curPassed++;

    const prevPass = prevRow ? isPass(prevRow) : false;
    const curPass = isPass(curRow);

    if (!prevRow) {
      if (!curPass) newFailures.push({ id, prompt: curRow.prompt, reason: curRow.reason ?? curRow.error ?? "failed" });
      continue;
    }
    if (prevPass && !curPass) {
      regressions.push({ id, prompt: curRow.prompt, reason: curRow.reason ?? curRow.error ?? "failed" });
    } else if (!prevPass && curPass) {
      newPasses.push({ id });
    } else if (!prevPass && !curPass) {
      bothFailed.push({ id });
    }
  }

  const prevPassRate =
    prev.summary.total > 0 ? ((prev.summary.passed / prev.summary.total) * 100).toFixed(1) : "0.0";
  const curPassRate =
    curTotal > 0 ? ((curPassed / curTotal) * 100).toFixed(1) : "0.0";

  console.log("=== Eval report diff ===");
  console.log(`  previous: ${prev.file} (${prev.timestamp})`);
  console.log(`  current:  ${cur.file} (${cur.timestamp})`);
  console.log("");
  console.log(`  pass rate:   ${prevPassRate}% → ${curPassRate}% (${curPassed}/${curTotal} passed, ${curSkipped} skipped)`);
  console.log(`  branches:    ${cur.branches.pct}% (${cur.branches.hit.length}/${cur.branches.total.length})`);
  console.log("");
  console.log(`  regressions:  ${regressions.length}`);
  for (const r of regressions) {
    console.log(`    ❌ ${r.id}: "${r.prompt.slice(0, 60)}" — ${r.reason}`);
  }
  console.log(`  new failures: ${newFailures.length}`);
  for (const f of newFailures) {
    console.log(`    ❌ ${f.id}: "${f.prompt.slice(0, 60)}" — ${f.reason}`);
  }
  console.log(`  new passes:   ${newPasses.length}`);
  console.log(`  still failing: ${bothFailed.length}`);
  console.log("");
  if (regressions.length === 0 && newFailures.length === 0) {
    console.log("✅ No regressions — diff is clean.");
  } else {
    console.log(`⚠️  ${regressions.length + newFailures.length} failing row(s) detected.`);
  }
}

main();
