#!/usr/bin/env node

/**
 * Standalone WebSocket Server for Easy Forms Agent
 * Run with: node src/lib/wsServerEntry.js
 * Or add to package.json scripts
 */

import { createWSServer } from "./wsServer.js";

const PORT = process.env.WS_PORT || 3001;

const { server } = createWSServer();

server.listen(PORT, () => {
  console.log(`[wsServer] WebSocket server running on port ${PORT}`);
  console.log(`[wsServer] Connect to ws://localhost:${PORT}/api/ws`);
});

process.on("SIGINT", () => {
  console.log("[wsServer] Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[wsServer] Shutting down...");
  process.exit(0);
});