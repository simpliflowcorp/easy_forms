"use client";
import { useEffect } from "react";
import kv from "@/lib/redis";
import toast from "react-hot-toast";

// Add notification display function
const showNotification = (notification: any) => {
  toast(notification.message, {
    icon: "ℹ️",
    duration: 5000,
    position: "top-right",
  });
};

export default function useActivityDetector(userId: string) {
  useEffect(() => {
    const checkPending = async () => {
      const res = await fetch(`/api/notifications/${userId}`);
      const pending = await res.json();
      if (pending.length > 0) {
        pending.forEach(showNotification);
        await fetch(`/api/notifications/${userId}`, { method: "DELETE" });
      }
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkPending();
    });

    checkPending();
  }, [userId]);
}
