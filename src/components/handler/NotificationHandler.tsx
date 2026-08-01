"use client";
import { useEffect } from "react";
import toast from "react-hot-toast";

import { useAgentStore } from "@/store/store";

export default function NotificationHandler({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return;

    const url = new URL("/api/sse", window.location.origin);
    url.searchParams.set("userId", userId);

    const es = new EventSource(url.toString(), {
      withCredentials: true,
    });

    // Explicitly listen for message events
    es.addEventListener("message", (e) => {
      if (e.data === ":heartbeat") return;

      try {
        const data = JSON.parse(e.data);
        if (!useAgentStore.getState().isSidebarOpen) {
          toast.success(data.message, { duration: 3000 });
        }
      } catch (error) {
        console.error("Invalid message format:", e.data);
      }
    });

    // Handle stream open
    es.addEventListener("open", () => {});

    // Handle errors
    es.addEventListener("error", (e) => {
      console.error("SSE Error - The browser will automatically attempt to reconnect.", e);
    });

    return () => {
      es.close();
    };
  }, [userId]);

  return null;
}
