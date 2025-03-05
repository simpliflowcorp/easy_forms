import { NextRequest } from "next/server";
import kv from "@/lib/redis";

// Track active connections
const activeConnections = new Map<string, WritableStreamDefaultWriter>();

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Store connection
  activeConnections.set(userId, writer);

  // Track active user in Redis
  await kv.set(`active:${userId}`, "true", { ex: 300 });

  // Send pending notifications
  const pending = await kv.lrange(`notifications:${userId}`, 0, -1);
  pending.forEach((notification) => {
    writer.write(encoder.encode(`data: ${notification}\n\n`));
  });
  await kv.del(`notifications:${userId}`);

  // Heartbeat
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode("data: ♥\n\n"));
  }, 25000);

  // Cleanup
  req.signal.onabort = async () => {
    clearInterval(heartbeat);
    activeConnections.delete(userId);
    await kv.del(`active:${userId}`);
    writer.close();
  };

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// New endpoint to send notifications
export async function POST(req: NextRequest) {
  const { userId, message } = await req.json();

  if (activeConnections.has(userId)) {
    const writer = activeConnections.get(userId);
    const encoder = new TextEncoder();
    writer?.write(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
  } else {
    await kv.lpush(`notifications:${userId}`, JSON.stringify(message));
    await kv.expire(`notifications:${userId}`, 604800);
  }

  return new Response(JSON.stringify({ success: true }));
}
