import mongoose from "mongoose";
import type { AgentMemory } from "@/agent/memory/types";

export interface IAgentMemoryDocument extends AgentMemory {
  _id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AgentMemorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    confidence: {
      type: Number,
      required: true,
      default: 0.5,
      min: 0,
      max: 1,
    },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AgentMemorySchema.index({ userId: 1, key: 1 }, { unique: true });

const AgentMemoryModel =
  mongoose.models?.AgentMemory ||
  mongoose.model("AgentMemory", AgentMemorySchema);

export default AgentMemoryModel;
