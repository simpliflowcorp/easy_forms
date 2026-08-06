import mongoose from "mongoose";

const AgentTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    prompt: { type: String, required: true },
    stage: { type: String, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "PROCESSING", "RESOLVED", "REJECTED", "LLM_ERROR", "CANCELLED"], required: true },
    errorKind: {
      type: String,
      enum: ["timeout", "rate_limit", "http_5xx", "offline", "cancelled", "oom", "unknown"],
      index: true,
      default: "unknown",
    },
    activePersona: { type: String, required: true },
    iterationCount: { type: Number, default: 1 },
    maxIterations: { type: Number, default: 3 },
    requirements: { type: mongoose.Schema.Types.Mixed, default: {} },
    actionPlan: { type: mongoose.Schema.Types.Mixed, default: [] },
    sandbox: { type: mongoose.Schema.Types.Mixed, default: {} },
    executionTrace: { type: mongoose.Schema.Types.Mixed, default: [] },
    reply: { type: String, default: "" },
    isComplete: { type: Boolean, default: false },
    isQuestion: { type: Boolean, default: false },
    resumedPrompt: { type: String },
    drafterMessage: { type: String },
    evaluatorFeedback: { type: String },
    llmRawOutput: { type: String },
  },
  { timestamps: true }
);

// TTL index for transient tickets (30 days).
// Only expires tickets that are NOT RESOLVED, NOT CANCELLED, and NOT AWAITING_USER_APPROVAL.
// RESOLVED, CANCELLED, and AWAITING_USER_APPROVAL tickets are kept indefinitely for audit/resume.
AgentTicketSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 3600,
    partialFilterExpression: {
      status: { $nin: ["RESOLVED", "CANCELLED"] },
      activePersona: { $nin: ["AWAITING_USER_APPROVAL"] },
    },
  }
);

const AgentTicket = mongoose.models?.AgentTicket || mongoose.model("AgentTicket", AgentTicketSchema);

export default AgentTicket;
