export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Used for tool responses
  tool_calls?: any[]; // Used when assistant calls a tool
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  tools?: any[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
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
  constructor(message: string, public status: number = 429) {
    super(message);
    this.name = "LLMRateLimitError";
  }
}
export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}
export class LLMHTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "LLMHTTPError";
  }
}
export class LLMParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMParseError";
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

async function callOnce(
  messages: LLMMessage[],
  options: LLMOptions,
  timeoutMs: number,
): Promise<any> {
  const provider = process.env.LLM_PROVIDER || "nvidia";

  let apiKey: string | undefined;
  let baseUrl: string;
  let defaultModel: string;

  if (provider === "google") {
    apiKey = process.env.GEMINI_API_KEY;
    baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    defaultModel = process.env.LLM_MODEL || "gemini-2.0-flash";
  } else {
    apiKey = process.env.NVIDIA_API_KEY;
    baseUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
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
    stream: false,
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

    const data = await res.json();
    return data.choices[0].message;
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
export async function retryLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
  retry: RetryOptions = {},
): Promise<any> {
  const retries = Math.max(0, retry.retries ?? 3);
  const baseMs = retry.baseMs ?? 500;
  const jitterMs = retry.jitterMs ?? 250;
  const timeoutMs =
    retry.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 30_000);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callOnce(messages, options, timeoutMs);
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

      if (!shouldRetry) throw err;

      const backoff = baseMs * Math.pow(2, attempt) + Math.random() * jitterMs;
      await sleep(backoff);
    }
  }
  throw lastErr || new Error("LLM call failed after retries.");
}

/**
 * Bare wrapper preserved for callers that explicitly do not want retries.
 * Most code should prefer retryLLM.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<any> {
  return retryLLM(messages, options);
}
