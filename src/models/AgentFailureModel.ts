import mongoose from "mongoose";

export interface IAgentFailureDocument {
  _id?: string;
  userId: string;
  promptHash: string;
  error: string;
  count: number;
  lastAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const AgentFailureSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    promptHash: { type: String, required: true },
    error: { type: String, required: true },
    count: { type: Number, default: 1 },
    lastAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AgentFailureSchema.index({ userId: 1, promptHash: 1 }, { unique: true });
AgentFailureSchema.index(
  { lastAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600 }
);

const AgentFailureModel =
  mongoose.models?.AgentFailure ||
  mongoose.model("AgentFailure", AgentFailureSchema);

export default AgentFailureModel;
