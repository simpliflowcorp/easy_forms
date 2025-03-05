"use client";
import { useEffect } from "react";
import toast from "react-hot-toast";

export default function NotificationHandler({ userId }: { userId: string }) {
  useEffect(() => {
    const eventSource = new EventSource(`/api/sse?userId=${userId}`);

    eventSource.onmessage = (e) => {
      if (e.data === "♥") return;

      try {
        const notification = JSON.parse(e.data);
        toast(notification.message, {
          icon: "ℹ️",
          duration: 5000,
          position: "top-right",
        });
      } catch (error) {
        console.error("Invalid notification format:", e.data);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setTimeout(() => new EventSource(`/api/sse?userId=${userId}`), 3000);
    };

    return () => eventSource.close();
  }, [userId]);

  return null;
}
