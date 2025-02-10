import mongoose from "mongoose";

const UniqueValueSchema = new mongoose.Schema({
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Form",
    required: true,
  },
  elementId: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
});

// Compound unique index
UniqueValueSchema.index(
  { formId: 1, elementId: 1, value: 1 },
  { unique: true }
);

export default mongoose.models.UniqueValue ||
  mongoose.model("UniqueValue", UniqueValueSchema);
