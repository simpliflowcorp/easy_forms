/**
 * Legacy shim adapter (A-S3.9).
 * 
 * Wraps the new Orchestrator.execute() to maintain the legacy runAgentLoop()
 * interface. Controlled by AGENT_V3_ENABLED env flag.
 * 
 * TEMPORARY: Delete once in-flight tickets drain.
 */

import { AgentState } from "../types";
import { orchestrator } from "./index";
import { ExecutionStatus } from "../types";

/** Legacy function signature from agentLoop.ts. */
export interface LegacyRunAgentLoopOptions {
  userId: string;
  prompt: string;
  mergeApproved?: boolean;
  resumeTicketId?: string;
  sessionId?: string;
  onUpdate?: (state: AgentState) => void;
  onChunk?: (persona: string, chunk: string) => void;
}

/**
 * Convert legacy AgentState to Orchestrator ExecutionState.
 */
function toExecutionState(legacyState: AgentState): any {
  // Map legacy fields to new ExecutionState
  const makeTask = (a: any, i: number) => ({
    taskId: a.id || `task_${i}`,
    role: "executor_generic" as const,
    skill: legacyState.requirements.skill || "unknown",
    tool: a.tool,
    params: a.params,
    dependsOn: [],
    timeoutMs: 30000,
    retryPolicy: { maxRetries: 2, backoffMs: 1000, retryableErrors: ["timeout", "rate_limit"] },
    metadata: {
      isDestructive: false,
      requiresConfirmation: a.requiresConfirmation || false,
      idempotencyKey: a.id || `idem_${i}`,
      estimatedTokens: 1000,
    },
    successCriteria: [{ type: "tool_success", specification: {} }],
  });

  const plan = legacyState.actionPlan
    ? {
        planId: legacyState.ticket.ticketId,
        goal: legacyState.prompt,
        tasks: legacyState.actionPlan.map((a, i) => makeTask(a, i)),
        edges: [],
        checkpoints: [],
        estimatedCost: { estimatedTokens: 0, estimatedCostUsd: 0, breakdown: {} },
        riskAssessment: [],
        metadata: { createdBy: "planner", model: "", tokenEstimate: 0 },
      }
    : {
        planId: legacyState.ticket.ticketId,
        goal: legacyState.prompt,
        tasks: [],
        edges: [],
        checkpoints: [],
        estimatedCost: { estimatedTokens: 0, estimatedCostUsd: 0, breakdown: {} },
        riskAssessment: [],
        metadata: { createdBy: "planner", model: "", tokenEstimate: 0 },
      };

  return {
    executionId: legacyState.ticket.ticketId,
    userId: legacyState.userId,
    sessionId: legacyState.ticket.sessionId,
    status: mapLegacyStatus(legacyState.activePersona),
    plan,
    taskStates: new Map(),
    checkpoints: [],
    budget: {
      totalTokens: legacyState.tokenUsage?.total || 0,
      totalCostUsd: legacyState.tokenUsage?.estimatedCost || 0,
      perTask: {},
      perUserDay: 0,
      limits: { perTicket: 100000, perUserDay: 500000, perToolCall: 5000 },
    },
    auditLog: [],
    memoryPointers: [],
  };
}

/**
 * Convert Orchestrator ExecutionState to legacy AgentState.
 */
function toLegacyState(executionState: any): AgentState {
  return {
    userId: executionState.userId,
    prompt: executionState.plan?.goal || "",
    ticket: {
      ticketId: executionState.executionId,
      sessionId: executionState.sessionId,
      stage: "STAGE_1",
      title: executionState.plan?.goal?.substring(0, 50) || "Orchestrator Execution",
      prompt: executionState.plan?.goal || "",
      createdAt: new Date().toISOString(),
      status: mapExecutionStatus(executionState.status),
      errorKind: "unknown",
    },
    activePersona: mapExecutionStatusToPersona(executionState.status),
    iterationCount: 1,
    maxIterations: 3,
    requirements: {},
    actionPlan: executionState.plan?.tasks?.map((t: any) => ({
      id: t.taskId,
      tool: t.tool,
      description: t.tool,
      params: t.params,
      status: "pending",
      owningSkill: t.skill,
    })) || [],
    sandbox: { forms: {}, customViews: {}, queryResults: {}, updates: [], deletes: [] },
    executionTrace: executionState.auditLog?.map((a: any) => ({
      stepId: a.ts?.toString() || Date.now().toString(),
      timestamp: new Date(a.ts || Date.now()).toLocaleTimeString(),
      persona: a.role as any,
      message: a.rationale,
      payload: a.payload,
    })) || [],
    isComplete: executionState.status === "completed",
    isQuestion: executionState.status === "awaiting_approval",
    reply: "",
    tokenUsage: {
      total: executionState.budget?.totalTokens || 0,
      byPersona: {},
      estimatedCost: executionState.budget?.totalCostUsd || 0,
    },
  };
}

function mapLegacyStatus(persona: string): ExecutionStatus {
  switch (persona) {
    case "DRAFTER":
    case "PLANNER":
      return "planning";
    case "EXECUTOR_SANDBOX":
      return "executing";
    case "EVALUATOR":
      return "verifying";
    case "AWAITING_USER_APPROVAL":
      return "awaiting_approval";
    case "COMMUNICATOR":
    case "MERGED_TO_PRODUCTION":
      return "completed";
    case "REJECTED":
    case "LLM_ERROR":
      return "failed";
    default:
      return "planning";
  }
}

function mapExecutionStatus(status: ExecutionStatus): AgentState["ticket"]["status"] {
  switch (status) {
    case "planning":
    case "executing":
    case "verifying":
      return "PROCESSING";
    case "awaiting_approval":
      return "AWAITING_USER_APPROVAL";
    case "completed":
      return "RESOLVED";
    case "failed":
      return "LLM_ERROR";
    case "partial":
      return "PROCESSING";
    case "cancelled":
      return "CANCELLED";
    default:
      return "PROCESSING";
  }
}

function mapExecutionStatusToPersona(status: ExecutionStatus): AgentState["activePersona"] {
  switch (status) {
    case "planning":
      return "PLANNER";
    case "executing":
      return "EXECUTOR_SANDBOX";
    case "verifying":
      return "EVALUATOR";
    case "awaiting_approval":
      return "AWAITING_USER_APPROVAL";
    case "completed":
      return "COMMUNICATOR";
    case "failed":
      return "LLM_ERROR";
    case "partial":
      return "EVALUATOR";
    case "cancelled":
      return "REJECTED";
    default:
      return "PLANNER";
  }
}

/**
 * Legacy-compatible runAgentLoop that delegates to Orchestrator.
 * Only used when AGENT_V3_ENABLED=true.
 */
export async function runAgentLoopLegacy(options: LegacyRunAgentLoopOptions): Promise<AgentState> {
  const { userId, prompt, mergeApproved, resumeTicketId, sessionId, onUpdate, onChunk } = options;

  if (mergeApproved && resumeTicketId) {
    // Handle merge approval - delegate to legacy merge path
    // For now, throw to indicate this path isn't fully implemented in v3 yet
    throw new Error("Merge approval via legacy shim not yet implemented; use legacy path");
  }

  // Create execution ID (use resumeTicketId if resuming, else new)
  const executionId = resumeTicketId || `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Start or resume orchestration
  const executionState = await orchestrator.execute({
    executionId,
    userId,
    prompt,
    sessionId,
    resumeFrom: resumeTicketId,
    onProgress: (update) => {
      if (onUpdate) {
        onUpdate(toLegacyState(update));
      }
    },
    onChunk: onChunk,
  });

  return toLegacyState(executionState);
}

/**
 * Check if v3 orchestrator is enabled.
 */
export function isV3Enabled(): boolean {
  return process.env.AGENT_V3_ENABLED === "true";
}

/**
 * Get the appropriate runner based on feature flag.
 */
export function getAgentRunner() {
  if (isV3Enabled()) {
    return runAgentLoopLegacy;
  }
  // Import legacy dynamically to avoid circular deps
  return require("../agentLoop").runAgentLoop;
}