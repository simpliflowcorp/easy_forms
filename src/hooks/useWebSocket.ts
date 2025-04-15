import { useEffect, useRef } from "react";

export default function useWebSocket(userId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Connect to your custom WebSocket endpoint
    const ws = new WebSocket(`ws://localhost:3000/ws`);

    wsRef.current = ws;

    ws.onopen = () => {
      // Send authentication message
      ws.send(JSON.stringify({ type: "auth", userId }));
    };

    ws.onmessage = (event) => {};

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [userId]); // Only reconnect when userId changes

  return wsRef.current;
}
