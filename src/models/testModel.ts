import mongoose from "mongoose";

const testsSchema = new mongoose.Schema({
  test: String,
});

const Test = mongoose.models.tests || mongoose.model("tests", testsSchema);

export default Test;
