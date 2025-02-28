// models/notificationModel.ts
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["FORM_EXPIRED", "NEW_RESPONSE"],
      required: true,
    },
    message: String,
    relatedForm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
    },
    read: {
      type: Boolean,
      default: false,
    },
    triggeredAt: { type: Date, required: true },
    deliveryStatus: {
      type: String,
      enum: ["pending", "delivered", "failed"],
      default: "pending",
    },
    retries: { type: Number, default: 0 },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });

const Notification =
  mongoose.models?.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
