import mongoose from "mongoose";

const AgentUsageSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  persona: { type: String, required: true, index: true },
  model: { type: String, required: true },
  promptTokens: { type: Number, required: true, default: 0 },
  completionTokens: { type: Number, required: true, default: 0 },
  totalTokens: { type: Number, required: true, default: 0 },
  costUsd: { type: Number, default: 0 },
  latencyMs: { type: Number, index: true, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true },
});

AgentUsageSchema.index({ userId: 1, createdAt: -1 });
AgentUsageSchema.index({ ticketId: 1, persona: 1 });

const AgentUsage = mongoose.models?.AgentUsage || mongoose.model("AgentUsage", AgentUsageSchema);

export default AgentUsage;