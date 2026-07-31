import { callLLM } from "./src/lib/llmClient";
import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: '.env.local' });

async function run() {
  try {
    const res = await callLLM([{ role: "user", content: "Hello" }]);
    console.log("Success:", res);
  } catch (err) {
    console.error("Failed:", err);
  }
}
run();
