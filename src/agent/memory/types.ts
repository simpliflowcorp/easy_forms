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

export interface NegEvalContext {
  actionPlan: AgentAction[];
  state: AgentState;
}
