export type PersonaStage =
  | "DRAFTER"
  | "PLANNER"
  | "EXECUTOR_SANDBOX"
  | "EVALUATOR"
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

export interface SandboxStoreState {
  forms: Record<string, any>;
  customViews: Record<string, any>;
  queryResults: Record<string, any>;
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
  };

  // Planned actions & execution state
  actionPlan: AgentAction[];
  
  // Isolated Sandbox State
  sandbox: SandboxStoreState;

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
