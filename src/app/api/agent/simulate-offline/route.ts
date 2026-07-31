import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = new Redis(redisUrl);

/**
 * Phase 6.3 (#16): simulated-offline is now per-ticket, not global.
 *
 * Request body:
 *   { simulateOffline: true,  ticketId?: "<current ticket>" }
 *   { simulateOffline: false, ticketId?: "<current ticket>" }
 *
 * If `ticketId` is provided, the per-ticket flag `agent:simulated_offline:{ticketId}`
 * is toggled — only the loop for that ticket will crash, not every agent
 * invocation across the deployment.
 *
 * If `ticketId` is omitted, the legacy global key `agent:simulated_offline`
 * is toggled for back-compat. agentLoop logs a deprecation warning when the
 * global key is honored.
 */
export async function POST(req: NextRequest) {
  try {
    const { simulateOffline, ticketId } = await req.json();

    if (ticketId && typeof ticketId === "string") {
      const key = `agent:simulated_offline:${ticketId}`;
      if (simulateOffline) {
        await pubClient.set(key, "true");
      } else {
        await pubClient.del(key);
      }
    } else {
      // Legacy global key behavior preserved for older test clients.
      if (simulateOffline) {
        await pubClient.set("agent:simulated_offline", "true");
      } else {
        await pubClient.del("agent:simulated_offline");
      }
    }

    // Health-broadcast retains the public channel semantics so the existing UI
    // sidebar indicator continues to reflect simulation state.
    await pubClient.publish(
      "agent:llm_health",
      JSON.stringify({ status: simulateOffline ? "offline" : "online" }),
    );

    return NextResponse.json({ success: true, simulateOffline, ticketId: ticketId ?? null });
  } catch (error) {
    return NextResponse.json({ error: "Failed to toggle simulation" }, { status: 500 });
  }
}
