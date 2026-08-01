import mongoose from "mongoose";

const AgentAuditEventSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  resourceId: { type: String, required: true, index: true },
  action: { 
    type: String, 
    required: true,
    enum: ["create_form", "update_form", "delete_form", "create_view"] 
  },
  serverDiff: { type: mongoose.Schema.Types.Mixed },
  outcome: { 
    type: String, 
    required: true,
    enum: ["success", "concurrency_miss", "error"]
  },
  createdAt: { type: Date, default: Date.now },
});

AgentAuditEventSchema.index({ resourceId: 1, createdAt: -1 });

const AgentAuditEvent = mongoose.models?.AgentAuditEvent || mongoose.model("AgentAuditEvent", AgentAuditEventSchema);

export default AgentAuditEvent;
