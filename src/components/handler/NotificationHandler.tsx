"use client";
import { useEffect } from "react";
import toast from "react-hot-toast";

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
      console.log("SSE Event:", e.data);
      if (e.data === ":heartbeat") return;

      try {
        const data = JSON.parse(e.data);
        toast.success(data.message, { duration: 3000 });
      } catch (error) {
        console.error("Invalid message format:", e.data);
      }
    });

    // Handle stream open
    es.addEventListener("open", () => {
      console.log("SSE Connection opened");
    });

    // Handle errors
    es.addEventListener("error", (e) => {
      console.error("SSE Error:", e);
      es.close();
      setTimeout(() => window.location.reload(), 5000);
    });

    return () => {
      console.log("Cleaning up SSE connection");
      es.close();
    };
  }, [userId]);

  return null;
}
