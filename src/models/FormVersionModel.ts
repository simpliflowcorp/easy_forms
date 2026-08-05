import mongoose from "mongoose";

export interface IFormVersionDocument {
  _id?: string;
  formId: string;
  version: number;
  ownerId: string;
  snapshot: Record<string, any>;
  reason: "agent_merge" | "user_edit" | "rollback_target";
  createdAt?: Date;
  updatedAt?: Date;
}

const FormVersionSchema = new mongoose.Schema(
  {
    formId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    ownerId: { type: String, required: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: {
      type: String,
      enum: ["agent_merge", "user_edit", "rollback_target"],
      required: true,
    },
  },
  { timestamps: true }
);

FormVersionSchema.index({ formId: 1, version: -1 }, { unique: true });
FormVersionSchema.index({ ownerId: 1, createdAt: -1 });

const FormVersionModel =
  mongoose.models?.FormVersion ||
  mongoose.model("FormVersion", FormVersionSchema);

export default FormVersionModel;
