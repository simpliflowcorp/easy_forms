/**
 * PII Redaction Helper
 *
 * Best-effort, key-name-based redaction for sensitive fields in LLM prompts.
 * Not a full PII classifier — won't catch values in arbitrary keys like
 * "User Email Address". For value-based redaction (email/phone patterns),
 * set AGENT_REDACT_VALUES=1 (default off to avoid false positives).
 *
 * Trace payloads use `redactTracePayload` (D0.6): key-based walk everywhere,
 * plus value-based regex on the `llmRawOutput` string only.
 */

const PII_KEYS = new Set([
  "email",
  "phone",
  "phone_number",
  "mobile",
  "ssn",
  "password",
  "address",
  "zip",
  "postcode",
  "ip_address",
  "user_agent",
]);

const VALUE_REDACTION_PATTERNS = [
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // Phone numbers (various formats)
  /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  // SSN (XXX-XX-XXXX)
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

/** Value-based patterns for trace `llmRawOutput` — tagged replacements. */
const TRACE_VALUE_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  {
    kind: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: "phone",
    pattern:
      /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  },
  {
    kind: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    // 13–19 digit card numbers, optional spaces/dashes between digit groups
    kind: "credit_card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  },
];

export function redactPII<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;

  const redactValues = process.env.AGENT_REDACT_VALUES === "1";

  try {
    return JSON.parse(
      JSON.stringify(payload, (key, value) => {
        // Key-based redaction
        if (typeof key === "string" && PII_KEYS.has(key.toLowerCase())) {
          return "[redacted]";
        }
        // Optional value-based redaction
        if (redactValues && typeof value === "string") {
          let redacted = value;
          for (const pattern of VALUE_REDACTION_PATTERNS) {
            redacted = redacted.replace(pattern, "[redacted]");
          }
          return redacted;
        }
        return value;
      }),
    ) as T;
  } catch {
    return payload;
  }
}

/** Apply email/phone/SSN/credit-card regex redaction to a raw LLM string. */
function redactLlmRawOutputValue(text: string): string {
  let out = text;
  for (const { kind, pattern } of TRACE_VALUE_PATTERNS) {
    // Reset lastIndex for global patterns reused across calls
    pattern.lastIndex = 0;
    out = out.replace(pattern, `[REDACTED:${kind}]`);
  }
  return out;
}

/**
 * Recursive tree-walker for execution-trace payloads (D0.6).
 * - Every object key matching PII_KEYS is replaced with "[redacted]".
 * - The specific key `llmRawOutput` (string) gets value-based regex redaction.
 * Does not mutate the input. Leaves `redactPII` untouched for live LLM context.
 */
export function redactTracePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return walkTraceValue(payload, undefined) as Record<string, unknown>;
}

function walkTraceValue(value: unknown, key: string | undefined): unknown {
  if (typeof key === "string" && PII_KEYS.has(key.toLowerCase())) {
    return "[redacted]";
  }

  if (key === "llmRawOutput" && typeof value === "string") {
    return redactLlmRawOutputValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => walkTraceValue(item, undefined));
  }

  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      out[k] = walkTraceValue(v, k);
    }
    return out;
  }

  return value;
}