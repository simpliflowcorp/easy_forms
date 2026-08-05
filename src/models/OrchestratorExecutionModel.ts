import mongoose from "mongoose";
import type {
  ExecutionStatus,
  ExecutionPlan,
  TaskState,
  Checkpoint,
  AuditEntry,
  BudgetSnapshot,
  MemoryPointer,
} from "@/agent/types";

export interface FormVersionPointer {
  taskId: string;
  formId: string;
  versionId: string;
}

export interface IOrchestratorExecutionDocument {
  _id?: string;
  executionId: string;
  userId: string;
  sessionId?: string;
  status: ExecutionStatus;
  rootPlan: ExecutionPlan;
  taskStates: Map<string, TaskState> | Record<string, TaskState>;
  agentStates?: Record<string, any>;
  memoryPointers?: MemoryPointer[] | string[];
  formVersionPointers?: FormVersionPointer[];
  budgetConsumed?: BudgetSnapshot | Record<string, any>;
  checkpoints?: Checkpoint[];
  auditLog?: AuditEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

const OrchestratorExecutionSchema = new mongoose.Schema(
  {
    executionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    sessionId: { type: String },
    status: {
      type: String,
      enum: [
        "planning",
        "executing",
        "verifying",
        "awaiting_approval",
        "completed",
        "failed",
        "partial",
        "cancelled",
      ],
      required: true,
      index: true,
    },
    rootPlan: { type: mongoose.Schema.Types.Mixed, required: true },
    taskStates: { type: mongoose.Schema.Types.Mixed, default: {} },
    agentStates: { type: mongoose.Schema.Types.Mixed, default: {} },
    memoryPointers: [{ type: mongoose.Schema.Types.Mixed }],
    formVersionPointers: [
      {
        taskId: { type: String, required: true },
        formId: { type: String, required: true },
        versionId: { type: String, required: true },
      },
    ],
    budgetConsumed: { type: mongoose.Schema.Types.Mixed, default: {} },
    checkpoints: [{ type: mongoose.Schema.Types.Mixed }],
    auditLog: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true }
);

OrchestratorExecutionSchema.index({ userId: 1, status: 1 });

const OrchestratorExecutionModel =
  mongoose.models?.OrchestratorExecution ||
  mongoose.model("OrchestratorExecution", OrchestratorExecutionSchema);

export default OrchestratorExecutionModel;
