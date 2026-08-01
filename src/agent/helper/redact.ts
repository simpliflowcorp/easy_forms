/**
 * PII Redaction Helper
 * 
 * Best-effort, key-name-based redaction for sensitive fields in LLM prompts.
 * Not a full PII classifier — won't catch values in arbitrary keys like
 * "User Email Address". For value-based redaction (email/phone patterns),
 * set AGENT_REDACT_VALUES=1 (default off to avoid false positives).
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