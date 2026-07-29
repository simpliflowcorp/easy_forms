import Redis from "ioredis";
import { AgentState } from "../types";

// Initialize Redis client (defaults to localhost:6379 which matches our docker setup)
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
export const redisClient = new Redis(redisUrl);

export const agentRedis = {
  /**
   * Save the current state of an agent ticket to Redis.
   * Expires automatically after 1 hour to prevent cache bloat.
   */
  saveState: async (state: AgentState): Promise<void> => {
    const key = `agent_ticket:${state.ticket.ticketId}`;
    await redisClient.set(key, JSON.stringify(state), "EX", 3600);
  },

  /**
   * Get the current state of an agent ticket from Redis.
   */
  getState: async (ticketId: string): Promise<AgentState | null> => {
    const key = `agent_ticket:${ticketId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Delete a ticket state from Redis (e.g., when successfully resolved or moved to DB).
   */
  clearState: async (ticketId: string): Promise<void> => {
    const key = `agent_ticket:${ticketId}`;
    await redisClient.del(key);
  },
};
