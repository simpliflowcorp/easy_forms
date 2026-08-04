/**
 * D-S2.4 — shared subset shape matcher for eval assertions.
 *
 * Used by BOTH `runner.ts` (live, against the real loop's final state) and
 * `stubRunner.ts` (simulated state) so the two harnesses assert the exact
 * same contracts for `expectedParams` / `expectedSandboxShape` /
 * `expectedReplyContains`.
 *
 * Matching semantics (leaf tokens):
 *   "*"                    → value must be present (not null/undefined)
 *   "string"|"number"|"boolean"|"object"|"array" → typeof / Array.isArray match
 *   { ... }                → subset match: every expected key must exist on
 *                            actual and match recursively; the special key
 *                            "*" is a record wildcard: every entry of the
 *                            actual record must match its pattern
 *   [] / [{ ... }]         → actual must be an array; the pattern item (if
 *                            any) is matched against each array element
 *   any other primitive     → deep equality
 */

export type ExpectedShape = unknown;

export function shapeMatches(
  actual: unknown,
  expected: ExpectedShape,
  path = "$",
): { ok: boolean; why?: string } {
  if (expected === "*") {
    if (actual === undefined || actual === null) {
      return { ok: false, why: `${path}: expected a value, got ${String(actual)}` };
    }
    return { ok: true };
  }

  if (typeof expected === "string") {
    switch (expected) {
      case "string":
        return typeof actual === "string"
          ? { ok: true }
          : { ok: false, why: `${path}: expected string, got ${typeof actual}` };
      case "number":
        return typeof actual === "number"
          ? { ok: true }
          : { ok: false, why: `${path}: expected number, got ${typeof actual}` };
      case "boolean":
        return typeof actual === "boolean"
          ? { ok: true }
          : { ok: false, why: `${path}: expected boolean, got ${typeof actual}` };
      case "object":
        return typeof actual === "object" && actual !== null && !Array.isArray(actual)
          ? { ok: true }
          : { ok: false, why: `${path}: expected object, got ${typeof actual}` };
      case "array":
        return Array.isArray(actual)
          ? { ok: true }
          : { ok: false, why: `${path}: expected array, got ${typeof actual}` };
      default:
        return actual === expected
          ? { ok: true }
          : { ok: false, why: `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
    }
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { ok: false, why: `${path}: expected array, got ${typeof actual}` };
    }
    if (expected.length === 0) {
      return { ok: true };
    }
    const pattern = expected[0];
    for (let i = 0; i < actual.length; i++) {
      const item = shapeMatches(actual[i], pattern, `${path}[${i}]`);
      if (!item.ok) return item;
    }
    return { ok: true };
  }

  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return { ok: false, why: `${path}: expected object, got ${typeof actual}` };
    }
    const actualObj = actual as Record<string, unknown>;

    // Record wildcard: {"*": pattern} matches when EVERY entry of the record
    // satisfies pattern (used for sandbox `forms`/`customViews` maps keyed by
    // idempotencyKey / _id).
    if ("*" in expected) {
      const wildcardPattern = (expected as Record<string, unknown>)["*"];
      const keys = Object.keys(actualObj);
      if (keys.length === 0) {
        return { ok: false, why: `${path}: record wildcard matched an empty record` };
      }
      for (const key of keys) {
        const sub = shapeMatches(actualObj[key], wildcardPattern, `${path}.${key}`);
        if (!sub.ok) return sub;
      }
      return { ok: true };
    }

    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!(key in actualObj)) {
        return { ok: false, why: `${path}.${key}: missing` };
      }
      const sub = shapeMatches(actualObj[key], expectedValue, `${path}.${key}`);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }

  return actual === expected
    ? { ok: true }
    : { ok: false, why: `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
}

/** Collect the first failure reason across several shape checks. */
export function checkAll(checks: { name: string; ok: boolean; why?: string }[]): {
  ok: boolean;
  why?: string;
} {
  for (const check of checks) {
    if (!check.ok) {
      return { ok: false, why: `${check.name}: ${check.why ?? "mismatch"}` };
    }
  }
  return { ok: true };
}

export default { shapeMatches, checkAll };
