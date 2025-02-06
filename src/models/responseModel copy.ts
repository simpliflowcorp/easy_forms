import mongoose from "mongoose";

const ResponseSchema = new mongoose.Schema(
  {
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    answers: [
      {
        elementId: {
          type: String,
          required: true,
          index: true,
        },
        type: {
          type: String,
          enum: ["text", "number", "date", "select", "checkbox", "file"],
          required: true,
        },
        value: mongoose.Schema.Types.Mixed,
        metadata: {
          textValue: String,
          numericValue: Number,
          dateValue: Date,
          options: [String],
          fileInfo: {
            url: String,
            mimeType: String,
            size: Number,
          },
        },
      },
    ],
    analytics: {
      completionTime: Number, // Seconds
      deviceType: String,
      geoLocation: {
        country: String,
        region: String,
        city: String,
      },
    },
  },
  { timestamps: true }
);

// Indexes for common queries
ResponseSchema.index({
  "answers.elementId": 1,
  "answers.type": 1,
  submittedAt: -1,
});

const Response =
  mongoose.models.response || mongoose.model("response", ResponseSchema);

export default Response;
