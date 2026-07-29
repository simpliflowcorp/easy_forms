import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = new Redis(redisUrl);

export async function POST(req: NextRequest) {
  try {
    const { simulateOffline } = await req.json();
    
    // Set or delete the simulation flag in Redis
    if (simulateOffline) {
      await pubClient.set("agent:simulated_offline", "true");
      // Force broadcast offline instantly
      await pubClient.publish("agent:llm_health", JSON.stringify({ status: "offline" }));
    } else {
      await pubClient.del("agent:simulated_offline");
      // Force broadcast online instantly
      await pubClient.publish("agent:llm_health", JSON.stringify({ status: "online" }));
    }

    return NextResponse.json({ success: true, simulateOffline });
  } catch (error) {
    return NextResponse.json({ error: "Failed to toggle simulation" }, { status: 500 });
  }
}
