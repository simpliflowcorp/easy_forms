import { useEffect, useCallback } from "react";

export default function useWebSocket(userId) {
  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(`wss://your-domain.com/ws`, [userId, authToken]);

    ws.onmessage = (event) => {
      const notification = JSON.parse(event.data);
      // Display notification using your UI
      console.log("New notification:", notification);
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 5000); // Reconnect after 5s
    };

    return ws;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const ws = connectWebSocket();
    return () => ws.close();
  }, [userId, connectWebSocket]);
}
