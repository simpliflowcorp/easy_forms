import mongoose from "mongoose";

const AgentAuditEventSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  resourceId: { type: String, required: true },
  action: { type: String, required: true },
  serverDiff: { type: mongoose.Schema.Types.Mixed },
  outcome: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const AgentAuditEvent = mongoose.models?.AgentAuditEvent || mongoose.model("AgentAuditEvent", AgentAuditEventSchema);

export default AgentAuditEvent;
