const dotenv = require("dotenv");
dotenv.config();

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gemini-1.5-flash", messages: [{role: "user", content: "Hello"}] })
  });
  console.log(await res.json());
}
run();
