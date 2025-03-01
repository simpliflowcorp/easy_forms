import WebSocket from "ws";
import Notification from "@/models/notificationModel";

class WebSocketServer {
  private wss: WebSocket.Server;

  constructor(server: any) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on("connection", async (ws, request) => {
      const userId = new URL(request.url!, "http://localhost").searchParams.get(
        "userId"
      );

      if (!userId) {
        ws.close();
        return;
      }

      // Send pending notifications on connect
      const pending = await Notification.find({
        user: userId,
        deliveryStatus: "pending",
      });

      pending.forEach((notification) => {
        ws.send(JSON.stringify(notification));
        notification.deliveryStatus = "delivered";
        notification.save();
      });

      // Watch for new notifications
      const changeStream = Notification.watch([
        {
          $match: {
            "fullDocument.user": userId,
            operationType: "insert",
          },
        },
      ]);

      changeStream.on("change", (change) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(change.fullDocument));
        }
      });

      ws.on("close", () => {
        changeStream.close();
      });
    });
  }
}

export default WebSocketServer;
