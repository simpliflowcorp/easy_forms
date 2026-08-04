import mongoose from "mongoose";
import type { AuditEntry } from "@/agent/types";

export interface IOrchestratorAuditDocument extends AuditEntry {
  _id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const OrchestratorAuditSchema = new mongoose.Schema(
  {
    executionId: { type: String, required: true, index: true },
    taskId: { type: String },
    role: { type: String, required: true },
    event: {
      type: String,
      enum: [
        "plan_start",
        "tool_call",
        "tool_result",
        "verification",
        "retry",
        "checkpoint",
        "merge",
        "replan",
      ],
      required: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed },
    metrics: {
      tokens: { type: Number, default: 0 },
      latencyMs: { type: Number, default: 0 },
      costUsd: { type: Number, default: 0 },
    },
    rationale: { type: String, default: "" },
    ts: { type: Number, default: Date.now, index: true },
  },
  { timestamps: true }
);

OrchestratorAuditSchema.index({ executionId: 1, ts: 1 });

const OrchestratorAuditModel =
  mongoose.models?.OrchestratorAudit ||
  mongoose.model("OrchestratorAudit", OrchestratorAuditSchema);

export default OrchestratorAuditModel;
