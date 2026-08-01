import { NextResponse } from "next/server";

export async function GET() {
  const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 
    (process.env.NODE_ENV === "production" 
      ? `wss://${process.env.NEXT_PUBLIC_DOMAIN}/api/ws`
      : `ws://localhost:${process.env.WS_PORT || 3001}/api/ws`);

  return NextResponse.json({
    wsUrl,
    protocols: ["agent-v1"],
    auth: {
      method: "token",
      param: "token",
    },
  });
}