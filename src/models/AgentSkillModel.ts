import mongoose from "mongoose";
import type { SkillDefinition } from "@/agent/types";

export interface IAgentSkill {
  _id?: string;
  userId: string;
  name: string;
  version: string;
  definition: SkillDefinition | Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const AgentSkillSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, unique: true, index: true },
    version: { type: String, required: true, immutable: true },
    definition: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

const AgentSkill =
  mongoose.models?.AgentSkill ||
  mongoose.model("AgentSkill", AgentSkillSchema);

export default AgentSkill;
