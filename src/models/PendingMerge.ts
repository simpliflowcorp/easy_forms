import mongoose from "mongoose";

const PendingMergeSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { 
      type: String, 
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], 
      default: "PENDING" 
    },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    error: { type: String },
  },
  { timestamps: true }
);

PendingMergeSchema.index({ ticketId: 1, userId: 1 }, { unique: true });

const PendingMerge = mongoose.models?.PendingMerge || mongoose.model("PendingMerge", PendingMergeSchema);

export default PendingMerge;