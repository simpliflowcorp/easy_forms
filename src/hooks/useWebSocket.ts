import { useEffect, useRef } from "react";

export default function useWebSocket(userId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Connect to your custom WebSocket endpoint
    const ws = new WebSocket(`ws://localhost:3000/ws`);

    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
      // Send authentication message
      ws.send(JSON.stringify({ type: "auth", userId }));
    };

    ws.onmessage = (event) => {
      console.log("WebSocket message:", event.data);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [userId]); // Only reconnect when userId changes

  return wsRef.current;
}
