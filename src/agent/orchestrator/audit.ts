/**
 * Audit logger for Orchestrator executions (A-S3.8).
 * 
 * Every LLM call, tool call, and significant event is logged with
 * {input, output, reasoning, ts} into OrchestratorAuditModel (Agent C's model).
 */

import { AuditEntry, ExecutionStatus } from "../types";

/** Interface for the audit model (Agent C's OrchestratorAuditModel). */
export interface OrchestratorAuditModel {
  create(entries: Partial<AuditEntry>[]): Promise<any[]>;
  find(filter: any): any;
}

/** In-memory buffer for batching audit writes. */
const auditBuffer: Partial<AuditEntry>[] = [];
let flushInterval: NodeJS.Timeout | null = null;
let auditModel: OrchestratorAuditModel | null = null;

/** Initialize the audit logger with the MongoDB model. */
export function initAuditLogger(model: OrchestratorAuditModel): void {
  auditModel = model;
  
  // Flush buffer every 5 seconds
  if (flushInterval) clearInterval(flushInterval);
  flushInterval = setInterval(flushAuditBuffer, 5000);
}

/** Log an audit entry (buffered, flushed periodically). */
export function logAudit(entry: Partial<AuditEntry>): void {
  const fullEntry: Partial<AuditEntry> = {
    ...entry,
    ts: Date.now(),
  };
  auditBuffer.push(fullEntry);
}

/** Log an LLM call with input/output/reasoning. */
export function logLLMCall(params: {
  executionId: string;
  taskId?: string;
  role: string;
  model: string;
  messages: any[];
  response: any;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number };
  latencyMs: number;
  reasoning?: string;
}): void {
  logAudit({
    executionId: params.executionId,
    taskId: params.taskId,
    role: params.role,
    event: "tool_call", // Reuse event type for LLM calls
    payload: {
      type: "llm_call",
      model: params.model,
      messages: params.messages.map(m => ({ role: m.role, content: m.content?.substring(0, 500) })),
      response: params.response?.content?.substring(0, 1000),
      tool_calls: params.response?.tool_calls,
      reasoning: params.reasoning,
    },
    metrics: {
      tokens: params.usage?.totalTokens || 0,
      latencyMs: params.latencyMs,
      costUsd: params.usage?.costUsd || 0,
    },
    rationale: params.reasoning || "LLM call for planning/execution/verification",
  });
}

/** Log a tool call with input/output. */
export function logToolCall(params: {
  executionId: string;
  taskId?: string;
  role: string;
  tool: string;
  input: any;
  output: any;
  latencyMs: number;
  success: boolean;
  error?: string;
}): void {
  logAudit({
    executionId: params.executionId,
    taskId: params.taskId,
    role: params.role,
    event: "tool_call",
    payload: {
      type: "tool_execution",
      tool: params.tool,
      input: params.input,
      output: params.success ? params.output : undefined,
      error: params.error,
      success: params.success,
    },
    metrics: {
      tokens: 0,
      latencyMs: params.latencyMs,
      costUsd: 0,
    },
    rationale: params.success ? `Tool ${params.tool} executed successfully` : `Tool ${params.tool} failed: ${params.error}`,
  });
}

/** Log a verification/checkpoint event. */
export function logVerification(params: {
  executionId: string;
  taskId?: string;
  role: string;
  verdict: "pass" | "conditional_pass" | "fail" | "escalate";
  findings: any[];
  fixes?: any[];
}): void {
  logAudit({
    executionId: params.executionId,
    taskId: params.taskId,
    role: params.role,
    event: "verification",
    payload: {
      type: "critic_verdict",
      verdict: params.verdict,
      findings: params.findings,
      fixes: params.fixes,
    },
    metrics: { tokens: 0, latencyMs: 0, costUsd: 0 },
    rationale: `Critic verdict: ${params.verdict}`,
  });
}

/** Log a state transition (planning → executing → verifying → etc.). */
export function logStateTransition(params: {
  executionId: string;
  taskId?: string;
  role: string;
  fromStatus: ExecutionStatus;
  toStatus: ExecutionStatus;
}): void {
  logAudit({
    executionId: params.executionId,
    taskId: params.taskId,
    role: params.role,
    event: "plan_start", // Reuse closest event type
    payload: {
      type: "state_transition",
      from: params.fromStatus,
      to: params.toStatus,
    },
    metrics: { tokens: 0, latencyMs: 0, costUsd: 0 },
    rationale: `State transition: ${params.fromStatus} → ${params.toStatus}`,
  });
}

/** Log a merge event. */
export function logMerge(params: {
  executionId: string;
  taskId?: string;
  role: string;
  mergeStats: any;
  approvedActionIds: string[];
}): void {
  logAudit({
    executionId: params.executionId,
    taskId: params.taskId,
    role: params.role,
    event: "merge",
    payload: {
      type: "merge",
      mergeStats: params.mergeStats,
      approvedActionIds: params.approvedActionIds,
    },
    metrics: { tokens: 0, latencyMs: 0, costUsd: 0 },
    rationale: `Merge approved for ${params.approvedActionIds.length} actions`,
  });
}

/** Flush the audit buffer to MongoDB. */
async function flushAuditBuffer(): Promise<void> {
  if (!auditModel || auditBuffer.length === 0) return;
  
  const toFlush = [...auditBuffer];
  auditBuffer.length = 0;
  
  try {
    await auditModel.create(toFlush as any);
  } catch (err) {
    // Re-add to buffer on failure (best effort)
    auditBuffer.unshift(...toFlush);
    console.error("[audit] Failed to flush audit buffer:", err);
  }
}

/** Force flush the audit buffer (call on shutdown). */
export async function flushAudit(): Promise<void> {
  await flushAuditBuffer();
}

/** Shutdown the audit logger. */
export function shutdownAuditLogger(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  flushAudit();
}