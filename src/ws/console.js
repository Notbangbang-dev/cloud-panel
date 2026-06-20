'use strict';

const { WebSocketServer } = require('ws');
const url = require('url');
const db = require('../db');
const auth = require('../auth');
const pm = require('../services/processManager');
const { canAccessServer, hasPermission } = require('../routes/helpers');

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

    // Auth via a short-lived, scoped ticket (browsers can't set headers on WS).
    const user = query.ticket && auth.verifyTicket(query.ticket, 'console');
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const id = decodeURIComponent(match[1]);
    const server =
      db.get('servers', id) ||
      db.find('servers', (s) => s.identifier === id || s.uuid === id);
    // Viewing the console requires the 'control.console' permission (owners and
    // admins always have it; subusers only if it was granted).
    if (!server || !canAccessServer(user, server) || !hasPermission(user, server, 'control.console')) {
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

  // Simple token-bucket so a client can't flood console/power messages.
  let tokens = 30;
  const refill = setInterval(() => { tokens = Math.min(30, tokens + 10); }, 1000);
  if (refill.unref) refill.unref();
  const allow = () => (tokens > 0 ? (tokens--, true) : false);
  const isActive = () => user.admin || user.status === 'active';

  ws.on('message', async (raw) => {
    if (raw && raw.length > 8192) return; // ignore oversized frames
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'ping') { send({ event: 'pong' }); return; }
    if (!allow()) { send({ event: 'error', message: 'Slow down — too many actions.' }); return; }
    if (!isActive()) { send({ event: 'error', message: 'Your account is awaiting approval.' }); return; }
    if (msg.type === 'command' && typeof msg.command === 'string') {
      if (!hasPermission(user, server, 'control.command')) { send({ event: 'error', message: 'You do not have permission to send commands.' }); return; }
      pm.command(server.id, msg.command);
    } else if (msg.type === 'power' && ['start', 'stop', 'restart', 'kill'].includes(msg.action)) {
      if (!hasPermission(user, server, 'control.power')) { send({ event: 'error', message: 'You do not have permission to control power.' }); return; }
      const result = await pm.power(server, msg.action);
      if (!result.ok) send({ event: 'error', message: result.error });
    }
  });

  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);

  ws.on('close', () => {
    clearInterval(keepAlive);
    clearInterval(refill);
    unsubscribe();
  });
  ws.on('error', () => {
    clearInterval(keepAlive);
    clearInterval(refill);
    unsubscribe();
  });
}

module.exports = { attach };
