import mongoose from "mongoose";
import type { Checkpoint } from "@/agent/types";

export interface IOrchestratorCheckpointDocument extends Checkpoint {
  _id?: string;
  executionId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const OrchestratorCheckpointSchema = new mongoose.Schema(
  {
    executionId: { type: String, required: true, index: true },
    checkpointId: { type: String, required: true, unique: true, index: true },
    taskId: { type: String, required: true, default: "" },
    taskStateSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    sandboxSnapshotSha256: { type: String, required: true },
    memoryPointers: [{ type: String }],
    ts: { type: Number, required: true, index: true },
  },
  { timestamps: true }
);

OrchestratorCheckpointSchema.index({ executionId: 1, ts: -1 });

const OrchestratorCheckpointModel =
  mongoose.models?.OrchestratorCheckpoint ||
  mongoose.model("OrchestratorCheckpoint", OrchestratorCheckpointSchema);

export default OrchestratorCheckpointModel;
