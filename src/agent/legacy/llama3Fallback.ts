/**
 * LEGACY fallback for Llama-3.1 emissions of tool calls as text using the
 * `<|python_tag|>` sentinel token. Quarantined here in Phase 3.3 and gated by
 * the `LLM_ALLOW_LEGACY_FALLBACK=1` env var so it does NOT run in production
 * by default.
 *
 * Why this exists: earlier in this codebase the Planner relied on this hack
 * to extract tool calls from Llama-3.1 outputs because some builds of the
 * model would not emit proper function-calling payloads. It hard-coded
 * Llama-specific syntax quirks (`'` → `"`, `True` → `true`, `None` → `null`)
 * into a supposedly generic planner, which would silently degrade other
 * providers and (worse) silently truncate multi-call plans to ONE action
 * since it only pushed the last `<|python_tag|>` match into response.tool_calls.
 *
 * Going forward the Planner requires proper function-calling responses; if
 * the LLM did not emit any, a clean `LLMParseError` surfaces for the loop to
 * act on. This file remains importable for evaluation purposes.
 */
export function parseLlama3PythonTag(content: string): any[] | null {
  if (!content || !content.includes("<|python_tag|>")) return null;

  const matches = content.match(/<\|python_tag\|>(.*)/);
  if (!matches || !matches[1]) return null;

  try {
    let rawJsonStr = matches[1].trim();
    rawJsonStr = rawJsonStr
      .replace(/'/g, '"')
      .replace(/True/g, "true")
      .replace(/False/g, "false")
      .replace(/None/g, "null");
    const parsed = JSON.parse(rawJsonStr);
    if (!parsed || !parsed.name) return null;
    return [
      {
        id: `call_${Date.now()}`,
        function: {
          name: parsed.name,
          arguments: JSON.stringify(parsed.parameters || {}),
        },
      },
    ];
  } catch {
    return null;
  }
}
