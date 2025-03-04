import { NextRequest } from "next/server";
import kv from "@/lib/redis";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Track active user
  await kv.set(`active:${userId}`, "true", { ex: 300 });

  // Heartbeat
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode("data: ♥\n\n"));
  }, 25000);

  // Cleanup
  req.signal.onabort = async () => {
    clearInterval(heartbeat);
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
