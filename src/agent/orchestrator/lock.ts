/**
 * Per-execution lock for multi-intent tickets (A-S3.7).
 * 
 * Coexists with the legacy per-user lock (`agent_lock:{userId}`) from `agentLock.ts`.
 * Keyed on `agent_lock:{userId}:{executionId}` for parallel multi-intent execution.
 * TTL defaults to 5 minutes with auto-renewal heartbeat.
 * 
 * A-S4.4: Also provides per-resource locking (`agent_lock:{userId}:{resourceId}`)
 * gated by AGENT_RESOURCE_LOCKING_ENABLED (default false).
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

// ─── A-S4.4: Per-resource locking ─────────────────────────────────────
// Gated by AGENT_RESOURCE_LOCKING_ENABLED (default: false).
// Coexists with per-execution lock and legacy per-user lock.
// NEVER blocks the orchestrator globally — failure routes task to "waiting"
// and the Critic schedules a retry.

/**
 * Check if resource locking is enabled.
 */
export function isResourceLockingEnabled(): boolean {
  return process.env.AGENT_RESOURCE_LOCKING_ENABLED === "true";
}

/**
 * Acquire a per-resource lock for a specific form/view resource.
 * 
 * @param userId - User's ObjectId string
 * @param resourceId - Resource identifier (e.g., form_id, view_id)
 * @param ttlMs - Lock TTL in milliseconds (default 30 seconds — shorter than execution lock)
 * @returns ResourceLockHandle with release, stale, and acquired flag
 */
export interface ResourceLockHandle {
  release: () => Promise<void>;
  stale: () => boolean;
  acquired: boolean;
}

export async function acquireResourceLock(
  userId: string,
  resourceId: string,
  ttlMs: number = 30_000
): Promise<ResourceLockHandle> {
  // If feature flag is off, return a no-op handle that reports acquired=false
  // The caller should route the task to "waiting" status
  if (!isResourceLockingEnabled()) {
    return {
      release: async () => {},
      stale: () => false,
      acquired: false,
    };
  }

  const lockKey = `agent_lock:${userId}:${resourceId}`;
  let isStale = false;
  let released = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  // Try to acquire the lock with NX (only if not exists)
  const ok = await agentRedis.client.set(lockKey, "1", "PX", ttlMs, "NX");
  
  if (!ok) {
    // Resource lock not acquired — caller should set task status to "waiting"
    return {
      release: async () => {},
      stale: () => false,
      acquired: false,
    };
  }

  // Start heartbeat to renew the lock periodically
  const renewLock = async () => {
    if (released) return;
    try {
      const script = `
        if redis.call("get", KEYS[1]) == "1" then
          return redis.call("pexpire", KEYS[1], ARGV[1])
        else
          return 0
        end
      `;
      await agentRedis.client.eval(script, 1, lockKey, ttlMs);
    } catch (err) {
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
      const script = `if redis.call("get", KEYS[1]) == "1" then return redis.call("del", KEYS[1]) else return 0 end`;
      await agentRedis.client.eval(script, 1, lockKey, "1");
    },
    stale: () => isStale,
    acquired: true,
  };
}

/**
 * Check if a resource lock exists for a user/resource pair.
 */
export async function checkResourceLock(userId: string, resourceId: string): Promise<boolean> {
  const lockKey = `agent_lock:${userId}:${resourceId}`;
  const exists = await agentRedis.client.exists(lockKey);
  return exists === 1;
}

/**
 * Force release a resource lock (admin/cleanup use only).
 */
export async function forceReleaseResourceLock(userId: string, resourceId: string): Promise<void> {
  const lockKey = `agent_lock:${userId}:${resourceId}`;
  await agentRedis.client.del(lockKey);
}