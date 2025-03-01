const { createServer } = require('http');
const next = require('next');
const WebSocket = require('ws');
const { parse } = require('url');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// WebSocket Server
const activeClients = new Map(); // userId -> WebSocket[]

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url);
    
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const token = request.headers['sec-websocket-protocol'];
    const userId = verifyToken(token); // Implement your auth logic
    
    if (!userId) {
      ws.close();
      return;
    }

    // Store connection
    if (!activeClients.has(userId)) {
      activeClients.set(userId, new Set());
    }
    activeClients.get(userId).add(ws);

    // Cleanup on close
    ws.on('close', () => {
      activeClients.get(userId)?.delete(ws);
      if (activeClients.get(userId)?.size === 0) {
        activeClients.delete(userId);
      }
    });
  });

  server.listen(3000, () => {
    console.log('> Ready on http://localhost:3000');
  });
});