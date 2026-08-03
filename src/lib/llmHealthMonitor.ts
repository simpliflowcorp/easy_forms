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

const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
const GOOGLE_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** Resolve probe URL + auth for the configured LLM_PROVIDER (L2.3). */
function resolveHealthProbe():
  | { status: "unknown"; reason: string }
  | { url: string; apiKey: string; provider: string } {
  const provider = (process.env.LLM_PROVIDER || "").toLowerCase().trim();

  if (provider === "nvidia") {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return { status: "unknown", reason: "NVIDIA_API_KEY not configured" };
    }
    return { url: NVIDIA_MODELS_URL, apiKey, provider };
  }

  if (provider === "google") {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return {
        status: "unknown",
        reason: "GEMINI_API_KEY not configured for google provider",
      };
    }
    return { url: GOOGLE_MODELS_URL, apiKey, provider };
  }

  // undefined / other — do not probe a wrong URL
  return {
    status: "unknown",
    reason: provider
      ? `Unsupported LLM_PROVIDER="${provider}"`
      : "LLM_PROVIDER not set",
  };
}

export const startLlmHealthMonitor = () => {
  if (global._llmHealthMonitorInterval) return; // Already running

  console.log("🚀 Starting centralized LLM Health Monitor...");

  const checkHealth = async () => {
    try {
      // NOTE: per-ticket simulated offline (agent:simulated_offline:{ticketId})
      // is honoured only inside agentLoop.ts — it intentionally does NOT
      // affect the global health broadcast, which reflects the real provider
      // probe. The legacy bare global key `agent:simulated_offline` was
      // removed (P0-3 cleanup): nothing sets it and a stale value would
      // have silently crashed every client's status.
      const probe = resolveHealthProbe();

      if ("status" in probe) {
        if (global._llmHealthLastStatus !== "unknown") {
          global._llmHealthLastStatus = "unknown";
          await pubClient.publish(
            "agent:llm_health",
            JSON.stringify({ status: "unknown", reason: probe.reason }),
          );
        }
        return;
      }

      const { url, apiKey, provider: probeProvider } = probe;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const newStatus = res.ok ? "online" : "offline";

      // Only broadcast if the status has changed or is uninitialized
      if (global._llmHealthLastStatus !== newStatus) {
        global._llmHealthLastStatus = newStatus;
        await pubClient.publish(
          "agent:llm_health",
          JSON.stringify({ status: newStatus, provider: probeProvider }),
        );
      }
    } catch {
      if (global._llmHealthLastStatus !== "offline") {
        global._llmHealthLastStatus = "offline";
        await pubClient.publish(
          "agent:llm_health",
          JSON.stringify({ status: "offline" }),
        );
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

/** Test/export helper: resolve probe without side effects (L2.3 verify). */
export const __testResolveHealthProbe = resolveHealthProbe;
