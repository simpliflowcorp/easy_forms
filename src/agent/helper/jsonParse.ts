/**
 * Robust JSON extractor for LLM output.
 *
 * Replaces the greedy /\{[\s\S]*\}/ regex in personas/drafter.ts which
 * grabbed the FIRST `{` to the LAST `}` — on any output with nested
 * braces, code samples, or trailing prose, this matched across the whole
 * payload and JSON.parse then threw, surfacing as "Semantic parsing
 * failed" with the entire ticket rejected (#5).
 *
 * Strategy:
 *   1. If the entire string parses, return it directly.
 *   2. Otherwise, scan for the first balanced `{...}` block and attempt to
 *      parse it. A balanced scan reads `{`/`}` with stack depth and skips
 *      braces inside string literals (handles escaped quotes).
 *   3. On failure, return null so callers can fall back to a clarifying
 *      question instead of throwing into the loop.
 *
 * The extractor never throws. Callers control the failure mode.
 */
export function safeJSON<T = any>(raw: string | undefined | null): T | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Fast path 1: whole string is valid JSON.
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through to balanced extraction */
  }

  // Fast path 2: try to locate a ```json ... ``` fenced block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      /* fall through */
    }
  }

  // Balanced extraction: walk the string, track brace depth, skip strings.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as T;
          } catch {
            // Not valid JSON — keep scanning for the next balanced block.
            start = -1;
          }
        }
      }
    }
  }
  return null;
}
