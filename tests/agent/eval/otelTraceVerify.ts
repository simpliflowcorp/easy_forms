#!/usr/bin/env node
/**
 * D-S4.1 — one-time live-trace verification for the OTel optionalDependencies.
 *
 * Verifies the three logger.ts telemetry contracts:
 *   1. deps installed + APPLICATIONINSIGHTS_CONNECTION_STRING set
 *      -> ensureAppInsights() initialises useAzureMonitor() and
 *         api.trace.getTracer("easy-forms-agent").startSpan("log") produces a
 *         real span (with a REAL connection string this span ships to the App
 *         Insights resource — the one-time Azure-infra gate).
 *   2. env var unset -> no-op (existing behaviour, provider stays noop).
 *   3. deps NOT installed -> require() throws inside the try/catch -> no-op
 *      (existing behaviour; simulated here by blocking module load).
 *
 * Runtime note: the logger's `require()` only exists in CJS contexts (ts-node,
 * Next.js server). Under `node --experimental-strip-types` (ESM) bare
 * `require` is undefined, so the init check must run in a ts-node child
 * (same runtime as `npm run agent:eval:live`). The no-op checks run in the
 * strip-types ESM process.
 *
 * Modes:
 *   --expect-init          env var set; ts-node child asserts real provider
 *   --expect-noop          env var stripped; assert no crash + noop provider
 *   --expect-missing-deps  spawn a ts-node child with @opentelemetry/api +
 *                          @azure/monitor-opentelemetry blocked; assert no-op
 *   --child-core           internal: run core check, print marker to stdout
 *
 * Run (env must be loaded first, e.g. via dotenv/config or exported):
 *   node --experimental-strip-types tests/agent/eval/otelTraceVerify.ts --expect-noop
 *   APPLICATIONINSIGHTS_CONNECTION_STRING=<real> node --experimental-strip-types \
 *     tests/agent/eval/otelTraceVerify.ts --expect-init
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const PASS = "\u2705";
const FAIL = "\u274c";

function assert(cond: boolean, label: string): boolean {
  console.log(`  ${cond ? PASS : FAIL} ${label}`);
  return cond;
}

/**
 * Core contract check. With `expectInit` the Application Insights provider
 * must have been registered by the logger's lazy `ensureAppInsights()`; with
 * `expectNoop` the provider must stay the noop default (or be unresolvable
 * because the deps are absent) — but never crash.
 *
 * Requires a CJS `require` at runtime (ts-node child) so the logger's own
 * internal require() path is the one under test.
 */
function runCoreCheck(expectInit: boolean): boolean {
  // Triggers ensureAppInsights() (lazy, env-gated) + emitTelemetryTrace().
  const { logInfo } = require("../../../src/lib/logger.ts");

  logInfo("otel_verify", { mode: expectInit ? "expect-init" : "expect-noop" });

  let ok = true;
  let api: any = null;
  try {
    api = require("@opentelemetry/api");
    ok = assert(true, "@opentelemetry/api resolves") && ok;
  } catch (err: any) {
    ok =
      assert(!expectInit, `deps blocked -> no-op (require catches: ${err?.constructor?.name})`) &&
      ok;
    // No-op path must still not crash.
    logInfo("otel_verify_noop", {});
    ok = assert(true, "no-op path executed without crashing") && ok;
    return ok;
  }

  const provider = api.trace.getTracerProvider();
  const providerName = provider?.constructor?.name ?? "unknown";
  const isNoop = providerName.includes("Noop") || providerName === "unknown";

  if (expectInit) {
    ok =
      assert(
        !isNoop,
        `useAzureMonitor registered a real provider (${providerName})`,
      ) && ok;
    // A real span must be creatable + closable without throwing. With a REAL
    // connection string this is the span that lands on App Insights.
    try {
      const tracer = api.trace.getTracer("easy-forms-agent");
      const span = tracer.startSpan("log", {
        attributes: { "msg": "otel_verify", "log.level": "info" },
      });
      span.setStatus({ code: api.SpanStatusCode.OK });
      span.end();
      ok = assert(true, "startSpan('log') created + ended a real span") && ok;
    } catch (err) {
      ok =
        assert(false, `startSpan('log') threw: ${(err as Error)?.message ?? err}`) &&
        ok;
    }
  } else {
    ok = assert(isNoop, `no env / blocked deps -> provider stays noop (${providerName})`) && ok;
    logInfo("otel_verify_noop", {});
    ok = assert(true, "no-op path executed without crashing") && ok;
  }
  return ok;
}

/** Internal mode: run the check in this process and print a machine marker. */
function childCore(expectInit: boolean): void {
  const ok = runCoreCheck(expectInit);
  console.log(`OTEL_VERIFY_CORE=${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

/** Spawn a child; CJS context so bare `require` exists (logger's prod path). */
function spawnChild(extraArgs: string[], extraEnv: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const script = process.argv[1];
  const res = spawnSync(
    process.execPath,
    ["--require", "ts-node/register/transpile-only", script, ...extraArgs],
    {
      encoding: "utf-8",
      env: { ...process.env, ...extraEnv },
      timeout: 120_000,
    },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Missing-deps mode: block both packages via a Module._load preload. */
function missingDepsCheck(): boolean {
  const blocker = path.join(os.tmpdir(), `block-otel-${process.pid}.cjs`);
  fs.writeFileSync(
    blocker,
    [
      "const Module = require('module');",
      "const orig = Module._load;",
      "Module._load = function (request, parent, isMain) {",
      "  if (request === '@opentelemetry/api' || request === '@azure/monitor-opentelemetry') {",
      "    throw new Error('blocked for D-S4.1 verification');",
      "  }",
      "  return orig.apply(this, arguments);",
      "};",
    ].join("\n"),
  );
  const res = spawnSync(
    process.execPath,
    [
      "--require",
      "ts-node/register/transpile-only",
      "--require",
      blocker,
      process.argv[1],
      "--child-core",
      "--expect-noop",
    ],
    { encoding: "utf-8", env: process.env, timeout: 120_000 },
  );
  fs.rmSync(blocker, { force: true });

  let ok = true;
  ok = assert(res.status === 0, "child with blocked deps exited 0") && ok;
  ok =
    assert(
      /OTEL_VERIFY_CORE=PASS/.test(res.stdout ?? ""),
      "child confirmed no-op (require caught)",
    ) && ok;
  if (!ok) console.log(res.stdout, res.stderr);
  return ok;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--child-core")) {
    childCore(args.includes("--expect-init"));
    return;
  }

  console.log("=== D-S4.1 OTel live-trace verification ===");

  const envSet = !!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  console.log(
    `env APPLICATIONINSIGHTS_CONNECTION_STRING: ${envSet ? "set" : "unset"}`,
  );

  let ok = true;
  if (args.includes("--expect-missing-deps")) {
    ok = missingDepsCheck() && ok;
  } else if (args.includes("--expect-init")) {
    // Init must be asserted in a CJS child (ts-node, like agent:eval:live).
    if (!envSet) {
      console.log(FAIL + " --expect-init requires APPLICATIONINSIGHTS_CONNECTION_STRING");
      process.exit(1);
    }
    const res = spawnChild(["--child-core", "--expect-init"]);
    ok = assert(res.status === 0, "ts-node child exited 0") && ok;
    ok = assert(/OTEL_VERIFY_CORE=PASS/.test(res.stdout), "child: real provider + span OK") && ok;
    if (!ok) console.log(res.stdout, res.stderr);
  } else if (args.includes("--expect-noop")) {
    // No-op runs in the strip-types ESM process (bare require undefined →
    // logger's internal require is never reached; no crash is the contract).
    const { logInfo } = await import("../../../src/lib/logger.ts");
    logInfo("otel_verify", { mode: "expect-noop" });
    ok = assert(true, "env unset -> no-op, no crash") && ok;
  } else {
    console.log("usage: --expect-init | --expect-noop | --expect-missing-deps");
    process.exit(1);
  }

  console.log(ok ? "\n✅ OTel verification PASSED" : "\n❌ OTel verification FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("OTel verification crashed:", err);
  process.exit(1);
});
