import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = new Redis(redisUrl);

/**
 * Phase 6.3 (#16): simulated-offline is now per-ticket, not global.
 *
 * Request body:
 *   { simulateOffline: true,  ticketId: "<current ticket>" }
 *   { simulateOffline: false, ticketId: "<current ticket>" }
 *
 * `ticketId` is required — the legacy global key `agent:simulated_offline`
 * is no longer supported.
 */
export async function POST(req: NextRequest) {
  try {
    const { simulateOffline, ticketId } = await req.json();

    if (!ticketId || typeof ticketId !== "string") {
      return NextResponse.json(
        { error: "ticketId required" },
        { status: 400 }
      );
    }

    const key = `agent:simulated_offline:${ticketId}`;
    if (simulateOffline) {
      await pubClient.set(key, "true");
    } else {
      await pubClient.del(key);
    }

    // Health-broadcast retains the public channel semantics so the existing UI
    // sidebar indicator continues to reflect simulation state.
    await pubClient.publish(
      "agent:llm_health",
      JSON.stringify({ status: simulateOffline ? "offline" : "online" }),
    );

    return NextResponse.json({ success: true, simulateOffline, ticketId });
  } catch (error) {
    return NextResponse.json({ error: "Failed to toggle simulation" }, { status: 500 });
  }
}
