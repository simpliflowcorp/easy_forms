import mongoose from "mongoose";
import type { SkillDefinition } from "@/agent/types";

export interface IAgentSkill {
  _id?: string;
  userId: string;
  name: string;
  version: string;
  definition: SkillDefinition | Record<string, any>;
  deprecatedAt?: Date | null;
  versionChain?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const AgentSkillSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    version: { type: String, required: true, immutable: true },
    definition: { type: mongoose.Schema.Types.Mixed, required: true },
    deprecatedAt: { type: Date, default: null, index: true },
    versionChain: [{ type: String, default: [] }],
  },
  { timestamps: true }
);

AgentSkillSchema.index({ userId: 1, name: 1, version: 1 }, { unique: true });
AgentSkillSchema.index({ userId: 1, name: 1, deprecatedAt: 1 });

const AgentSkill =
  mongoose.models?.AgentSkill ||
  mongoose.model("AgentSkill", AgentSkillSchema);

export default AgentSkill;
