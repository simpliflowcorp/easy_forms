export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/llmClient";

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    const response = await callLLM([
      {
        role: "system",
        content: `You are an AI assistant for Easy Forms. Respond in Markdown. Keep it brief. 
        Context: The user is asking about form details.`,
      },
      { role: "user", content: message },
    ]);
    
    return NextResponse.json({ reply: response?.content || "No response generated." });
  } catch (error: any) {
    console.error("Chat API Error:", error.message);
    return NextResponse.json({ reply: "I encountered an error connecting to the AI." });
  }
}
