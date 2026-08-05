import mongoose from "mongoose";
import type { MergeStats } from "./sandbox/types.js";

export type PersonaStage =
  | "DRAFTER"
  | "PLANNER"
  | "EXECUTOR_SANDBOX"
  | "EVALUATOR"
  | "COMMUNICATOR"
  | "AWAITING_USER_APPROVAL"
  | "MERGED_TO_PRODUCTION"
  | "REJECTED"
  | "LLM_ERROR";

export type TicketStage = "STAGE_1" | "STAGE_2" | "STAGE_3";

export type EvaluatorDecision = "retry" | "replan" | "ask_user" | "complete";

export type ErrorKind =
  | "timeout"
  | "rate_limit"
  | "http_5xx"
  | "offline"
  | "cancelled"
  | "oom"
  | "unknown";

export interface AgentTicket {
  ticketId: string;
  sessionId?: string;
  stage: TicketStage;
  title: string;
  prompt: string;
  formId?: string;
  createdAt: string;
  status: "OPEN" | "PROCESSING" | "RESOLVED" | "REJECTED" | "LLM_ERROR" | "CANCELLED" | "AWAITING_USER_APPROVAL";
  errorKind?: ErrorKind;
}

export interface AgentAction {
  id: string;
  tool: string;
  description: string;
  params: any;
  status: "pending" | "in_progress" | "done" | "error" | "awaiting_confirmation";
  requiresConfirmation?: boolean;
  result?: any;
  error?: string;
  owningSkill?: string; // A-S2.2: the skill that owns this action
}

/** Single canonical definition of a pending mutation to be reflected into Mongo at merge.
 *  Used by Executor (records snapshot) and mergeToProduction (consumes snapshot). */
export interface AgentPendingUpdate {
  id: string;
  updates: any;
  expectedUpdatedAt?: Date;
  idempotencyKey: string;
}

export interface AgentPendingDelete {
  id: string;
  expectedUpdatedAt?: Date;
  idempotencyKey: string;
}

/** Sandbox draft of a form/view being created; persisted in Redis under sandbox:{userId}. */
export interface AgentDraftForm {
  idempotencyKey: string;
  _id?: string;
  formId?: string;
  isSandboxDraft?: boolean;
  [k: string]: any;
}

export interface AgentDraftView {
  idempotencyKey: string;
  _id?: string;
  isSandboxDraft?: boolean;
  [k: string]: any;
}

/** Canonical sandbox state. MUST be JSON-serializable for Redis + Mongo round-trip. */
export interface SandboxStoreState {
  forms: Record<string, AgentDraftForm>;
  customViews: Record<string, AgentDraftView>;
  queryResults: Record<string, any>;
  updates: AgentPendingUpdate[];
  deletes: AgentPendingDelete[];
}

export function emptySandboxStore(): SandboxStoreState {
  return { forms: {}, customViews: {}, queryResults: {}, updates: [], deletes: [] };
}

/** Coerce a possibly-legacy sandbox object to the canonical shape.
 *  Used on resume from Redis/Mongo to defend against old tickets. */
export function normalizeSandboxStore(raw: any): SandboxStoreState {
  if (!raw || typeof raw !== "object") return emptySandboxStore();
  return {
    forms: raw.forms && typeof raw.forms === "object" ? raw.forms : {},
    customViews:
      raw.customViews && typeof raw.customViews === "object" ? raw.customViews : {},
    queryResults:
      raw.queryResults && typeof raw.queryResults === "object" ? raw.queryResults : {},
    updates: Array.isArray(raw.updates) ? raw.updates : [],
    deletes: Array.isArray(raw.deletes) ? raw.deletes : [],
  };
}

/** Thrown by acquireAgentLock when another loop is already running for the user. */
export class AgentBusyError extends Error {
  constructor(message: string = "Another agent request is already running for this user.") {
    super(message);
    this.name = "AgentBusyError";
  }
}

/** Thrown when the agent loop exceeds LOOP_DEADLINE_MS. */
export class LoopTimeoutError extends Error {
  public readonly code = "LOOP_TIMEOUT";
  public readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`Agent loop exceeded deadline of ${deadlineMs}ms`);
    this.name = "LoopTimeoutError";
    this.deadlineMs = deadlineMs;
  }
}

/** Thrown when the user aborts a running agent loop via the abort API. */
export class AgentCancelledError extends Error {
  public readonly code = "AGENT_CANCELLED";
  public readonly ticketId: string;
  constructor(ticketId: string) {
    super(`Agent loop cancelled by user for ticket ${ticketId}`);
    this.name = "AgentCancelledError";
    this.ticketId = ticketId;
  }
}

export interface ExecutionTraceStep {
  stepId: string;
  timestamp: string;
  persona: PersonaStage;
  message: string;
  payload?: any;
  actionPlanRef?: string; // R9: reference to Planner's stepId instead of embedding actionPlan
}

export interface AgentState {
  userId: string;
  prompt: string;
  ticket: AgentTicket;
  activePersona: PersonaStage;
  iterationCount: number;
  maxIterations: number;
  
  // Accumulated context
  requirements: {
    skill?: string;
    skills?: string[]; // A-S2.1: multi-skill support
    formTitle?: string;
    formDescription?: string;
    fields?: Array<{ label: string; type: number; required?: boolean; options?: any[] }>;
    formId?: string;
    queryFilters?: Array<{ field: string; operator: string; value: any }>;
    linkedTicketId?: string;
    isFollowUpConfirmed?: boolean;
  };

  // Planned actions & execution state
  actionPlan: AgentAction[];

  // Isolated Sandbox State (canonical, JSON-serializable)
  sandbox: SandboxStoreState;

  // If this ticket was resumed with a NEW user prompt, we keep the original prompt
  // for trace clarity and store the new input here. See agentLoop.ts resume path.
  resumedPrompt?: string;

  // Layer 5: User Preferences Memory
  userContext?: {
    profile?: any;
    preferences?: any;
    recurringFields?: any; // A-S2.5: populated from memory hydration
  };
  recentContext?: any[];

  // A-S2.5: Memory hydration from MemoryService
  memory?: Record<string, any>;

  // Execution Telemetry Trace Log
  executionTrace?: ExecutionTraceStep[];

  // Output messages for UI
  drafterMessage?: string;
  evaluatorFeedback?: string;
  evaluatorDecision?: EvaluatorDecision;
  priorPlans?: Array<{
    iteration: number;
    actionPlan: AgentAction[];
    feedback: string;
  }>;
  llmRawOutput?: string;
  isQuestion?: boolean;
  reply?: string;
  isComplete?: boolean;

  // R5: Multi-turn conversation history for context continuity across turns.
  // Capped at MAX_HISTORY turns (user + assistant pairs).
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
    ticketId: string;
    timestamp: string;
  }>;

  // R1: flag indicating this is a read-only query that bypasses
  // Planner/Executor/Evaluator and goes directly DRAFTER → COMMUNICATOR.
  isReadOnly?: boolean;

  // A-S2.7: Merge stats for selective merge reply
  mergeStats?: MergeStats;

  // Streaming callback injected by agentLoop
  onChunk?: (chunk: string) => void;

  // R2.2 — temporary field for the loop to capture the last LLM call's usage
  // from each persona. Cleared by the loop after capture.
  lastLLMUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model: string;
  };

  // R2.2 — accumulated token usage across the current ticket.
  // Updated by agentLoop on each persona LLM call (usage comes from retryLLM -> LLMResult.usage).
  tokenUsage?: {
    total: number;
    byPersona: Record<string, { prompt: number; completion: number; total: number }>;
    estimatedCost: number;
  };
}

/* ============================================================
 * Stage 3 Contract Interfaces (frozen in Stage 1, impl in Stage 3)
 * These are interface-only exports — no implementation in Stage 1.
 * ============================================================ */

export type ExecutorRole = "executor_forms" | "executor_responses" | "executor_views" | "executor_generic";

export type ExecutionStatus =
  | "planning"
  | "executing"
  | "verifying"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "partial"
  | "cancelled";

export interface Checkpoint {
  checkpointId: string;
  taskId: string;
  taskStateSnapshot: Record<string, any>;
  sandboxSnapshotSha256: string;
  memoryPointers: string[];
  ts: number;
}

export interface TaskState {
  taskId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "waiting";
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
}

export interface TaskNode {
  taskId: string;
  role: ExecutorRole;
  skill: string;
  tool: string;
  params: Record<string, any>;
  dependsOn: string[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  metadata: {
    isDestructive: boolean;
    requiresConfirmation: boolean;
    idempotencyKey: string;
    estimatedTokens: number;
  };
  successCriteria: SuccessCriterion[];
}

export interface TaskEdge {
  from: string;
  to: string;
  type: "dependency" | "conditional" | "loop";
  condition?: string;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  retryableErrors: string[];
}

export interface SuccessCriterion {
  type: "tool_success" | "schema_match" | "value_check" | "custom";
  specification: any;
}

export interface FixDirective {
  taskId: string;
  action: "retry" | "replan" | "replace_tool" | "adjust_params";
  detail: string;
}

export interface Finding {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  message: string;
  relatedTaskId?: string;
  evidence?: any;
}

export interface CriticVerdict {
  verdict: "pass" | "conditional_pass" | "fail" | "escalate";
  score: number;
  findings: Finding[];
  requiredFixes: FixDirective[];
  retryGuidance?: string;
  escalationReason?: string;
}

export interface ExecutionPlan {
  planId: string;
  goal: string;
  tasks: TaskNode[];
  edges: TaskEdge[];
  checkpoints: Checkpoint[];
  estimatedCost: CostEstimate;
  riskAssessment: Risk[];
  fallbackPlan?: ExecutionPlan;
  metadata: {
    createdBy: "pi_planner" | "planner";
    model: string;
    tokenEstimate: number;
  };
}

export interface CostEstimate {
  estimatedTokens: number;
  estimatedCostUsd: number;
  breakdown: Record<string, number>;
}

export interface Risk {
  id: string;
  severity: "low" | "medium" | "high";
  description: string;
  mitigation?: string;
}

export interface MemoryScope {
  read: string[];
  write: string[];
  query?: string;
}

export interface MemoryPointer {
  type: "episodic" | "semantic" | "procedural";
  key: string;
  relevance: number;
}

export interface AgentContext {
  preferences: UserPreferences;
  recentTraces: ExecutionTraceStep[];
  relevantSkills: SkillDefinition[];
  procedural: ProceduralMemory[];
}

export interface UserPreferences {
  preferredFieldTypes: Record<string, number>;
  namingPatterns: string[];
  viewConfigs: Record<string, any>;
}

export interface SkillDefinition {
  skillId: string;
  name: string;
  version: string;
  permissionScope: string;
  tools: ToolRef[];
  maxIterations: number;
  negativeTests: NegativeTest[];
  dryRunShape: Record<string, any>;
  requiredParams: string[];
  optionalParams: string[];
}

export interface ToolRef {
  tool: string;
  paramsFrom: "requirements" | "memory" | "context";
}

export interface NegativeTest {
  assert: string;
  description: string;
}

export interface ProceduralMemory {
  pattern: string;
  frequency: number;
  proposedSkill: SkillDefinition;
  confidence: number;
}

export interface ExecutionState {
  executionId: string;
  userId: string;
  sessionId?: string;
  status: ExecutionStatus;
  plan: ExecutionPlan;
  taskStates: Map<string, TaskState>;
  checkpoints: Checkpoint[];
  budget: BudgetSnapshot;
  auditLog: AuditEntry[];
  memoryPointers: MemoryPointer[];
}

export interface BudgetSnapshot {
  totalTokens: number;
  totalCostUsd: number;
  perTask: Record<string, { tokens: number; costUsd: number }>;
  perUserDay: number;
  limits: {
    perTicket: number;
    perUserDay: number;
    perToolCall: number;
  };
}

export interface BudgetConfig {
  perExecution: number;
  perTask: number;
  perUserDay: number;
  perToolCall: number;
}

export interface AuditEntry {
  executionId: string;
  taskId?: string;
  role: string;
  event: "plan_start" | "tool_call" | "tool_result" | "verification" | "retry" | "checkpoint" | "merge";
  payload: any;
  metrics: {
    tokens: number;
    latencyMs: number;
    costUsd: number;
  };
  rationale: string;
  ts: number;
}