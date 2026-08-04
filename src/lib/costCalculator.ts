/**
 * D-S2.2 — Model cost table + cost computation (USD).
 *
 * Pure module (no env/network access) so both the hot LLM path and the eval
 * suite can compute `costUsd` deterministically. Pricing is per 1M tokens,
 * input/output split, keyed by model-id substring so provider-specific ids
 * (e.g. `meta/llama-3.1-8b-instruct` on NVIDIA, `gemini-2.0-flash` on the
 * Gemini OpenAI-compat endpoint) all resolve.
 *
 * The old placeholder ($0.0001 / 1K tokens flat, ~$0.10 / 1M) is preserved as
 * the FALLBACK entry so `agentLoop.ts`'s inline estimate and this table agree
 * for unknown models.
 */

export interface CostTableEntry {
  inputPerM: number;
  outputPerM: number;
}

/** USD per 1M tokens, input/output split. Keys are matched as substrings of
 *  the model id (longest match wins). */
export const MODEL_COST_TABLE: Record<string, CostTableEntry> = {
  "gemini-2.0-flash": { inputPerM: 0.1, outputPerM: 0.4 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10.0 },
  "gemini-1.5-flash": { inputPerM: 0.075, outputPerM: 0.3 },
  "gemini-1.5-pro": { inputPerM: 1.25, outputPerM: 5.0 },
  "llama-3.3": { inputPerM: 0.2, outputPerM: 0.2 },
  "llama-3.1": { inputPerM: 0.2, outputPerM: 0.2 },
  "llama-3": { inputPerM: 0.2, outputPerM: 0.2 },
  "llama": { inputPerM: 0.2, outputPerM: 0.2 },
  "deepseek": { inputPerM: 0.27, outputPerM: 1.1 },
  "mistral-large": { inputPerM: 2.0, outputPerM: 6.0 },
  "mixtral": { inputPerM: 0.2, outputPerM: 0.2 },
  "qwen": { inputPerM: 0.2, outputPerM: 0.2 },
  "phi-3": { inputPerM: 0.1, outputPerM: 0.1 },
  "grok": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10.0 },
  "gpt-4": { inputPerM: 30.0, outputPerM: 60.0 },
  "gpt-3.5": { inputPerM: 0.5, outputPerM: 1.5 },
  "claude": { inputPerM: 3.0, outputPerM: 15.0 },
};

/** Legacy flat placeholder retained as the unknown-model default:
 *  $0.10 per 1M tokens on both sides (matches the loop's $0.0001/1K). */
export const DEFAULT_COST_PER_M: CostTableEntry = { inputPerM: 0.1, outputPerM: 0.1 };

/** Resolve the cost entry for a model id. Longest matching substring wins. */
export function resolveCostTable(model: string): CostTableEntry {
  if (!model) return DEFAULT_COST_PER_M;
  let best: { key: string; entry: CostTableEntry } | null = null;
  const normalized = model.toLowerCase();
  for (const [key, entry] of Object.entries(MODEL_COST_TABLE)) {
    if (normalized.includes(key.toLowerCase())) {
      if (!best || key.length > best.key.length) {
        best = { key, entry };
      }
    }
  }
  return best ? best.entry : DEFAULT_COST_PER_M;
}

export interface ComputeCostInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Compute the estimated USD cost of a single LLM call.
 *  Pure + deterministic; rounds to 6 decimals like the loop's estimate. */
export function computeCostUsd(input: ComputeCostInput): number {
  const table = resolveCostTable(input.model);
  const promptTokens = Math.max(0, Number(input.promptTokens) || 0);
  const completionTokens = Math.max(0, Number(input.completionTokens) || 0);
  const cost =
    (promptTokens / 1_000_000) * table.inputPerM +
    (completionTokens / 1_000_000) * table.outputPerM;
  return Number(cost.toFixed(6));
}

export default { computeCostUsd, resolveCostTable, MODEL_COST_TABLE };
