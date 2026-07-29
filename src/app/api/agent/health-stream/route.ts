export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import Redis from "ioredis";
import { startLlmHealthMonitor, getCachedHealthStatus } from "@/lib/llmHealthMonitor";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export async function GET(req: NextRequest) {
  // Ensure the centralized background monitor is running
  startLlmHealthMonitor();

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 1. Create a dedicated Redis subscriber for this client
      const subClient = new Redis(redisUrl);
      subClient.on("error", () => {});

      // 2. Send the immediate known health status to client
      try {
        const initialStatus = getCachedHealthStatus();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: initialStatus })}\n\n`));
      } catch (e) {}

      // 3. Subscribe to health changes
      await subClient.subscribe("agent:llm_health");
      subClient.on("message", (channel, message) => {
        if (channel === "agent:llm_health" && !isClosed) {
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch (err) {}
        }
      });

      // 4. Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(":heartbeat\n\n"));
          } catch (err) {
            clearInterval(heartbeat);
          }
        } else {
          clearInterval(heartbeat);
        }
      }, 15000);

      // 5. Cleanup when client disconnects
      req.signal.onabort = () => {
        isClosed = true;
        clearInterval(heartbeat);
        try {
          subClient.unsubscribe();
          subClient.quit();
        } catch (err) {}
        try {
          controller.close();
        } catch (err) {}
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
