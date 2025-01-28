import mongoose from "mongoose";

const formSchema = new mongoose.Schema({
  // Form Schema

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  form_name: {
    type: String,
    required: true,
  },
  form_description: {
    type: String,
    default: "",
  },
  form_expiry: {
    type: Date, // Use Date instead of number for easier querying
    required: true,
  },
  elements: [
    {
      id: {
        type: String,
        required: true,
      }, // Unique identifier for the element (e.g., "q1")
      type: {
        type: String,
        enum: ["text", "radio", "checkbox", "dropdown"],
        required: true,
      },
      question: {
        type: String,
        required: true,
      },
      options: [
        {
          type: String,
        },
      ], // For radio/checkbox/dropdown
      required: {
        type: Boolean,
        default: false,
      },
    },
  ],
  created_at: {
    type: Date,
    default: Date.now,
  },
  is_published: {
    type: Boolean,
    default: false,
  },
  // Add settings for analytics (optional):
  collect_metadata: {
    ip: { type: Boolean, default: false },
    user_agent: { type: Boolean, default: false },
  },
});

const User = mongoose.models.form || mongoose.model("form", formSchema);

export default User;
