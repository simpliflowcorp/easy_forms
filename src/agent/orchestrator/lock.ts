/**
 * Per-execution lock for multi-intent tickets (A-S3.7).
 * 
 * Coexists with the legacy per-user lock (`agent_lock:{userId}`) from `agentLock.ts`.
 * Keyed on `agent_lock:{userId}:{executionId}` for parallel multi-intent execution.
 * TTL defaults to 5 minutes with auto-renewal heartbeat.
 */

import { agentRedis } from "../sandbox/agentRedis";

export interface ExecutionLockHandle {
  release: () => Promise<void>;
  stale: () => boolean;
  renew: () => Promise<void>;
}

/**
 * Acquire a per-execution lock for a user's agent execution.
 * 
 * @param executionId - Unique execution identifier (e.g., ticketId or new execution ID)
 * @param userId - User's ObjectId string
 * @param ttlMs - Lock TTL in milliseconds (default 5 minutes)
 * @returns ExecutionLockHandle with release, stale, and renew methods
 */
export async function acquireExecutionLock(
  executionId: string,
  userId: string,
  ttlMs: number = 300_000
): Promise<ExecutionLockHandle> {
  const lockKey = `agent_lock:${userId}:${executionId}`;
  let isStale = false;
  let released = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  // Try to acquire the lock with NX (only if not exists)
  const ok = await agentRedis.client.set(lockKey, "1", "PX", ttlMs, "NX");
  
  if (!ok) {
    // Lock already held by another process
    throw new Error(`Execution lock already held for user ${userId}, execution ${executionId}`);
  }

  // Start heartbeat to renew the lock periodically
  const renewLock = async () => {
    if (released) return;
    try {
      // Only renew if we still own the lock
      const script = `
        if redis.call("get", KEYS[1]) == "1" then
          return redis.call("pexpire", KEYS[1], ARGV[1])
        else
          return 0
        end
      `;
      await agentRedis.client.eval(script, 1, lockKey, ttlMs);
    } catch (err) {
      // Lock may have expired or been released
      isStale = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }
  };

  // Renew every 1/3 of TTL
  const heartbeatMs = Math.max(1000, Math.floor(ttlMs / 3));
  heartbeatInterval = setInterval(renewLock, heartbeatMs);

  return {
    release: async () => {
      if (released) return;
      released = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      // Only delete if we still own it
      const script = `if redis.call("get", KEYS[1]) == "1" then return redis.call("del", KEYS[1]) else return 0 end`;
      await agentRedis.client.eval(script, 1, lockKey, "1");
    },
    stale: () => isStale,
    renew: renewLock,
  };
}

/**
 * Check if an execution lock exists for a user/execution pair.
 */
export async function checkExecutionLock(executionId: string, userId: string): Promise<boolean> {
  const lockKey = `agent_lock:${userId}:${executionId}`;
  const exists = await agentRedis.client.exists(lockKey);
  return exists === 1;
}

/**
 * Force release an execution lock (admin/cleanup use only).
 */
export async function forceReleaseExecutionLock(executionId: string, userId: string): Promise<void> {
  const lockKey = `agent_lock:${userId}:${executionId}`;
  await agentRedis.client.del(lockKey);
}