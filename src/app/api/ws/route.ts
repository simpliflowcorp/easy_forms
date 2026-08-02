// Next.js WebSocket route handler for App Router
// This provides a WebSocket endpoint at /api/ws that upgrades HTTP to WS

import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import User from "@/models/userModel";
import { connectDB } from "@/dbConfig/dbConfig";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const subClient = new Redis(redisUrl);

// Track connections per user
const connections = new Map<string, Set<WebSocket>>();

function addConnection(userId: string, ws: WebSocket) {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(ws);
}

function removeConnection(userId: string, ws: WebSocket) {
  const userConnections = connections.get(userId);
  if (userConnections) {
    userConnections.delete(ws);
    if (userConnections.size === 0) {
      connections.delete(userId);
    }
  }
}

function sendTokenToUser(userId: string, persona: string, token: string) {
  const userConnections = connections.get(userId);
  if (userConnections) {
    const data = JSON.stringify({ 
      type: "token", 
      payload: { persona, token } 
    });
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

// Subscribe to health updates
subClient.subscribe("agent:llm_health");
subClient.on("message", (channel, message) => {
  if (channel === "agent:llm_health") {
    try {
      const data = JSON.parse(message);
      for (const [, userConnections] of connections) {
        for (const ws of userConnections) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "health", payload: data }));
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
});

export async function GET(req: NextRequest) {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = req.headers.get("upgrade");
  if (upgradeHeader !== "websocket") {
    return NextResponse.json({ error: "Expected WebSocket upgrade" }, { status: 400 });
  }

  // We can't actually handle WebSocket upgrade in a standard Next.js API route
  // This endpoint documents the expected interface
  // The actual WebSocket server runs on a separate port via wsServer.ts
  // Client should connect to ws://host:3001/api/ws or wss://host/api/ws (if using custom server)
  
  return NextResponse.json({ 
    message: "WebSocket endpoint. Connect to ws://localhost:3001/api/ws with token query param.",
    note: "Run 'npm run ws:server' to start the WebSocket server on port 3001"
  }, { status: 200 });
}

// Note: For production, use a custom Next.js server that integrates both HTTP and WS
// See wsServer.ts for the standalone WebSocket server implementation