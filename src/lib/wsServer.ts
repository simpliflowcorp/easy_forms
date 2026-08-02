import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { parse } from "url";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";
import User from "@/models/userModel";
import { connectDB } from "@/dbConfig/dbConfig";
import { AgentState } from "@/agent/types";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pubClient = new Redis(redisUrl);
const subClient = new Redis(redisUrl);

interface WSClient extends WebSocket {
  userId?: string;
  ticketId?: string;
  authenticated?: boolean;
  isAlive?: boolean;
}

const connections = new Map<string, Set<WSClient>>();

const HEARTBEAT_INTERVAL = 30000;

function addConnection(userId: string, ws: WSClient) {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(ws);
}

function removeConnection(userId: string, ws: WSClient) {
  const userConnections = connections.get(userId);
  if (userConnections) {
    userConnections.delete(ws);
    if (userConnections.size === 0) {
      connections.delete(userId);
    }
  }
}

function sendToUser(userId: string, message: object) {
  const userConnections = connections.get(userId);
  if (userConnections) {
    const data = JSON.stringify(message);
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

function broadcast(channel: string, message: object) {
  const data = JSON.stringify({ channel, ...message });
  for (const [, userConnections] of connections) {
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

/** Send token chunk to a specific user's connections */
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

async function authenticateConnection(ws: WSClient, req: any): Promise<string | null> {
  try {
    await connectDB();
    
    const url = parse(req.url || "", true);
    const token = url.query.token as string;
    
    if (!token) {
      return null;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.TOKEN_SECRET!);
    } catch (err) {
      return null;
    }

    if (decoded?._id) {
      return decoded._id.toString();
    }

    if (decoded?.email) {
      const user = await User.findOne({ email: decoded.email }).lean();
      if (user) return user._id.toString();
    }

    return null;
  } catch (error) {
    console.error("[wsServer] Auth error:", error);
    return null;
  }
}

function setupHeartbeat(ws: WSClient) {
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(interval);
    }
  }, HEARTBEAT_INTERVAL);

  ws.on("close", () => clearInterval(interval));
}

export function createWSServer() {
  const server = createServer();
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", async (ws: WSClient, req) => {
    console.log("[wsServer] New connection attempt");

    const userId = await authenticateConnection(ws, req);
    
    if (!userId) {
      ws.send(JSON.stringify({ type: "error", payload: { message: "Authentication failed" } }));
      ws.close(4001, "Authentication failed");
      return;
    }

    ws.userId = userId;
    ws.authenticated = true;
    addConnection(userId, ws);
    setupHeartbeat(ws);

    console.log(`[wsServer] User ${userId} connected`);

    ws.send(JSON.stringify({ 
      type: "connected", 
      payload: { userId, message: "WebSocket connected successfully" } 
    }));

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (error) {
        console.error("[wsServer] Message parse error:", error);
        ws.send(JSON.stringify({ type: "error", payload: { message: "Invalid message format" } }));
      }
    });

    ws.on("close", (code, reason) => {
      if (ws.userId) {
        removeConnection(ws.userId, ws);
        console.log(`[wsServer] User ${ws.userId} disconnected: ${code} ${reason}`);
      }
    });

    ws.on("error", (error) => {
      console.error("[wsServer] WebSocket error:", error);
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });

  subClient.subscribe("agent:llm_health");
  subClient.on("message", (channel, message) => {
    if (channel === "agent:llm_health") {
      try {
        const data = JSON.parse(message);
        broadcast("agent:llm_health", { type: "health", payload: data });
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

  return { server, wss, sendTokenToUser };
}

async function handleMessage(ws: WSClient, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "prompt": {
      const { prompt, mergeApproved, resumeTicketId, sessionId } = payload;
      if (!prompt && !mergeApproved) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "prompt or mergeApproved required" } }));
        return;
      }

      ws.ticketId = resumeTicketId;
      
      ws.send(JSON.stringify({ 
        type: "busy", 
        payload: { message: "Processing request..." } 
      }));

      const { runAgentLoop } = await import("../agent/agentLoop.js");
      
      try {
        await runAgentLoop(
          ws.userId!,
          prompt || "",
          Boolean(mergeApproved),
          resumeTicketId,
          sessionId,
          (state: AgentState) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "state", payload: state }));
            }
          },
          // R3: Token streaming callback
          (persona: string, chunk: string) => {
            if (ws.readyState === WebSocket.OPEN && ws.userId) {
              sendTokenToUser(ws.userId, persona, chunk);
            }
          }
        );
      } catch (error: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", payload: { message: error.message } }));
        }
      }
      break;
    }

    case "merge": {
      const { ticketId } = payload;
      if (!ticketId) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "ticketId required" } }));
        return;
      }
      
      ws.send(JSON.stringify({ type: "busy", payload: { message: "Merging sandbox..." } }));

      const { runAgentLoop } = await import("../agent/agentLoop.js");
      
      try {
        await runAgentLoop(
          ws.userId!,
          "",
          true,
          ticketId,
          undefined,
          (state: AgentState) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "state", payload: state }));
            }
          },
          // R3: Token streaming callback
          (persona: string, chunk: string) => {
            if (ws.readyState === WebSocket.OPEN && ws.userId) {
              sendTokenToUser(ws.userId, persona, chunk);
            }
          }
        );
      } catch (error: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", payload: { message: error.message } }));
        }
      }
      break;
    }

    case "resume": {
      const { ticketId } = payload;
      if (!ticketId) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "ticketId required" } }));
        return;
      }
      
      ws.ticketId = ticketId;
      
      const { runAgentLoop } = await import("../agent/agentLoop.js");
      
      try {
        await runAgentLoop(
          ws.userId!,
          "",
          false,
          ticketId,
          undefined,
          (state: AgentState) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "state", payload: state }));
            }
          },
          // R3: Token streaming callback
          (persona: string, chunk: string) => {
            if (ws.readyState === WebSocket.OPEN && ws.userId) {
              sendTokenToUser(ws.userId, persona, chunk);
            }
          }
        );
      } catch (error: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", payload: { message: error.message } }));
        }
      }
      break;
    }

    case "ping": {
      ws.send(JSON.stringify({ type: "pong" }));
      break;
    }

    default: {
      ws.send(JSON.stringify({ type: "error", payload: { message: `Unknown message type: ${type}` } }));
    }
  }
}

export function getConnectionsCount(): number {
  let count = 0;
  for (const [, userConnections] of connections) {
    count += userConnections.size;
  }
  return count;
}

export function getUserConnections(userId: string): number {
  return connections.get(userId)?.size || 0;
}