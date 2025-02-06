// models/Response.model.ts
import mongoose from "mongoose";

const ResponseSchema = new mongoose.Schema(
  {
    form_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    submitted_at: {
      type: Date,
      default: Date.now,
      index: true,
    },

    data: mongoose.Schema.Types.Mixed, // Flexible JSON structure

    normalized_data: {
      // For analytics/querying
      type: Map,
      of: mongoose.Schema.Types.Mixed,
    },

    metadata: {
      ip_address: String,
      user_agent: String,
      duration_seconds: Number,
    },
  },
  {
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for common query patterns
ResponseSchema.index({ form_id: 1, submitted_at: -1 });

const Response =
  mongoose.models.response || mongoose.model("response", ResponseSchema);

export default Response;
