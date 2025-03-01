import { NextApiRequest, NextApiResponse } from "next";
import { WebSocketServer } from "ws";

let wss: WebSocketServer | null = null;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (res.socket && !(res.socket as any)?.server?.wss) {
    console.log("Initializing WebSocket server...");

    wss = new WebSocketServer({ noServer: true });

    (res.socket as any).server.on(
      "upgrade",
      (request: any, socket: any, head: any) => {
        wss?.handleUpgrade(request, socket, head, (ws) => {
          wss?.emit("connection", ws, request);
        });
      }
    );

    wss.on("connection", (ws) => {
      console.log("Client connected");

      ws.send(JSON.stringify({ message: "Hello from WebSocket server!" }));

      ws.on("message", (message) => {
        console.log("Received:", message.toString());
      });

      ws.on("close", () => {
        console.log("Client disconnected");
      });
    });

    res.socket.server.wss = wss;
  }

  res.end();
}
