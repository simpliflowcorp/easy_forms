import { getLlama, LlamaChatSession } from "node-llama-cpp";

let session: LlamaChatSession | null = null;

export async function initAI() {
  if (session) return session;

  const llama = await getLlama();
  const model = await llama.loadModel({
    modelPath: "public/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
  });

  const context = await model.createContext();
  session = new LlamaChatSession({ context });

  return session;
}
