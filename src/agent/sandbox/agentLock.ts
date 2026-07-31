import { AgentBusyError } from "../types.js";
import { agentRedis } from "./agentRedis.js";

/**
 * Per-user mutual exclusion for the agent loop.
 *
 * Why: two concurrent loops for the same user (double-submit, webhook retry,
 * another tab) previously raced on the in-memory sandbox and on `mergeToProduction`,
 * producing duplicate production forms and interleaved `updates`/`deletes`.
 *
 * Implementation: Redis `SET key value NX PX ttl`. We store the ticketId as
 * the value so a subsequent release can compare-and-del only if we still own
 * the lock (Lua CAS) — never deletes someone else's lock.
 *
 * TTL is 60s by default and safely longer than any single persona turn (~30s
 * LLM timeout from Phase 3). If a persona legitimately exceeds this we detect
 * it at release-time (the key has either expired or been overwritten) and
 * surface an `LLM_ERROR` to the user.
 */

const LOCK_TTL_MS = 60_000;

const RELEASE_SCRIPT = `
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

export async function acquireAgentLock(
  userId: string,
  ticketId: string,
): Promise<AgentLockHandle> {
  const key = `agent_lock:${userId}`;
  const ok = await agentRedis.client.set(key, ticketId, "PX", LOCK_TTL_MS, "NX");
  if (!ok) throw new AgentBusyError();

  let _stale = false;
  return {
    release: async () => {
      try {
        const res = (await agentRedis.client.eval(
          RELEASE_SCRIPT,
          1,
          key,
          ticketId,
        )) as number;
        if (res === 0) _stale = true;
      } catch (err) {
        // Never throw from release — the loop is already in a finally block.
        _stale = true;
      }
    },
    stale: () => _stale,
  };
}
