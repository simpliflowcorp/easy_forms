import mongoose from "mongoose";

export interface ICustomView {
  _id?: string;
  user: mongoose.Types.ObjectId;
  formId: string;
  name: string;
  filters: Array<{
    field: string;
    operator: "equals" | "contains" | "gt" | "gte" | "lt" | "lte" | "ne";
    value: any;
  }>;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  visibleColumns?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomViewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    formId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    filters: [
      {
        field: { type: String, required: true },
        operator: {
          type: String,
          enum: ["equals", "contains", "gt", "gte", "lt", "lte", "ne"],
          default: "contains",
        },
        value: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    sortField: { type: String, default: "submitted_at" },
    sortOrder: { type: String, enum: ["asc", "desc"], default: "desc" },
    visibleColumns: [{ type: String }],
  },
  {
    timestamps: true,
  }
);

CustomViewSchema.index({ user: 1, formId: 1 });

const CustomView =
  mongoose.models?.CustomView ||
  mongoose.model("CustomView", CustomViewSchema);

export default CustomView;
