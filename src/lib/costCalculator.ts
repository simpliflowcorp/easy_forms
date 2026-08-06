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

/**
 * D-S3.4 — per-provider default rate cards (USD per 1M tokens).
 * Used when a model id doesn't match the model table but the serving provider
 * is known (e.g. any provider-agnostic id on the NVIDIA NIM path).
 */
export const PROVIDER_DEFAULTS: Record<string, CostTableEntry> = {
  nvidia: { inputPerM: 0.2, outputPerM: 0.2 },
  google: { inputPerM: 0.1, outputPerM: 0.4 },
  openai: { inputPerM: 0.5, outputPerM: 1.5 },
  anthropic: { inputPerM: 3.0, outputPerM: 15.0 },
  deepseek: { inputPerM: 0.27, outputPerM: 1.1 },
  other: DEFAULT_COST_PER_M,
};

/** D-S3.4 — price for a (provider, model) pair: `{ in, out }` USD per 1M tokens. */
export function priceFor(
  provider: string | undefined,
  model: string,
): { in: number; out: number } {
  const entry = resolveCostTable(model || "");
  // A model-table match wins; otherwise fall back to the provider's card,
  // then to the generic default.
  let effective: CostTableEntry = entry;
  if (entry === DEFAULT_COST_PER_M) {
    const provDefault = provider
      ? PROVIDER_DEFAULTS[provider.toLowerCase()]
      : undefined;
    effective = provDefault ?? DEFAULT_COST_PER_M;
  }
  return { in: effective.inputPerM, out: effective.outputPerM };
}

/** Infer the serving provider from a model id (best-effort, for grouping). */
export function inferProviderFromModel(model: string): string {
  const m = (model || "").toLowerCase();
  if (m.includes("gemini")) return "google";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("gpt")) return "openai";
  if (m.includes("nvidia") || m.includes("meta/") || m.includes("llama")) return "nvidia";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("mistral") || m.includes("mixtral") || m.includes("qwen") || m.includes("phi")) {
    return "nvidia";
  }
  return "other";
}

/** D-S3.4 — aggregated usage summary for a user. */
export interface UsageDayRow {
  date: string; // YYYY-MM-DD (UTC)
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface UsageProviderRow {
  provider: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface UsageSummaryResult {
  userId: string;
  calls: number;
  totalTokens: number;
  totalCostUsd: number;
  perDay: UsageDayRow[];
  perProvider: UsageProviderRow[];
  generatedAt: string;
}

/** Load the AgentUsage model lazily so the pure module stays importable. */
function loadUsageModel(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@/models/agentUsageModel").default;
  } catch {
    return null;
  }
}

function toUtcDay(ts: Date | string | number | undefined): string {
  const d = ts instanceof Date ? ts : new Date(ts ?? Date.now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function roundUsd(n: number): number {
  return Number(n.toFixed(6));
}

/**
 * Derive all-time token + dollar usage with per-day and per-provider
 * breakdowns from `AgentUsage` rows (read-only; never mutates).
 *
 * `modelLoader` is injectable for tests that cannot reach Mongo; the default
 * loads the real Mongoose model.
 */
export async function usageSummary(
  userId: string,
  modelLoader: () => any = loadUsageModel,
): Promise<UsageSummaryResult | null> {
  const Usage = modelLoader();
  if (!Usage) return null;

  const rows = await Usage.find({ userId })
    .lean()
    .sort({ createdAt: 1 })
    .exec();

  const perDayMap = new Map<string, UsageDayRow>();
  const perProviderMap = new Map<string, UsageProviderRow>();

  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const row of rows) {
    const model = row.model || "";
    const tokens = Number(row.totalTokens) || 0;
    const cost = Number(row.costUsd) || 0;
    const provider = inferProviderFromModel(model);

    totalTokens += tokens;
    totalCostUsd += cost;

    const date = toUtcDay(row.createdAt);
    const day = perDayMap.get(date) ?? { date, calls: 0, tokens: 0, costUsd: 0 };
    day.calls += 1;
    day.tokens += tokens;
    day.costUsd = roundUsd(day.costUsd + cost);
    perDayMap.set(date, day);

    const prov = perProviderMap.get(provider) ?? {
      provider,
      calls: 0,
      tokens: 0,
      costUsd: 0,
    };
    prov.calls += 1;
    prov.tokens += tokens;
    prov.costUsd = roundUsd(prov.costUsd + cost);
    perProviderMap.set(provider, prov);
  }

  return {
    userId,
    calls: rows.length,
    totalTokens,
    totalCostUsd: roundUsd(totalCostUsd),
    perDay: [...perDayMap.values()],
    perProvider: [...perProviderMap.values()],
    generatedAt: new Date().toISOString(),
  };
}

export default {
  computeCostUsd,
  resolveCostTable,
  priceFor,
  usageSummary,
  inferProviderFromModel,
  MODEL_COST_TABLE,
};
