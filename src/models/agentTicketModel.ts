import mongoose from "mongoose";

const AgentTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    prompt: { type: String, required: true },
    stage: { type: String, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "PROCESSING", "RESOLVED", "REJECTED", "LLM_ERROR"], required: true },
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

const AgentTicket = mongoose.models?.AgentTicket || mongoose.model("AgentTicket", AgentTicketSchema);

export default AgentTicket;
