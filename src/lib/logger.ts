/**
 * Structured logger skeleton (Stage 1 / L2.4).
 *
 * Thin pino-shaped adapter with the context fields Stage 3 will bind at every
 * persona call: { userId, ticketId, persona, attempt, ms, status, model }.
 *
 * Stage 1 is INTERFACE ONLY — no console.* replacements in the agent tree yet
 * (that lands in Stage 3). Callers may import logInfo/logWarn/logError/child
 * today; the agent loop still uses console.* until Stage 3.
 *
 * Transport: JSON lines to stdout (pino default shape). When `pino` is added
 * as a dependency, swap `writeLine` for `pino({...})` without changing exports.
 */

// TODO Stage 3: wire Azure Application Insights via the appinsights-instrumentation skill.
// import * as appInsights from "applicationinsights";
// appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING).start();

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

function writeLine(
  level: Level,
  bindings: Record<string, unknown>,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  // pino-compatible JSON line: level + time + msg + bindings
  const line = JSON.stringify({
    level,
    time: Date.now(),
    msg,
    ...bindings,
    ...(extra ?? {}),
  });
  process.stdout.write(line + "\n");
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
export function logInfo(
  msg: string,
  extra?: Record<string, unknown>,
): void {
  root.info(msg, extra);
}

/** Log at warn level. */
export function logWarn(
  msg: string,
  extra?: Record<string, unknown>,
): void {
  root.warn(msg, extra);
}

/** Log at error level. */
export function logError(
  msg: string,
  extra?: Record<string, unknown>,
): void {
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
