import mongoose from "mongoose";
import type { AgentSkillUsage } from "@/agent/memory/types";

export interface IAgentSkillUsageDocument extends AgentSkillUsage {
  _id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AgentSkillUsageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    skill: { type: String, required: true },
    count: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },
    avgIterations: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AgentSkillUsageSchema.index({ userId: 1, skill: 1 }, { unique: true });

const AgentSkillUsageModel =
  mongoose.models?.AgentSkillUsage ||
  mongoose.model("AgentSkillUsage", AgentSkillUsageSchema);

export default AgentSkillUsageModel;
