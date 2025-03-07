import { Redis } from "ioredis";
import { createClient } from "@vercel/kv";

// Define RedisInstance type
type RedisInstance = Redis | ReturnType<typeof createClient>;

// Create Redis client instance based on environment
let kvClient: RedisInstance;

if (process.env.NODE_ENV === "development") {
  kvClient = new Redis(process.env.KV_URL!);
} else {
  kvClient = createClient({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

// Define the RedisClient interface
export interface RedisClient {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options?: { ex?: number }
  ) => Promise<string | void>;
  lpush: (key: string, value: string) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  ltrim: (key: string, start: number, stop: number) => Promise<void>;
  duplicate?: () => Redis; // Only for ioredis
  client: RedisInstance;
}

// Function to check if we're using ioredis
const isIoredis = (client: RedisInstance): client is Redis => {
  return client instanceof Redis;
};

// Redis client wrapper
const kv: RedisClient = {
  get: (key) => kvClient.get(key),

  set: async (key, value, options) => {
    if (isIoredis(kvClient)) {
      if (options?.ex !== undefined) {
        return kvClient.set(key, value, "EX", options.ex); // Returns "OK"
      } else {
        return kvClient.set(key, value); // Returns "OK"
      }
    } else {
      // Only pass options if `ex` exists
      await kvClient.set(
        key,
        value,
        options?.ex ? { ex: options.ex } : undefined
      );
    }
  },

  lpush: (key, value) => kvClient.lpush(key, value),
  lrange: (key, start, stop) => kvClient.lrange(key, start, stop),
  del: (key) => kvClient.del(key),
  exists: (key) => kvClient.exists(key),
  expire: (key, seconds) => kvClient.expire(key, seconds),
  ltrim: async (key, start, stop) => {
    await kvClient.ltrim(key, start, stop);
    return;
  },

  duplicate: isIoredis(kvClient) ? () => kvClient.duplicate() : undefined,
  client: kvClient,
};

export default kv;
