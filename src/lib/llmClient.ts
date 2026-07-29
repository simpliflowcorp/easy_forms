export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string; // Used for tool responses
  tool_calls?: any[]; // Used when assistant calls a tool
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  tools?: any[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export async function callLLM(messages: LLMMessage[], options: LLMOptions = {}): Promise<any> {
  const apiKey = process.env.NVIDIA_API_KEY;
  const baseUrl = "https://integrate.api.nvidia.com/v1/chat/completions";

  const payload = {
    model: options.model || "meta/llama-3.1-70b-instruct",
    messages,
    temperature: options.temperature ?? 0.2,
    top_p: options.top_p ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    stream: false,
    response_format: options.response_format,
    tools: options.tools,
    tool_choice: options.tool_choice,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout is plenty for 70B cloud

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LLM API Error: ${res.status} - ${errBody}`);
    }

    const data = await res.json();
    return data.choices[0].message;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
