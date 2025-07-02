import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { message } = await req.json();

  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2",
      messages: [
        {
          role: "system",
          // content: `You are a bilingual (English and 中文) form builder assistant. The user will describe a form in natural language.
          //           Your job is to respond with either:
          //           - a follow-up question if the form is missing required fields or description
          //           - OR a structured JSON object like this:
          //           {
          //             "name": "Form title",
          //             "description": "Short description",
          //             "expiry": "ISO date string",
          //             "elements": [
          //               { "elementId": "field1", "type": 1, "label": "Name", "required": true, "options": [], "unique": false }
          //             ],
          //             "status": 2
          //           }
          //           Only return either JSON or a simple follow-up question.`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      stream: false,
    }),
  });

  const data = await res.json();
  return NextResponse.json({ reply: data.message.content });
}
