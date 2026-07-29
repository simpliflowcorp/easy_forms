export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import kv from "@/lib/redis";

const createPubSubClient = () => {
  if (process.env.NODE_ENV === "development") {
    // Only use duplicate() in development (ioredis)
    const pubSub = (kv.client as import("ioredis").Redis).duplicate();
    pubSub.on("error", () => {});
    return pubSub;
  }
  return null;
};

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Send existing notifications first (if KV is configured)
        if (process.env.KV_REST_API_URL || process.env.EASY_FORM_KV_REST_API_URL || process.env.NODE_ENV === "development") {
          try {
            const pending = await kv.lrange(`notifications:${userId}`, 0, -1);
            if (pending && pending.length > 0) {
              pending.forEach((msg) => {
                if (!isClosed) controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
              });
              await kv.del(`notifications:${userId}`);
            }
            await kv.set(`active:${userId}`, "true", { ex: 60 });
          } catch (kvError) {
            console.error("SSE KV fetch error:", kvError);
          }
        }

        // 2. Create dedicated pub/sub connection if supported
        const pubSub = createPubSubClient();

        if (pubSub) {
          await pubSub.subscribe(`user:${userId}`);

          pubSub.on("message", (channel, message) => {
            if (channel === `user:${userId}` && !isClosed) {
              try {
                controller.enqueue(encoder.encode(`data: ${message}\n\n`));
              } catch (err) {}
            }
          });
        }

        // 3. Heartbeat system
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

        // 4. Cleanup on disconnect
        req.signal.onabort = async () => {
          clearInterval(heartbeat);
          if (pubSub) {
            try {
              await pubSub.unsubscribe();
              await pubSub.quit();
            } catch (err) {}
          }
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (err) {}
          }
        };
      } catch (error) {
        console.error("SSE Connection Error:", error);
      }
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

export async function POST(req: NextRequest) {
  try {
    const { userId, message } = await req.json();
    if (!userId) return new Response("Invalid request", { status: 400 });

    // Always store the notification first
    await kv.lpush(`notifications:${userId}`, JSON.stringify(message));
    await kv.ltrim(`notifications:${userId}`, 0, 99);
    await kv.expire(`notifications:${userId}`, 604800);

    // Enhanced active check
    const activeValue = await kv.get(`active:${userId}`);
    const isActive = activeValue !== null;

    if (isActive && process.env.NODE_ENV === "development") {
      try {
        const pubSub = createPubSubClient();
        if (pubSub) {
          await pubSub.publish(`user:${userId}`, JSON.stringify(message));
          pubSub.disconnect();
        }
      } catch (pubSubError) {
        console.error("Pub/Sub error:", pubSubError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notification Error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
