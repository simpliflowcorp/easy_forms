import type { AgentAction, AgentState } from "@/agent/types";

export interface AgentMemory {
  userId: string;
  key: string;
  value: unknown;
  confidence: number;
  lastUsedAt: Date;
}

export interface AgentFailure {
  userId: string;
  promptHash: string;
  lastError: string;
  count: number;
  lastAt: Date;
}

export interface AgentSkillUsage {
  userId: string;
  skill: string;
  count: number;
  successRate: number;
  avgIterations: number;
  lastUsedAt: Date;
}

export interface MemoryScope {
  read: string[];
  write: string[];
  query?: string;
}

export interface AgentContext {
  preferences: AgentMemory[];
  recentTraces: unknown[];
  relevantSkills: unknown[];
  procedural: unknown[];
}

export interface MemoryService {
  getMemory(userId: string, key?: string): Promise<AgentMemory | AgentMemory[]>;
  setMemory(userId: string, key: string, value: unknown, opts?: { confidence?: number }): Promise<void>;
  recordSkillUse(userId: string, skill: string, ok: boolean, iterations: number): Promise<void>;
  recordFailure(userId: string, promptHash: string, err: string): Promise<void>;
  recentFailures(userId: string, sinceMs: number): Promise<AgentFailure[]>;
  summarize(ticketId: string): Promise<string>;
  assembleContext(userId: string, scope: MemoryScope): Promise<AgentContext>;
}

/**
 * NegEvalContext — frozen Stage 4 contract (C-S4.2).
 *
 * Canonical minimal shape per the §2 contract sheet:
 *   { actionPlan, state }
 *
 * Optional helper members are added here (rather than in safeAssert.ts)
 * because Agent B's safeAssert runtime consumes them and the General
 * guideline in §2 is "the contract lives in C's memory/types.ts".
 * Consumers that build a ctx pass only the required two; safeAssert will
 * simply see `undefined` for the helpers if absent and degrade gracefully.
 */
export interface NegEvalContext {
  actionPlan: AgentAction[];
  state: AgentState;
  /** Helper to get a value from actionPlan by index. */
  getAction?: (index: number) => AgentAction | undefined;
  /** Helper to check if any action matches a tool. */
  hasTool?: (tool: string) => boolean;
  /** Helper to get results from completed actions of a given tool. */
  getResults?: (tool: string) => unknown[];
}
