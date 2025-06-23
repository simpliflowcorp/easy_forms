import mongoose from "mongoose";
import { date } from "zod";

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
      form_id: { type: mongoose.Schema.Types.ObjectId, ref: "Form" }, // Corrected
      form_name: String,
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
  profile: {
    firstName: { type: String, required: false },
    lastName: { type: String, required: false },
    dob: { type: String, required: false },
    phoneNumber: { type: String, required: false },
    address: { type: String, required: false },
    city: { type: String, required: false },
    state: { type: String, required: false },
    country: { type: String, required: false },
    zipCode: { type: String, required: false },
    about: { type: String, required: false },
    profileImage: { type: String, required: false },
    website: { type: String, required: false },
  },
  preferences: {
    dateFormat: { type: String, default: "dd-mm-yyyy" },
    country: { type: String, default: "IN" },
    timeFormat: { type: String, default: "12" },
    language: { type: String, default: "en" },
  },
  isGoogleAuth: {
    type: Boolean,
    default: false,
  },
  GoogleSheetAccessToken: {
    type: String,
    required: false,
  },
  notificationSettings: {
    popup: {
      formExpired: { type: Boolean, default: true },
      newResponseAlert: { type: Boolean, default: true },
    },
    email: {
      formExpired: { type: Boolean, default: true },
      newResponseAlert: { type: Boolean, default: false },
      responseSummary: { type: Boolean, default: false },
    },
  },
});

const User = mongoose.models.users || mongoose.model("users", userSchema);

export default User;
