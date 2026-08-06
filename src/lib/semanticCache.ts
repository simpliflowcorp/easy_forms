/**
 * D-S3.3 — Redis-backed semantic cache (opt-in).
 *
 * For repeated read/analytics agent questions, answers can be served from
 * cache in << 50 ms instead of re-invoking the LLM.
 *
 * Gating: `SEMANTIC_CACHE_ENABLED` must be "1" | "true" | "yes" (default
 * disabled). TTL defaults to 60s (two identical prompts within a minute →
 * second one is a cache hit).
 *
 * Embedding strategy: Stage 3 is skeleton-adjacent — a deterministic
 * normalized-query hash (SHA-256 over the canonicalised query) stands in for a
 * real embedding lookup. The key namespace is `semantic:<sha256>` so a later
 * stage can swap in a $vectorSearch/KNN backend without touching callers.
 *
 * Graceful degradation: if Redis is unavailable or the feature is off, every
 * read is a MISS and `semanticCacheQuery` simply runs the resolver. Caching is
 * best-effort and must never throw on the hot path.
 */

import { createHash } from "node:crypto";

export interface SemanticCacheOptions {
  /** Namespace scope: keeps analytical answers vs form-building separate. */
  scope?: string;
  /** Cache TTL in seconds (default 60). */
  ttlSeconds?: number;
}

export interface SemanticCacheHit<T> {
  found: boolean;
  cached: boolean;
  value?: T;
  latencyMs: number;
}

export interface SemanticCacheQueryResult<T> {
  value: T;
  cached: boolean;
  latencyMs: number;
}

const DEFAULT_TTL_SECONDS = 60;

/** fsync-adjacent: enables the feature when SEMANTIC_CACHE_ENABLED is truthy. */
export function isSemanticCacheEnabled(): boolean {
  const raw = (process.env.SEMANTIC_CACHE_ENABLED || "false").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Canonicalise a query for the cache key: lowercase, alphanumeric tokens only. */
export function normalizeCacheQuery(query: string, scope = "default"): string {
  const tokenized = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${scope}:${tokenized}`;
}

/** Deterministic cache key from a normalized query. */
export function cacheKeyFor(query: string, scope = "default"): string {
  const normalized = normalizeCacheQuery(query, scope);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `semantic:${hash}`;
}

type KVClient = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<string | void>;
};

/** Lazily load the Redis client; returns null if it fails to construct. */
function loadRedis(): KVClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kv = require("@/lib/redis") as { default: KVClient };
    return kv.default ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a cached value. `found: false` on miss / disabled / Redis-down.
 * Never throws.
 */
export async function semanticCacheGet<T = unknown>(
  query: string,
  options: SemanticCacheOptions = {},
): Promise<SemanticCacheHit<T>> {
  const started = Date.now();
  if (!isSemanticCacheEnabled()) {
    return { found: false, cached: false, latencyMs: Date.now() - started };
  }
  try {
    const redis = loadRedis();
    if (!redis) {
      return { found: false, cached: false, latencyMs: Date.now() - started };
    }
    const key = cacheKeyFor(query, options.scope);
    const raw = await redis.get(key);
    if (raw == null) {
      return { found: false, cached: false, latencyMs: Date.now() - started };
    }
    return {
      found: true,
      cached: true,
      value: JSON.parse(raw) as T,
      latencyMs: Date.now() - started,
    };
  } catch {
    return { found: false, cached: false, latencyMs: Date.now() - started };
  }
}

/** Store a value under the query's key. Best-effort; never throws. */
export async function semanticCacheSet<T = unknown>(
  query: string,
  value: T,
  options: SemanticCacheOptions = {},
): Promise<void> {
  if (!isSemanticCacheEnabled()) return;
  try {
    const redis = loadRedis();
    if (!redis) return;
    const key = cacheKeyFor(query, options.scope);
    const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    await redis.set(key, JSON.stringify(value), { ex: ttl });
  } catch {
    // Best-effort: cache write failures never affect the caller.
  }
}

/**
 * Convenience: resolve `query` through `resolver` unless a fresh cache entry
 * exists. Returns `{ value, cached, latencyMs }` so callers can annotate the
 * response ("answered from cache", "delivered in < 50ms").
 */
export async function semanticCacheQuery<T>(
  query: string,
  resolver: () => Promise<T>,
  options: SemanticCacheOptions = {},
): Promise<SemanticCacheQueryResult<T>> {
  const hit = await semanticCacheGet<T>(query, options);
  if (hit.found) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { value: hit.value!, cached: true, latencyMs: hit.latencyMs };
  }

  const started = Date.now();
  const value = await resolver();
  await semanticCacheSet(query, value, options);
  return { value, cached: false, latencyMs: Date.now() - started };
}

export default { semanticCacheGet, semanticCacheSet, semanticCacheQuery, isSemanticCacheEnabled };