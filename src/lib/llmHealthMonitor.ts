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
      // Check for simulated offline mode first
      const isSimulatedOffline = await pubClient.get("agent:simulated_offline");
      if (isSimulatedOffline === "true") {
        if (global._llmHealthLastStatus !== "offline") {
          global._llmHealthLastStatus = "offline";
          await pubClient.publish("agent:llm_health", JSON.stringify({ status: "offline" }));
        }
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const apiKey = process.env.NVIDIA_API_KEY || "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";
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
  return global._llmHealthLastStatus || "online";
};
