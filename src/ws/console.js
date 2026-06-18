'use strict';

const { WebSocketServer } = require('ws');
const url = require('url');
const db = require('../db');
const auth = require('../auth');
const pm = require('../services/processManager');
const { canAccessServer } = require('../routes/helpers');

const WS_PATH = /^\/api\/servers\/([^/]+)\/ws$/;

function attach(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);
    const match = WS_PATH.exec(pathname || '');
    if (!match) {
      socket.destroy();
      return;
    }

    const payload = query.token && auth.verifyToken(query.token);
    const user = payload && db.get('users', payload.sub);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const id = decodeURIComponent(match[1]);
    const server =
      db.get('servers', id) ||
      db.find('servers', (s) => s.identifier === id || s.uuid === id);
    if (!server || !canAccessServer(user, server)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, user, server);
    });
  });

  return wss;
}

function handleConnection(ws, user, server) {
  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  // Initial state + log replay.
  const state = pm.state(server.id);
  send({ event: 'status', status: state.status });
  send({ event: 'stats', stats: state.stats });
  for (const entry of pm.recentLogs(server.id)) {
    send({ event: 'console', ...entry });
  }
  send({ event: 'console', stream: 'sys', line: '\u001b[90m── connected to Cloud Panel console ──\u001b[0m' });

  const unsubscribe = pm.subscribe(server.id, send);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'command' && typeof msg.command === 'string') {
      pm.command(server.id, msg.command);
    } else if (msg.type === 'power' && ['start', 'stop', 'restart', 'kill'].includes(msg.action)) {
      const result = await pm.power(server, msg.action);
      if (!result.ok) send({ event: 'error', message: result.error });
    } else if (msg.type === 'ping') {
      send({ event: 'pong' });
    }
  });

  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);

  ws.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
  ws.on('error', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}

module.exports = { attach };
