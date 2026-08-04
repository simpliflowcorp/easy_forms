import { AgentBusyError, LoopTimeoutError } from "../types.js";
import { agentRedis } from "./agentRedis.js";
import { READ_ONLY_SKILLS } from "../policy/permissions.js";

/**
 * Per-user read/write lock separation for the agent loop.
 *
 * Why: read-only operations (STAGE_1 queries) can run concurrently for the same
 * user without blocking each other, while mutations must be exclusive.
 *
 * Implementation:
 * - Write lock: `agent_lock:write:{userId}` — exclusive, TTL based on LOOP_DEADLINE_MS, Lua CAS release
 * - Read lock:  `agent_lock:read:{userId}` — shared, TTL 5s, counter-based
 *                Multiple readers increment/decrement; writer waits for counter to hit 0.
 *
 * Writer protocol:
 *   1. SET agent_lock:write:{userId} NX PX <WRITE_LOCK_TTL_MS> (fail → AgentBusyError)
 *   2. Wait for agent_lock:read:{userId} counter to reach 0 (poll with TTL)
 *   3. Proceed with mutation
 *
 * Reader protocol:
 *   1. INCR agent_lock:read:{userId} (sets PX 5000 on first)
 *  2. Proceed with read
 *   3. DECR agent_lock:read:{userId} on cleanup
 *
 * TTL notes: read lock TTL is short (5s) so stale readers auto-expire quickly.
 * Writer TTL is derived from LOOP_DEADLINE_MS (default 120000) to cover the
 * worst-case loop execution plus a 5s buffer.
 */

// LOOP_DEADLINE_MS is the maximum time the agent loop is allowed to run.
// Default 120000ms (2 minutes). The lock TTL is max(LOOP_DEADLINE_MS, 60000) + 5000.
const LOOP_DEADLINE_MS = Number(process.env.LOOP_DEADLINE_MS || "120000");
const WRITE_LOCK_TTL_MS = Math.max(LOOP_DEADLINE_MS, 60_000) + 5_000;
const READ_LOCK_TTL_MS = 5_000;

const WRITE_RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface AgentLockHandle {
  /** Release the lock if we still own it. No-op if already released or stale. */
  release: () => Promise<void>;
  /** True if, at release time, the lock belongs to us. */
  stale: () => boolean;
}

interface AcquireOptions {
  userId: string;
  ticketId: string;
  isReadOnly: boolean;
}

export async function acquireAgentLock(
  options: AcquireOptions,
): Promise<AgentLockHandle> {
  const { userId, ticketId, isReadOnly } = options;

  if (isReadOnly) {
    // Read lock: increment counter, set TTL on first
    const readKey = `agent_lock:read:${userId}`;
    const count = await agentRedis.client.incr(readKey);
    if (count === 1) {
      await agentRedis.client.pexpire(readKey, READ_LOCK_TTL_MS);
    }

    let _released = false;
    return {
      release: async () => {
        if (_released) return;
        _released = true;
        const readKey = `agent_lock:read:${userId}`;
        const count = await agentRedis.client.decr(readKey);
        if (count <= 0) {
          await agentRedis.client.del(readKey);
        }
      },
      stale: () => false,
    };
  }

  // Write lock: exclusive
  const writeKey = `agent_lock:write:${userId}`;
  const ok = await agentRedis.client.set(writeKey, ticketId, "PX", WRITE_LOCK_TTL_MS, "NX");
  if (!ok) throw new AgentBusyError();

  // Wait for active readers to drain
  const readKey = `agent_lock:read:${userId}`;
  const startWait = Date.now();
  while (true) {
    const readerCount = parseInt((await agentRedis.client.get(readKey)) || "0", 10);
    if (readerCount === 0) break;
    if (Date.now() - startWait > 5000) {
      // Release write lock and fail
      await agentRedis.client.eval(WRITE_RELEASE_SCRIPT, 1, writeKey, ticketId);
      throw new AgentBusyError("Readers did not drain in time");
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  let _stale = false;
  return {
    release: async () => {
      try {
        const res = (await agentRedis.client.eval(
          WRITE_RELEASE_SCRIPT,
          1,
          writeKey,
          ticketId,
        )) as number;
        if (res === 0) _stale = true;
      } catch (err) {
        _stale = true;
      }
    },
    stale: () => _stale,
  };
}