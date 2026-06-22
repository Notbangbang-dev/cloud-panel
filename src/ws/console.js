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

  // Identity captured at connect; used to detect revocation later.
  const userId = user.id;
  const serverId = server.id;
  const connectTv = user.tokenVersion || 0;

  // Re-load the LIVE user + server and confirm the session is still valid:
  // tokenVersion unchanged (no password change / forced logout), the account
  // still exists, and access to this server hasn't been revoked. Returns the
  // fresh records or null. This is what stops a long-lived console socket from
  // outliving a credential change or a pulled subuser grant (CWE-613).
  const liveContext = () => {
    const u = db.get('users', userId);
    if (!u || (u.tokenVersion || 0) !== connectTv) return null;
    const s = db.get('servers', serverId);
    if (!s || !canAccessServer(u, s)) return null;
    return { user: u, server: s };
  };

  // Simple token-bucket so a client can't flood console/power messages.
  let tokens = 30;
  const refill = setInterval(() => { tokens = Math.min(30, tokens + 10); }, 1000);
  if (refill.unref) refill.unref();
  const allow = () => (tokens > 0 ? (tokens--, true) : false);

  const endSession = (message) => {
    send({ event: 'error', message });
    try { ws.close(4001, 'session-revoked'); } catch { /* already closing */ }
  };

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

    // Re-authorize against live records on every action (not the cached ones
    // from connect time) so revocation takes effect immediately.
    const live = liveContext();
    if (!live) { endSession('Session ended — please sign in again.'); return; }
    if (!(live.user.admin || live.user.status === 'active')) {
      send({ event: 'error', message: 'Your account is awaiting approval.' });
      return;
    }
    if (msg.type === 'command' && typeof msg.command === 'string') {
      if (!hasPermission(live.user, live.server, 'control.command')) { send({ event: 'error', message: 'You do not have permission to send commands.' }); return; }
      pm.command(live.server.id, msg.command);
    } else if (msg.type === 'power' && ['start', 'stop', 'restart', 'kill'].includes(msg.action)) {
      if (!hasPermission(live.user, live.server, 'control.power')) { send({ event: 'error', message: 'You do not have permission to control power.' }); return; }
      const result = await pm.power(live.server, msg.action);
      if (!result.ok) send({ event: 'error', message: result.error });
    }
  });

  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25000);

  // Also proactively drop passive viewers when their access is revoked, so a
  // read-only console can't linger after a password change / removal either.
  const revokeCheck = setInterval(() => {
    if (!liveContext()) endSession('Session ended — please sign in again.');
  }, 15000);
  if (revokeCheck.unref) revokeCheck.unref();

  const cleanup = () => {
    clearInterval(keepAlive);
    clearInterval(refill);
    clearInterval(revokeCheck);
    unsubscribe();
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

module.exports = { attach };
