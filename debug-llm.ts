import { config } from "dotenv";
config();
import { callLLM } from "./src/lib/llmClient";

async function run() {
  console.log("Key:", process.env.NVIDIA_API_KEY ? "Loaded" : "Missing");
  try {
    const res = await callLLM([{ role: "user", content: "hi" }]);
    console.log("Success:", res);
  } catch (err: any) {
    console.error("Failed:", err.message);
  }
}
run();
