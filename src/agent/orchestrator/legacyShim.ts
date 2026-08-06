/**
 * Legacy shim adapter (A-S3.9).
 * 
 * Wraps the new Orchestrator.execute() to maintain the legacy runAgentLoop()
 * interface. Controlled by AGENT_V3_ENABLED env flag.
 * 
 * TEMPORARY: Delete once in-flight tickets drain.
 * 
 * DRAIN PROCEDURE (A-S4.3):
 * 1. Query prod AgentTicketModel for tickets with status in [AWAITING_USER_APPROVAL, EXECUTOR_SANDBOX, PLANNER]
 *    and createdAt < <ship-tag-date> (v3-stage-3-complete tag date).
 * 2. If zero rows exist, Stage 4 follow-up PR deletes legacyShim.ts + the AGENT_V3_ENABLED switch.
 * 3. Do NOT delete legacyShim.ts in Stage 4 — schedule the delete as a Stage-4-exit + separate small PR.
 */

import { AgentState } from "../types";
import { orchestrator } from "./index";
import { ExecutionStatus } from "../types";
import AgentTicketModel from "@/models/agentTicketModel.js";

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
 * 
 * A-S4.3: Pin default to true (hierarchical path is the v3 ship state
 * per the post-Stage-3 audit). The flag can still be set to "false"
 * for emergency rollback to the legacy linear path.
 */
export function isV3Enabled(): boolean {
  // Default to true — v3 is the shipped path
  const val = process.env.AGENT_V3_ENABLED;
  if (val === undefined) return true;
  return val === "true";
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

/**
 * A-S4.3: Drain check utility.
 * Queries production for in-flight tickets that would be affected by legacy path removal.
 * 
 * @param shipTagDate - ISO date string of the v3-stage-3-complete tag (ship date)
 * @returns Promise resolving to count of in-flight legacy-path tickets
 */
export async function checkLegacyDrain(shipTagDate: string): Promise<number> {
  const cutoff = new Date(shipTagDate);
  const count = await AgentTicketModel.countDocuments({
    status: { $in: ["AWAITING_USER_APPROVAL", "PROCESSING"] },
    createdAt: { $lt: cutoff },
  });
  return count;
}

/**
 * A-S4.3: Human-readable drain status for logging / monitoring.
 */
export async function getLegacyDrainStatus(shipTagDate: string): Promise<{
  drained: boolean;
  count: number;
  message: string;
}> {
  const count = await checkLegacyDrain(shipTagDate);
  return {
    drained: count === 0,
    count,
    message: count === 0
      ? "All pre-ship tickets drained. Safe to remove legacyShim.ts in follow-up PR."
      : `${count} pre-ship ticket(s) still in-flight. Legacy path must remain.`,
  };
}