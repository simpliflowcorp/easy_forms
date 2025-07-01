// /pages/api/chat-form.ts

import type { NextApiRequest, NextApiResponse } from "next";

let conversationHistory: any[] = [];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { message } = req.body;

  conversationHistory.push({ role: "user", content: message });

  // Inject system prompt for JSON format rules
  const systemPrompt = `
You are a bilingual (English/中文) form builder assistant. The user will describe a form. 
Your job is to respond in either natural language or structured JSON.
If you have enough info, respond with a complete JSON form:
{
  "name": "",
  "description": "",
  "expiry": "",
  "elements": [
    {
      "elementId": "string",
      "type": "number", // e.g. 1 = text, 4 = email, 2 = number, 14 = radio, etc.
      "label": "string",
      "required": true,
      "options": [],
      "unique": false
    }
  ],
  "status": 2
}

Rules:
- If form description is missing, ask the user to provide one.
- If no field is marked required, ask: “Which fields should be required?”
- Always return valid JSON or a single follow-up question.
- Support English and Chinese.

Only respond with one item: either JSON or a question.
`;

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral",
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
      ],
      stream: false,
    }),
  });

  const data = await response.json();
  const aiMessage = data.message.content;

  conversationHistory.push({ role: "assistant", content: aiMessage });

  res.status(200).json({ reply: aiMessage });
}
