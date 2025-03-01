// app/api/sse/route.ts
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (message: string) => {
        controller.enqueue(`data: ${message}\n\n`);
      };

      sendEvent("Notification 1");
      sendEvent("Notification 2");

      const interval = setInterval(() => sendEvent("New update!"), 5000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
