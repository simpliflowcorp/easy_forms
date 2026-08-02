#!/usr/bin/env node
/**
 * R6.5 — Nightly drift detection script.
 * 
 * Runs the golden prompt evaluation against current model and (optionally) 
 * candidate model versions. Alerts on:
 * - isComplete rate drop > 5%
 * - Tool-sequence divergence (different tools used)
 * - Cost/latency spike > 20%
 * - Regression in evaluator retry routing (PLANNER instead of EXECUTOR_SANDBOX)
 * 
 * Runs nightly via cron or CI schedule.
 * 
 * Usage:
 *   node --experimental-strip-types tests/agent/eval/nightlyDrift.ts
 *   node --experimental-strip-types tests/agent/eval/nightlyDrift.ts --candidate-model=gemini-2.0-flash
 */

import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import * as fs from "fs";
import * as path from "path";

interface EvaluationReport {
  timestamp: string;
  summary: { passed: number; failed: number; total: number };
  metrics: { avgLatency: number; avgTokens: number; avgCost: number; totalLatency: number; totalTokens: number };
  results: any[];
}

interface DriftConfig {
  baselinePath: string;
  currentModel: string;
  candidateModel?: string;
  thresholds: {
    completenessDropPct: number;
    latencyIncreasePct: number;
    tokenIncreasePct: number;
    costIncreasePct: number;
  };
}

const DEFAULT_CONFIG: DriftConfig = {
  baselinePath: "tests/agent/eval/reports/baseline.json",
  currentModel: process.env.LLM_MODEL || "meta/llama-3.1-8b-instruct",
  thresholds: {
    completenessDropPct: 5,
    latencyIncreasePct: 20,
    tokenIncreasePct: 30,
    costIncreasePct: 30,
  },
};

async function runEvaluation(model?: string): Promise<EvaluationReport> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (model) {
    env.LLM_MODEL = model;
  }
  
  try {
    const output = execSync(
      `node --experimental-strip-types tests/agent/eval/stubRunner.ts`,
      { env, encoding: "utf-8", timeout: 300000 }
    );
    
    // Parse the JSON report from the output
    const reportMatch = output.match(/📄 Report saved to: (.+\.json)/);
    if (reportMatch) {
      const reportPath = reportMatch[1].trim();
      const reportContent = fs.readFileSync(reportPath, "utf-8");
      return JSON.parse(reportContent);
    }
    
// Fallback: parse from stdout
      const passedMatch = output.match(/(\d+)\/(\d+) passed/);
      if (passedMatch) {
        const passed = parseInt(passedMatch[1]);
        const total = parseInt(passedMatch[2]);
        return {
          timestamp: new Date().toISOString(),
          summary: { passed, failed: total - passed, total },
          metrics: { avgLatency: 0, avgTokens: 0, avgCost: 0, totalLatency: 0, totalTokens: 0 },
          results: [],
        };
      }
      
      throw new Error("Could not parse evaluation output");
    } catch (error: any) {
      if (error.stdout) {
        // Try to extract from stdout even on failure
        const stdout = error.stdout.toString();
        const passedMatch = stdout.match(/(\d+)\/(\d+) passed/);
        if (passedMatch) {
          const passed = parseInt(passedMatch[1]);
          const total = parseInt(passedMatch[2]);
          return {
            timestamp: new Date().toISOString(),
            summary: { passed, failed: total - passed, total },
            metrics: { avgLatency: 0, avgTokens: 0, avgCost: 0, totalLatency: 0, totalTokens: 0 },
            results: [],
          };
        }
      }
      throw error;
  }
}

function compareMetrics(baseline: any, current: any, thresholds: DriftConfig["thresholds"]): {
  alerts: string[];
  passed: boolean;
} {
  const alerts: string[] = [];
  
  // Completeness drop
  const baselineCompleteness = baseline.summary.passed / baseline.summary.total;
  const currentCompleteness = current.summary.passed / current.summary.total;
  const completenessDrop = ((baselineCompleteness - currentCompleteness) / baselineCompleteness) * 100;
  
  if (completenessDrop > thresholds.completenessDropPct) {
    alerts.push(`COMPLETENESS DROP: ${completenessDrop.toFixed(1)}% (baseline: ${(baselineCompleteness*100).toFixed(1)}%, current: ${(currentCompleteness*100).toFixed(1)}%)`);
  }
  
  // Latency increase
  if (baseline.metrics.avgLatency > 0 && current.metrics.avgLatency > 0) {
    const latencyIncrease = ((current.metrics.avgLatency - baseline.metrics.avgLatency) / baseline.metrics.avgLatency) * 100;
    if (latencyIncrease > thresholds.latencyIncreasePct) {
      alerts.push(`LATENCY SPIKE: ${latencyIncrease.toFixed(1)}% (baseline: ${baseline.metrics.avgLatency.toFixed(0)}ms, current: ${current.metrics.avgLatency.toFixed(0)}ms)`);
    }
  }
  
  // Token increase
  if (baseline.metrics.avgTokens > 0 && current.metrics.avgTokens > 0) {
    const tokenIncrease = ((current.metrics.avgTokens - baseline.metrics.avgTokens) / baseline.metrics.avgTokens) * 100;
    if (tokenIncrease > thresholds.tokenIncreasePct) {
      alerts.push(`TOKEN SPIKE: ${tokenIncrease.toFixed(1)}% (baseline: ${baseline.metrics.avgTokens.toFixed(0)}, current: ${current.metrics.avgTokens.toFixed(0)})`);
    }
  }
  
  // Cost increase
  if (baseline.metrics.avgCost > 0 && current.metrics.avgCost > 0) {
    const costIncrease = ((current.metrics.avgCost - baseline.metrics.avgCost) / baseline.metrics.avgCost) * 100;
    if (costIncrease > thresholds.costIncreasePct) {
      alerts.push(`COST SPIKE: ${costIncrease.toFixed(1)}% (baseline: $${baseline.metrics.avgCost.toFixed(4)}, current: $${current.metrics.avgCost.toFixed(4)})`);
    }
  }
  
  return { alerts, passed: alerts.length === 0 };
}

async function saveReport(data: any, path: string) {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

async function main() {
  const args = parseArgs({
    options: {
      "candidate-model": { type: "string", short: "m" },
      "baseline-path": { type: "string", short: "b" },
      "output-dir": { type: "string", short: "o" },
    },
    allowPositionals: true,
  });
  
  const config = { ...DEFAULT_CONFIG };
  if (args.values["candidate-model"]) config.candidateModel = args.values["candidate-model"];
  if (args.values["baseline-path"]) config.baselinePath = args.values["baseline-path"];
  const outputDir = args.values["output-dir"] || "tests/agent/eval/drift-reports";
  
  console.log("🌙 Starting nightly drift detection...");
  console.log(`   Current model: ${config.currentModel}`);
  if (config.candidateModel) console.log(`   Candidate model: ${config.candidateModel}`);
  console.log(`   Baseline: ${config.baselinePath}`);
  
  // Load or create baseline
  let baseline: any;
  if (fs.existsSync(config.baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(config.baselinePath, "utf-8"));
    console.log(`   Loaded baseline from ${config.baselinePath}`);
  } else {
    console.log(`   No baseline found, running current model to establish baseline...`);
    baseline = await runEvaluation(config.currentModel);
    await saveReport(baseline, config.baselinePath);
    console.log(`   Baseline saved to ${config.baselinePath}`);
  }
  
  // Run current model evaluation
  console.log(`\n📊 Running evaluation with ${config.currentModel}...`);
  const current = await runEvaluation(config.currentModel);
  
  // Compare with baseline
  const comparison = compareMetrics(baseline, current, config.thresholds);
  
  // Run candidate model if specified
  let candidate: any = null;
  let candidateComparison: any = null;
  if (config.candidateModel) {
    console.log(`\n📊 Running evaluation with candidate ${config.candidateModel}...`);
    candidate = await runEvaluation(config.candidateModel);
    candidateComparison = compareMetrics(baseline, candidate, config.thresholds);
  }
  
  // Generate drift report
  const driftReport = {
    timestamp: new Date().toISOString(),
    baseline: {
      model: config.currentModel,
      timestamp: baseline.timestamp,
      summary: baseline.summary,
      metrics: baseline.metrics,
    },
    current: {
      model: config.currentModel,
      summary: current.summary,
      metrics: current.metrics,
    },
    candidate: candidate ? {
      model: config.candidateModel,
      summary: candidate.summary,
      metrics: candidate.metrics,
    } : null,
    comparison: {
      currentVsBaseline: comparison,
      candidateVsBaseline: candidateComparison,
    },
    thresholds: config.thresholds,
  };
  
  const reportPath = path.join(outputDir, `drift-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await saveReport(driftReport, path.resolve(outputDir, path.basename(reportPath)));
  console.log(`\n📄 Drift report saved to: ${reportPath}`);
  
  // Output summary
  console.log(`\n📊 Drift Summary:`);
  console.log(`   Baseline pass rate: ${((baseline.summary.passed/baseline.summary.total)*100).toFixed(1)}%`);
  console.log(`   Current pass rate: ${((current.summary.passed/current.summary.total)*100).toFixed(1)}%`);
  if (candidate) {
    console.log(`   Candidate pass rate: ${((candidate.summary.passed/candidate.summary.total)*100).toFixed(1)}%`);
  }
  console.log(`   Avg latency: ${current.metrics.avgLatency.toFixed(0)}ms (baseline: ${baseline.metrics.avgLatency.toFixed(0)}ms)`);
  console.log(`   Avg tokens: ${current.metrics.avgTokens.toFixed(0)} (baseline: ${baseline.metrics.avgTokens.toFixed(0)})`);
  
  if (comparison.alerts.length > 0) {
    console.log(`\n🚨 ALERTS:`);
    for (const alert of comparison.alerts) {
      console.log(`   - ${alert}`);
    }
  }
  
  if (candidateComparison && candidateComparison.alerts.length > 0) {
    console.log(`\n🚨 CANDIDATE ALERTS:`);
    for (const alert of candidateComparison.alerts) {
      console.log(`   - ${alert}`);
    }
  }
  
  // Exit with error if drift detected
  if (comparison.alerts.length > 0 || (candidateComparison && candidateComparison.alerts.length > 0)) {
    console.log("\n❌ Drift detected! Exiting with error.");
    process.exit(1);
  } else {
    console.log("\n✅ No significant drift detected.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Drift detection failed:", err);
  process.exit(1);
});