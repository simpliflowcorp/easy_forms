import { computeCostUsd } from "./costCalculator.ts";
import { child, logWarn } from "./logger.ts";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Used for tool responses
  tool_calls?: any[]; // Used when assistant calls a tool
}

/**
 * Persona ids used for per-persona model + temperature resolution (L2.1).
 * Canonical source of truth is Agent A's `src/agent/types.ts`
 * (`PersonaStage`); this is the temperature-relevant subset. If Agent A ships
 * a `Persona` union in `types.ts`, this type can be aliased to it at the
 * integration gate — the record below stays structurally identical.
 */
export type Persona =
  | "DRAFTER"
  | "PLANNER"
  | "EXECUTOR"
  | "EVALUATOR"
  | "COMMUNICATOR";

/**
 * L2.1 — per-persona temperature defaults.
 * DRAFTER  0.2 (creative field drafting)
 * PLANNER  0.2 (schema planning, still exploratory)
 * EXECUTOR 0.0 (deterministic tool-call generation)
 * EVALUATOR 0.0 (deterministic QA decisions)
 * COMMUNICATOR 0.7 (natural, friendly user-facing replies)
 */
export const PERSONA_TEMPERATURES: Record<Persona, number> = {
  DRAFTER: 0.2,
  PLANNER: 0.2,
  EXECUTOR: 0.0,
  EVALUATOR: 0.0,
  COMMUNICATOR: 0.7,
};

/** Env override per persona, e.g. LLM_MODEL_DRAFTER → DRAFTER. */
const PERSONA_MODEL_ENV: Record<Persona, string> = {
  DRAFTER: "LLM_MODEL_DRAFTER",
  PLANNER: "LLM_MODEL_PLANNER",
  EXECUTOR: "LLM_MODEL_EXECUTOR",
  EVALUATOR: "LLM_MODEL_EVALUATOR",
  COMMUNICATOR: "LLM_MODEL_COMMUNICATOR",
};

const PERSONA_LOOKUP: Record<string, Persona> = {
  drafter: "DRAFTER",
  planner: "PLANNER",
  executor: "EXECUTOR",
  evaluator: "EVALUATOR",
  communicator: "COMMUNICATOR",
};

/** Case-insensitive persona normalization ("drafter" → "DRAFTER"). */
export function normalizePersona(persona: string | undefined): Persona | undefined {
  if (!persona) return undefined;
  return PERSONA_LOOKUP[persona.trim().toLowerCase()];
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  tools?: any[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  onChunk?: (chunk: string) => void;
  /**
   * L2.1 — optional persona id. When set and the caller did not pass an
   * explicit `model`/`temperature`, they are resolved from the per-persona
   * env overrides (`LLM_MODEL_DRAFTER` …) + `PERSONA_TEMPERATURES`. The
   * resolution happens BEFORE the `__testRetryLLMOverride` test hook so
   * stub assertions observe the resolved values in `options`.
   */
  persona?: string;
  /** Optional correlation fields surfaced in the pino log line (D-S2.3). */
  userId?: string;
  ticketId?: string;
}

/**
 * R2.1 — per-call token-cost accounting.
 *
 * Provider-agnostic usage shape, normalised from the raw provider payloads:
 *   - NVIDIA NIM / OpenAI-compat: `{ usage: { prompt_tokens, completion_tokens, total_tokens } }`
 *     present on `data.usage` in non-streaming, and in the final `data:` chunk
 *     immediately preceding `[DONE]` when `stream_options.include_usage = true`
 *     (both NVIDIA and Gemini-OpenAI-compat honour this).
 *   - Raw Gemini SDK shape `{ promptTokenCount, candidatesTokenCount, totalTokenCount }`
 *     is not used by this codebase (we route via the OpenAI-compat endpoint),
 *     but `parseUsage` accepts it defensively so the helper stays robust to a
 *     future provider change.
 *
 * `costUsd` is NOT computed here — model-specific pricing is added by the
 * downstream persistence layer (R2.2) once we have a stable `AgentUsage` row,
 * since per-model cost tables update at deployment, not in the hot path.
 */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

export interface LLMResult {
  role?: string;
  content: string;
  tool_calls?: any[];
  usage?: LLMUsage;
  /** D-S2.2 — estimated USD cost of this call (via costCalculator.ts).
   *  Additive; the loop's persistence path still computes its own estimate. */
  costUsd?: number;
  /** D-S3.1 — true when served over a healthy SSE stream (callLLMStream). */
  streamed?: boolean;
}

/** Normalize the raw provider usage blob (which may be `undefined`) into
 *  the canonical `LLMUsage` shape. Returns `null` if the upstream payload
 *  has no usable token counts — callers may then leave `usage` undefined
 *  rather than fabricate zeros (which would muddy the budget math). */
function parseUsage(rawUsage: any, model: string): LLMUsage | null {
  if (!rawUsage || typeof rawUsage !== "object") return null;

  const promptTokens =
    rawUsage.prompt_tokens ??
    rawUsage.promptTokenCount ??
    rawUsage.input_tokens ??
    rawUsage.inputTokens ??
    0;
  const completionTokens =
    rawUsage.completion_tokens ??
    rawUsage.candidatesTokenCount ??
    rawUsage.output_tokens ??
    rawUsage.outputTokens ??
    0;
  const totalTokens =
    rawUsage.total_tokens ??
    rawUsage.totalTokenCount ??
    (Number(promptTokens) + Number(completionTokens));

  // If every field is 0 / missing, the upstream didn't actually return usage
  // (some Gemini response shapes omit it entirely when bypassed for
  // non-billable reasons). Treat that as null.
  if (!promptTokens && !completionTokens && !totalTokens) return null;

  return {
    promptTokens: Number(promptTokens) || 0,
    completionTokens: Number(completionTokens) || 0,
    totalTokens: Number(totalTokens) || 0,
    model,
  };
}

/** Distinct error classes so the Evaluator / loop can reason about cause (#21).
 *  Previously every LLM failure was a generic Error — `LLM_ERROR` ticket status
 *  conflated offline, rate-limit, and parse failures. */
export class LLMOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMOfflineError";
  }
}
export class LLMRateLimitError extends Error {
  public status: number;
  constructor(message: string, status: number = 429) {
    super(message);
    this.name = "LLMRateLimitError";
    this.status = status;
  }
}
export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}
export class LLMHTTPError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LLMHTTPError";
    this.status = status;
  }
}
export class LLMParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMParseError";
  }
}

/** R2.3 — thrown when per-ticket or per-user-daily token budget is exceeded.
 *  Evaluator / loop catches this and routes to COMMUNICATOR with a friendly message. */
export class LLMBudgetExceededError extends Error {
  public budgetType: "per_ticket" | "per_day";
  constructor(message: string, budgetType: "per_ticket" | "per_day") {
    super(message);
    this.name = "LLMBudgetExceededError";
    this.budgetType = budgetType;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalize any thrown value into one of our typed errors. */
function classifyError(err: any): Error {
  if (err instanceof Error && [
    "LLMOfflineError",
    "LLMRateLimitError",
    "LLMTimeoutError",
    "LLMHTTPError",
  ].includes(err.name)) {
    return err as Error;
  }
  // AbortController trip → LLMTimeoutError
  if (err?.name === "AbortError") return new LLMTimeoutError("LLM request aborted (timeout).");
  // Network / DNS / connection failures → LLMOfflineError
  if (err?.code && ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"].includes(err.code)) {
    return new LLMOfflineError(`LLM network error: ${err.code}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Provider override used by the D-S2.2 fallback path. */
export interface ProviderOverride {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * L2.1 — resolve `model` + `temperature` for a call that carries a `persona`.
 * - model: `LLM_MODEL_<PERSONA>` env override, falling back to `LLM_MODEL`
 *   (which in turn falls back to the provider default inside `callOnce`).
 * - temperature: `PERSONA_TEMPERATURES[persona]`.
 * Explicit caller-supplied `options.model` / `options.temperature` always win.
 */
export function resolvePersonaLLMOptions(options: LLMOptions): Partial<LLMOptions> {
  const persona = normalizePersona(options.persona);
  if (!persona) return {};

  const resolved: Partial<LLMOptions> = {};
  if (!options.model) {
    const envVar = PERSONA_MODEL_ENV[persona];
    resolved.model = process.env[envVar] || process.env.LLM_MODEL;
  }
  if (options.temperature === undefined) {
    resolved.temperature = PERSONA_TEMPERATURES[persona];
  }
  return resolved;
}

/** Per-persona resolved model (L2.1) for prompt-loader metadata. */
export function personaModelFor(persona: string): string | undefined {
  const normalized = normalizePersona(persona);
  if (!normalized) return undefined;
  return process.env[PERSONA_MODEL_ENV[normalized]] || process.env.LLM_MODEL;
}

/** Per-persona resolved temperature (L2.1) for prompt-loader metadata. */
export function personaTemperatureFor(persona: string): number | undefined {
  const normalized = normalizePersona(persona);
  if (!normalized) return undefined;
  return PERSONA_TEMPERATURES[normalized];
}

async function callOnce(
  messages: LLMMessage[],
  options: LLMOptions,
  timeoutMs: number,
  providerOverride?: ProviderOverride,
): Promise<any> {
  const provider = providerOverride?.provider || process.env.LLM_PROVIDER || "nvidia";

  let apiKey: string | undefined;
  let baseUrl: string;
  let defaultModel: string;

  if (provider === "google") {
    apiKey = providerOverride?.apiKey ?? process.env.GEMINI_API_KEY;
    baseUrl =
      providerOverride?.baseUrl ??
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    defaultModel = process.env.LLM_MODEL || "gemini-2.0-flash";
  } else {
    apiKey = providerOverride?.apiKey ?? process.env.NVIDIA_API_KEY;
    baseUrl =
      providerOverride?.baseUrl ??
      "https://integrate.api.nvidia.com/v1/chat/completions";
    defaultModel = process.env.LLM_MODEL || "meta/llama-3.1-8b-instruct";
  }

  if (!apiKey) {
    throw new LLMOfflineError(`Missing API Key for provider: ${provider}`);
  }

  const payload = {
    model: options.model || defaultModel,
    messages,
    temperature: options.temperature ?? 0.2,
    top_p: options.top_p ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    stream: !!options.onChunk,
    // R2.1: ask the OpenAI-compat endpoint to include a final usage chunk
    // before [DONE] when streaming. NVIDIA NIM and Gemini-OpenAI-compat both
    // honour this; harmless if ignored. Non-streaming always has data.usage.
    stream_options: options.onChunk ? { include_usage: true } : undefined,
    response_format: options.response_format,
    tools: options.tools,
    tool_choice: options.tool_choice,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new LLMOfflineError(`LLM auth error: ${res.status} - ${errBody}`);
      }
      if (res.status === 429) {
        throw new LLMRateLimitError(`LLM rate limited: ${res.status} - ${errBody}`, 429);
      }
      throw new LLMHTTPError(res.status, `LLM API Error: ${res.status} - ${errBody}`);
    }

    if (!options.onChunk) {
      const data = await res.json();
      const message = data.choices?.[0]?.message || { role: "assistant", content: "" };
      const usage = parseUsage(data.usage, payload.model);
      // Preserve existing caller-visible shape `.content` / `.tool_calls` /
      // `.role` (additive), and attach `.usage` if the provider returned one.
      // R2.1: callers may opt-in to reading usage; all current callers only
      // read `.content` / `.tool_calls` so this is backwards-compatible.
      return { ...message, usage };
    }

    if (!res.body) throw new Error("No response body for streaming");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullContent = "";
    let buffer = "";
    let thoughtProcessCaptured = "";
    const toolCallsMap = new Map<number, any>();
    // R2.1: providers emit usage in the FINAL data: chunk before [DONE] when
    // `stream_options.include_usage = true` is honoured (NVIDIA NIM,
    // Gemini-OpenAI-compat). Some providers may not honour it; in that case
    // `parsedUsage` stays null and we simply don't attach it. We pick the
    // latest non-null usage we see (the final chunk is the authoritative one).
    let parsedUsage: LLMUsage | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (part.startsWith("data: ")) {
          const dataStr = part.slice(6);
          if (dataStr.trim() === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            // R2.1: capture usage from the final chunk; the OpenAI-compat
            // shape is `{ usage: { ... } }` on a stub `choices: []` chunk
            // emitted just before [DONE]. We overwrite (don't accumulate)
            // because usage is cumulative for the whole response, not a
            // per-chunk delta.
            const chunkUsage = parseUsage(data.usage, payload.model);
            if (chunkUsage) parsedUsage = chunkUsage;

            const deltaContent = data.choices?.[0]?.delta?.content;
            if (deltaContent) {
              fullContent += deltaContent;
              if (options.onChunk) {
                if (options.response_format?.type === "json_object") {
                  const searchStr = '"thoughtProcess"';
                  const startIdx = fullContent.indexOf(searchStr);
                  if (startIdx !== -1) {
                    const colonIdx = fullContent.indexOf(':', startIdx + searchStr.length);
                    if (colonIdx !== -1) {
                      const quoteIdx = fullContent.indexOf('"', colonIdx + 1);
                      if (quoteIdx !== -1) {
                        let endIdx = -1;
                        let isEscaped = false;
                        for (let i = quoteIdx + 1; i < fullContent.length; i++) {
                          if (fullContent[i] === '\\' && !isEscaped) {
                            isEscaped = true;
                          } else if (fullContent[i] === '"' && !isEscaped) {
                            endIdx = i;
                            break;
                          } else {
                            isEscaped = false;
                          }
                        }
                        const currentEndIdx = endIdx !== -1 ? endIdx : fullContent.length;
                        const currentThought = fullContent.substring(quoteIdx + 1, currentEndIdx);
                        const unescapedThought = currentThought.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        if (unescapedThought.length > thoughtProcessCaptured.length) {
                          const newChunk = unescapedThought.substring(thoughtProcessCaptured.length);
                          thoughtProcessCaptured += newChunk;
                          options.onChunk(newChunk);
                        }
                      }
                    }
                  }
                } else {
                  options.onChunk(deltaContent);
                }
              }
            }
            
            const deltaToolCalls = data.choices?.[0]?.delta?.tool_calls;
            if (deltaToolCalls) {
              for (const tcDelta of deltaToolCalls) {
                const idx = tcDelta.index;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tcDelta.id || "",
                    type: tcDelta.type || "function",
                    function: {
                      name: tcDelta.function?.name || "",
                      arguments: tcDelta.function?.arguments || ""
                    }
                  });
                } else {
                  const existing = toolCallsMap.get(idx);
                  if (tcDelta.id) existing.id += tcDelta.id;
                  if (tcDelta.function?.name) existing.function.name += tcDelta.function.name;
                  if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
                }
              }
            }
          } catch (e) {
            // ignore parse errors for partial SSE blocks
          }
        }
      }
    }
    
    const result: any = { role: "assistant", content: fullContent };
    const tool_calls = Array.from(toolCallsMap.values());
    if (tool_calls.length > 0) {
      result.tool_calls = tool_calls;
    }
    // R2.1: attach the per-call usage if the provider emitted it. Stays
    // undefined if the provider ignored stream_options.include_usage; the
    // downstream budget math handles a missing `usage` field gracefully
    // (treats it as "no cost row recorded for this call", not as zero-cost).
    if (parsedUsage) {
      result.usage = parsedUsage;
    }
    return result;
  } catch (err: any) {
    // Convert after the fact so callers either see a typed error or the raw one.
    throw classifyError(err);
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
}

/**
 * Call the LLM with bounded retry/backoff for rate-limit / transient HTTP issues.
 * Previously a 429 would throw on the first attempt and the entire agent loop
 * would consume one of its three retry iterations before the user ever saw an
 * error (#21). The original 6,000,000 ms (100-minute) AbortController timeout
 * was also a bug — `fetch` could hang a user request for the duration of a
 * whole meeting. It's now bounded by LLM_TIMEOUT_MS (default 30s).
 */
/**
 * Test-only hook: if set, retryLLM will call this instead of making real LLM calls.
 * Only for use in tests. Set to undefined to restore real behavior.
 */
export const __testRetryLLMOverride = {
  current: undefined as ((messages: LLMMessage[], options: LLMOptions, retry: RetryOptions) => Promise<LLMResult>) | undefined,
};

/**
 * D-S2.2 — primary attempt wrapped with a transparent secondary-provider
 * fallback. ONLY `LLMOfflineError` triggers the fallback (a missing primary
 * API key / DNS failure / auth rejection), and it fires exactly ONCE per
 * call. `LLMRateLimitError`/`LLMTimeoutError`/`LLMHTTPError` keep their
 * existing retry semantics untouched.
 *
 * Fallback config: LLM_FALLBACK_PROVIDER (nvidia|google), LLM_FALLBACK_MODEL,
 * LLM_FALLBACK_API_KEY. When nothing is configured, the original error is
 * propagated unchanged.
 *
 * Attribution: the fallback result's `usage.model` carries the fallback model
 * id so `agentLoop.ts`'s AgentUsage row write attributes cost to the model
 * that actually served the call; `costUsd` is computed via costCalculator.ts.
 */
async function callOnceWithFallback(
  messages: LLMMessage[],
  options: LLMOptions,
  timeoutMs: number,
): Promise<LLMResult> {
  try {
    const primary = await callOnce(messages, options, timeoutMs);
    return attachCost(primary, options.model);
  } catch (err: any) {
    const fallbackModel = process.env.LLM_FALLBACK_MODEL;
    const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER;
    if (!fallbackModel && !fallbackProvider) {
      throw err;
    }
    if (!(err instanceof LLMOfflineError)) {
      throw err;
    }

    const fallbackOptions: LLMOptions = {
      ...options,
      model: fallbackModel || options.model,
    };
    const fallbackOverride: ProviderOverride = fallbackProvider
      ? { provider: fallbackProvider, apiKey: process.env.LLM_FALLBACK_API_KEY }
      : {};

    logWarn(
      "llm_fallback",
      {
        persona: options.persona,
        primaryModel: options.model,
        fallbackModel: fallbackOptions.model,
        reason: err.message,
      },
    );

    try {
      const fallback = await callOnce(messages, fallbackOptions, timeoutMs, fallbackOverride);
      // Attribution contract: usage.model MUST carry the fallback model id.
      if (fallback?.usage && fallbackModel) {
        fallback.usage.model = fallbackModel;
      }
      return attachCost(fallback, fallbackOptions.model);
    } catch (fallbackErr: any) {
      // Fallback also failed — surface the original offline error (or the
      // fallback's typed error if it is more informative and still typed).
      if (
        fallbackErr instanceof LLMOfflineError ||
        fallbackErr instanceof LLMRateLimitError ||
        fallbackErr instanceof LLMTimeoutError ||
        fallbackErr instanceof LLMHTTPError
      ) {
        throw fallbackErr;
      }
      throw err;
    }
  }
}

/** Attach the estimated USD cost (D-S2.2) from costCalculator.ts. */
function attachCost(result: any, model: string | undefined): LLMResult {
  if (result && typeof result === "object") {
    const usage = result.usage as LLMUsage | null | undefined;
    if (usage) {
      result.costUsd = computeCostUsd({
        model: usage.model || model || "",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
    }
  }
  return result as LLMResult;
}

export async function retryLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
  retry: RetryOptions = {},
): Promise<LLMResult> {
  // L2.1 — resolve per-persona model/temperature BEFORE the test hook so
  // stub assertions observe the resolved values in `options`.
  const effective = { ...options, ...resolvePersonaLLMOptions(options) };

  const startedAt = Date.now();
  const log = child({
    userId: effective.userId,
    ticketId: effective.ticketId,
    persona: effective.persona,
    model: effective.model,
  });
  const callLogger = (status: string, extra?: Record<string, unknown>) => {
    log.info("llm_call", {
      ms: Date.now() - startedAt,
      status,
      model: extra?.model ?? effective.model,
      ...extra,
    });
  };

  try {
    // Test-only override: allows tests to inject a mock implementation
    if (__testRetryLLMOverride.current) {
      const result = await __testRetryLLMOverride.current(messages, effective, retry);
      callLogger("ok", { model: result?.usage?.model ?? effective.model });
      return result;
    }

    const retries = Math.max(0, retry.retries ?? 3);
    const baseMs = retry.baseMs ?? 500;
    const jitterMs = retry.jitterMs ?? 250;
    const timeoutMs =
      retry.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 30_000);

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await callOnceWithFallback(messages, effective, timeoutMs);
        callLogger("ok", { model: result?.usage?.model ?? effective.model });
        return result;
      } catch (err: any) {
        lastErr = err;
        const status = err?.status;

        // LLMOfflineError is only retryable on the first attempt — a missing
        // API key should not be retried; a transient DNS blip might recover.
        const transientOffline = err instanceof LLMOfflineError && attempt === 0;

        const shouldRetry =
          attempt < retries &&
          (err instanceof LLMRateLimitError ||
            (err instanceof LLMHTTPError && RETRYABLE_STATUS.has(status || 0)) ||
            err instanceof LLMTimeoutError ||
            transientOffline);

        if (!shouldRetry) {
          callLogger(err.name || "error");
          throw err;
        }

        const backoff = baseMs * Math.pow(2, attempt) + Math.random() * jitterMs;
        await sleep(backoff);
      }
    }
    callLogger(lastErr?.name || "error");
    throw lastErr || new Error("LLM call failed after retries.");
  } catch (err: any) {
    log.error("llm_call_error", {
      ms: Date.now() - startedAt,
      status: err?.name || "error",
      error: err?.message,
    });
    throw err;
  }
}

/**
 * Bare wrapper preserved for callers that explicitly do not want retries.
 * Most code should prefer retryLLM.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<LLMResult> {
  return retryLLM(messages, options);
}

/**
 * D-S3.1 — streaming LLM call for the Communicator persona.
 *
 * Frozen contract (Stage 3 §3.3, A-S3.2):
 *   `callLLMStream(opts: { persona, messages, tools? }, onChunk: (delta: string) => void): Promise<LLMResult>`
 *
 * Behaviour:
 * - Streams token deltas through `onChunk` using the existing retry/backoff
 *   path (NVIDIA/Gemini OpenAI-compat SSE).
 * - FAIL-OPEN (inspiration_breakdown §2): if the stream throws for ANY reason
 *   (mid-stream socket reset, malformed SSE, provider refusing streaming),
 *   retry ONCE as a plain non-streaming `messages.create` and return the full
 *   body with `streamed: false`. Typed LLM errors from the fallback itself are
 *   propagated unchanged.
 * - `streamed: true` marks a result that came back over a healthy stream.
 */
export interface CallLLMStreamOptions {
  persona: string;
  messages: LLMMessage[];
  tools?: any[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  userId?: string;
  ticketId?: string;
  retry?: RetryOptions;
}

export async function callLLMStream(
  opts: CallLLMStreamOptions,
  onChunk: (delta: string) => void,
): Promise<LLMResult> {
  const streamOptions: LLMOptions = {
    persona: opts.persona,
    model: opts.model,
    temperature: opts.temperature,
    max_tokens: opts.max_tokens,
    tools: opts.tools,
    userId: opts.userId,
    ticketId: opts.ticketId,
    onChunk,
  };

  try {
    const streamed = await retryLLM(opts.messages, streamOptions, opts.retry);
    return { ...streamed, streamed: true };
  } catch (streamErr) {
    const log = child({
      userId: opts.userId,
      ticketId: opts.ticketId,
      persona: opts.persona,
    });
    log.warn("llm_stream_fallback", {
      reason: streamErr instanceof Error ? streamErr.message : String(streamErr),
    });

    // Fail-open: one non-streaming attempt; its typed error (if any) is final.
    const fallbackOptions: LLMOptions = {
      persona: opts.persona,
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.max_tokens,
      tools: opts.tools,
      userId: opts.userId,
      ticketId: opts.ticketId,
    };
    const fallback = await retryLLM(opts.messages, fallbackOptions, opts.retry);
    return { ...fallback, streamed: false };
  }
}
