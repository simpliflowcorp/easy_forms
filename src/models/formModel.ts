import Hashids from "hashids";
import mongoose from "mongoose";

interface FormElement {
  elementId: string;
  type: number;
  label: string;
  required: boolean;
  unique: boolean;
  options?: Array<{
    id: string;
    value: string;
    label: string;
  }>;
  position: number;
  column: number;
}

interface FormAnalytics {
  totalResponses: number;
  dailyResponses: Array<{
    date: Date;
    count: number;
  }>;
  totalVisits: number;
  dailyVisits: Array<{
    date: Date;
    count: number;
  }>;
}

const FormElementSchema = new mongoose.Schema<FormElement>({
  elementId: { type: String, required: true },
  type: { type: Number, required: true },
  label: { type: String, required: true },
  required: { type: Boolean, default: false },
  unique: {
    type: Boolean,
    default: false,
  },

  options: [
    {
      id: Number,
      label: String,
      value: String,
    },
  ],
  position: { type: Number, required: true },
  column: { type: Number, required: true },
});

const FormAnalyticsSchema = new mongoose.Schema(
  {
    totalResponses: { type: Number, default: 0 },
    totalVisits: { type: Number, default: 0 },
    dailyResponses: [
      {
        date: { type: Date, required: true, index: true },
        count: { type: Number, default: 0 },
      },
    ],
    dailyVisits: [
      {
        date: { type: Date, required: true, index: true },
        count: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

const FormChangeHistorySchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    action: { type: mongoose.Schema.Types.Mixed }, // String or Array
    changes: { type: String },
    effects: { type: String },
    result: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const formSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    expiry: {
      type: Date,
      required: true,
      index: true,
    },
    elements: [FormElementSchema],
    status: {
      type: Number,
      default: 0,
    },
    analytics: {
      type: FormAnalyticsSchema,
      default: () => ({}),
    },
    changeHistory: [FormChangeHistorySchema],
    metadataSettings: {
      ip: { type: Boolean, default: false },
      userAgent: { type: Boolean, default: false },
      geolocation: { type: Boolean, default: false },
      referrer: { type: Boolean, default: false },
    },
    formId: {
      type: String,
      unique: true,
      default: function () {
        const hashids = new Hashids("salt", 6);
        return hashids.encode(new Date().getTime());
      },
    },
    /**
     * Idempotency key written by the agent merge step so a re-merge of the
     * same sandbox draft never creates a duplicate production form.
     * Sparse + unique so legacy/normal creates (which leave it unset) are
     * still allowed to have many nulls.
     */
    agentIdempotencyKey: {
      type: String,
      index: { unique: true, sparse: true },
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for common queries
formSchema.index({ user: 1, status: 1 });
formSchema.index({ "elements.elementId": 1 });
formSchema.index({ expiry: 1, status: 1 }); // Compound index

// Virtual for form expiration status
formSchema.virtual("isExpired").get(function () {
  return this.expiry < new Date();
});

const Form = mongoose.models?.Form || mongoose.model("Form", formSchema);

export default Form;
