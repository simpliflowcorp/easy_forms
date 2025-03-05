// lib/redis.ts
import { createClient } from "@vercel/kv";

// For local development using Redis directly
let kvClient;
if (process.env.NODE_ENV === "development") {
  const { Redis } = require("ioredis");
  kvClient = new Redis(process.env.KV_URL);
} else {
  // Production configuration for Vercel KV
  kvClient = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

// Type-safe interface
export interface RedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { ex?: number }) => Promise<void>;
  lpush: (key: string, value: string) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;

  // Add expire method
  expire: (key: string, seconds: number) => Promise<number>;
}

// Implementation wrapper
const kv: RedisClient = {
  get: (key) => kvClient.get(key),
  // set: (key, value, options) => kvClient.set(key, value, options),
  set: async (key: string, value: string, options?: { ex?: number }) => {
    if (process.env.NODE_ENV === "development") {
      // For ioredis (local development)
      const args = [key, value];
      if (options?.ex) {
        args.push("EX", options.ex.toString());
      }
      return kvClient.set(...args);
    } else {
      // For Vercel KV (production)
      return kvClient.set(key, value, options);
    }
  },
  lpush: (key, value) => kvClient.lpush(key, value),
  lrange: (key, start, stop) => kvClient.lrange(key, start, stop),
  del: (key) => kvClient.del(key),
  exists: (key) => kvClient.exists(key),

  expire: (key, seconds) => {
    if (process.env.NODE_ENV === "development") {
      return kvClient.expire(key, seconds);
    } else {
      // For Vercel KV
      return kvClient.expire(key, seconds);
    }
  },
};

export default kv;
