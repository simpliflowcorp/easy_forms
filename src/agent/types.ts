import mongoose from "mongoose";

export type PersonaStage =
  | "DRAFTER"
  | "PLANNER"
  | "EXECUTOR_SANDBOX"
  | "EVALUATOR"
  | "COMMUNICATOR"
  | "AWAITING_USER_APPROVAL"
  | "MERGED_TO_PRODUCTION"
  | "REJECTED";

export type TicketStage = "STAGE_1" | "STAGE_2" | "STAGE_3";



export interface AgentTicket {
  ticketId: string;
  stage: TicketStage;
  title: string;
  prompt: string;
  formId?: string;
  createdAt: string;
  status: "OPEN" | "PROCESSING" | "RESOLVED" | "REJECTED" | "LLM_ERROR";
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

export interface ExecutionTraceStep {
  stepId: string;
  timestamp: string;
  persona: PersonaStage;
  message: string;
  payload?: any;
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

  // Execution Telemetry Trace Log
  executionTrace?: ExecutionTraceStep[];

  // Output messages for UI
  drafterMessage?: string;
  evaluatorFeedback?: string;
  llmRawOutput?: string;
  isQuestion?: boolean;
  reply?: string;
  isComplete?: boolean;
}
