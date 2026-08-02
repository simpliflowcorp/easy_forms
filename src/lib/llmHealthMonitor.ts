import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = new Redis(redisUrl);

// Use global object to prevent multiple intervals during Next.js HMR
declare global {
  var _llmHealthMonitorInterval: NodeJS.Timeout | null;
  var _llmHealthLastStatus: string | null;
}

if (!global._llmHealthMonitorInterval) {
  global._llmHealthMonitorInterval = null;
  global._llmHealthLastStatus = null;
}

export const startLlmHealthMonitor = () => {
  if (global._llmHealthMonitorInterval) return; // Already running

  console.log("🚀 Starting centralized LLM Health Monitor...");

  const checkHealth = async () => {
    try {
      // NOTE: per-ticket simulated offline (agent:simulated_offline:{ticketId})
      // is honoured only inside agentLoop.ts — it intentionally does NOT
      // affect the global health broadcast, which reflects the real NVIDIA
      // probe. The legacy bare global key `agent:simulated_offline` was
      // removed (P0-3 cleanup): nothing sets it and a stale value would
      // have silently crashed every client's status.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const apiKey = process.env.NVIDIA_API_KEY;
      if (!apiKey) {
        if (global._llmHealthLastStatus !== "unknown") {
          global._llmHealthLastStatus = "unknown";
          await pubClient.publish("agent:llm_health", JSON.stringify({ status: "unknown", reason: "NVIDIA_API_KEY not configured" }));
        }
        return;
      }
      const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const newStatus = res.ok ? "online" : "offline";
      
      // Only broadcast if the status has changed or is uninitialized
      if (global._llmHealthLastStatus !== newStatus) {
        global._llmHealthLastStatus = newStatus;
        await pubClient.publish("agent:llm_health", JSON.stringify({ status: newStatus }));
      }
    } catch (error) {
      if (global._llmHealthLastStatus !== "offline") {
        global._llmHealthLastStatus = "offline";
        await pubClient.publish("agent:llm_health", JSON.stringify({ status: "offline" }));
      }
    }
  };

  // Run immediately once, then interval
  checkHealth();
  global._llmHealthMonitorInterval = setInterval(checkHealth, 10000);
};

export const getCachedHealthStatus = () => {
  return global._llmHealthLastStatus || "unknown";
};
