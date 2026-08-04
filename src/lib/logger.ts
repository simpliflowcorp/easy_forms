/**
 * Structured logger (D-S3.2).
 *
 * Named child loggers with bound context + Azure Application Insights adapter.
 *
 * Transport #1 (always): pino-compatible JSON lines to stdout. Tests and CI
 * parse this exact shape, so it is deterministic and cheap — do not remove it.
 *
 * Transport #2 (opt-in): Azure Application Insights via
 * `@azure/monitor-opentelemetry`'s `useAzureMonitor()`, activated only when
 * `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. It auto-tracks HTTP
 * requests + dependencies (including outbound LLM calls) per the
 * appinsights-instrumentation skill. When unset, the adapter is never
 * initialised and `@azure/*` is never imported, so dev/test pay no cost.
 *
 * Usage:
 *   import { child, logInfo } from "@/lib/logger";
 *   const log = child({ userId, ticketId, persona: "DRAFTER" });
 *   log.info("turn_start", { ms, model });
 *   logInfo("boot", { status: "ok" }); // root logger, no binding
 */

// Application Insights wiring is lazy + best-effort: sourcing it here keeps the
// agent tree (Agent A's Stage-3 console→pino swap) importable without the SDK.
import type * as TelemetryApi from "@opentelemetry/api";

/** Canonical context fields for agent LLMOps correlation. */
export interface LogContext {
  userId?: string;
  ticketId?: string;
  persona?: string;
  attempt?: number;
  ms?: number;
  status?: string;
  model?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

type Level = "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Application Insights adapter (lazy, env-gated, fail-closed to no-op).
// ---------------------------------------------------------------------------

let appInsightsSetupAttempted = false;
let opentelemetry: typeof TelemetryApi | null = null;

/** Severity mapping for the OTel trace (best-effort). */
const SEVERITY_TEXT: Record<Level, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

/**
 * Initialise Application Insights exactly once. No-op when the env var is
 * unset or the SDK is unavailable (the SDK import can throw under some
 * bundlers / lockfiles). Never throws out to callers.
 */
function ensureAppInsights(): void {
  if (appInsightsSetupAttempted) return;
  appInsightsSetupAttempted = true;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const azureMonitor = require("@azure/monitor-opentelemetry") as typeof import("@azure/monitor-opentelemetry");
    // Apply the global distro for request/dependency auto-instrumentation.
    // `azureMonitorExporterOptions.connectionString` mirrors the env var
    // contract from the appinsights-instrumentation skill.
    azureMonitor.useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    opentelemetry = require("@opentelemetry/api") as typeof TelemetryApi;
  } catch {
    // App Insights is additive; a failing adapter must never break the app.
    opentelemetry = null;
  }
}

/** Best-effort OTel trace emission; core log line already written to stdout. */
function emitTelemetryTrace(
  level: Level,
  bindings: Record<string, unknown>,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  ensureAppInsights();
  if (!opentelemetry) return;
  try {
    const api = opentelemetry;
    const now = Date.now();
    const tracer = api.trace.getTracer("easy-forms-agent");
    const span = tracer.startSpan("log", {
      attributes: {
        "msg": msg,
        "log.level": level,
        ...sanitizeAttributes(bindings),
        ...sanitizeAttributes(extra ?? {}),
      },
      startTime: now,
    });
    span.setStatus({ code: level === "error" ? api.SpanStatusCode.ERROR : api.SpanStatusCode.OK });
    span.end(now);
  } catch {
    // no-op — telemetry must never crash the hot path
  }
}

/** Drop non-string/number/boolean attributes so OTel doesn't reject them. */
function sanitizeAttributes(ctx: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (v !== null) {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        // skip unserializable attributes
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core line writer + logger factory.
// ---------------------------------------------------------------------------

function writeLine(
  level: Level,
  bindings: Record<string, unknown>,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    time: Date.now(),
    msg,
    ...bindings,
    ...(extra ?? {}),
  });
  process.stdout.write(line + "\n");
  emitTelemetryTrace(level, bindings, msg, extra);
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    info(msg, extra) {
      writeLine("info", bindings, msg, extra);
    },
    warn(msg, extra) {
      writeLine("warn", bindings, msg, extra);
    },
    error(msg, extra) {
      writeLine("error", bindings, msg, extra);
    },
    child(context) {
      return createLogger({ ...bindings, ...context });
    },
  };
}

const root = createLogger();

/** Log at info level (optionally with context fields). */
export function logInfo(msg: string, extra?: Record<string, unknown>): void {
  root.info(msg, extra);
}

/** Log at warn level. */
export function logWarn(msg: string, extra?: Record<string, unknown>): void {
  root.warn(msg, extra);
}

/** Log at error level. */
export function logError(msg: string, extra?: Record<string, unknown>): void {
  root.error(msg, extra);
}

/**
 * Bind context fields for subsequent log lines.
 * Example: `const log = child({ userId, ticketId, persona: "DRAFTER" });`
 */
export function child(context: Record<string, unknown>): Logger {
  return root.child(context);
}

export default { logInfo, logWarn, logError, child };