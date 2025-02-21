import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, "Please provide a username"],
    unique: true,
  },

  email: {
    type: String,
    required: [true, "Please provide an email"],
    unique: true,
  },

  password: {
    type: String,
    required: [true, "Please provide a password"],
  },

  forms: [
    {
      form_id: Number,
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
    },
  ],

  isAdmin: {
    type: Boolean,
    default: false,
  },

  isVerified: {
    type: Boolean,
    default: false,
  },

  forgetPasswordToken: String,

  forgetPasswordExpiry: Date,
  verifyToken: String,
  verifyTokenExpiry: Date,
  secondaryEmail: { type: String, required: false },
  secondaryEmailVerifyCode: { type: String, required: false },
  secondaryVerifyCodeExpiry: { type: Date, required: false },
  notificationSettings: {
    popup: {
      formExpired: { type: Boolean, default: true },
      newResponse: { type: Boolean, default: true },
    },
    email: {
      formExpired: { type: Boolean, default: true },
      weeklySummary: { type: Boolean, default: false },
      responseAlert: { type: Boolean, default: false },
    },
  },
});

const User = mongoose.models.users || mongoose.model("users", userSchema);

export default User;
