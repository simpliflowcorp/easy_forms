// app/api/sse/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import kv from "@/lib/redis";

export async function POST(req: NextRequest) {
  const { userId, message } = await req.json();

  try {
    // Check if user has active SSE connection
    const isActive = await kv.exists(`active:${userId}`);

    if (isActive) {
      // Send real-time notification
      await fetch(`http://localhost:3000/api/sse?userId=${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
    } else {
      // Store notification
      await kv.lpush(`notifications:${userId}`, JSON.stringify(message));
      await kv.expire(`notifications:${userId}`, 604800); // 7 days
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notification failed:", error);
    return NextResponse.json(
      { error: "Failed to process notification" },
      { status: 500 }
    );
  }
}
