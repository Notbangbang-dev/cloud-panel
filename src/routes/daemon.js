'use strict';

/**
 * Daemon API (node side). Mounted only when CP_ROLE=daemon. The panel drives a
 * node entirely through these endpoints; auth is the per-node shared secret
 * (CP_DAEMON_TOKEN) verifying short-lived panel JWTs. Everything reuses the
 * panel's own runtime modules — processManager / files / oci — unchanged.
 */

const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const WebSocket = require('ws');
const db = require('../db');
const config = require('../config');
const pm = require('../services/processManager');
const files = require('../services/files');
const backups = require('../services/backups');
const oci = require('../services/oci');
const nodeToken = require('../services/nodeToken');

let VERSION = '0.0.0';
try { VERSION = require('../../package.json').version; } catch {}

const router = express.Router();

/** Verify the panel's bearer token against this daemon's secret. */
function daemonAuth(req, res, next) {
  const payload = nodeToken.verifyPanelToken(nodeToken.bearer(req), config.daemonToken);
  if (!payload) return res.status(401).json({ error: 'Unauthorized (bad or missing node token)' });
  req.panel = payload;
  next();
}

/** Load a server pushed by the panel; 404 if this daemon doesn't know it. */
function loadServer(req, res, next) {
  const server = db.get('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Unknown server on this node' });
  // A scoped token (sub != '*') may only touch its own server.
  if (req.panel.sub !== '*' && req.panel.sub !== server.id) return res.status(403).json({ error: 'Token not scoped to this server' });
  req.server = server;
  next();
}

router.use(express.json({ limit: '4mb' }));
router.use(daemonAuth);

// ---- Health ---------------------------------------------------------------
router.get('/health', (req, res) => {
  const running = [...db.all('servers')].filter((s) => pm.state(s.id).status === 'running').map((s) => s.id);
  res.json({ ok: true, role: 'daemon', version: VERSION, sandbox: oci.status(), servers: running });
});

// ---- Server config push / removal ----------------------------------------
router.post('/servers/:id', (req, res) => {
  const { server, egg, allocations } = req.body || {};
  if (!server || server.id !== req.params.id) return res.status(400).json({ error: 'server.id mismatch' });
  db.insert('servers', server);
  if (egg) db.insert('eggs', egg);
  for (const a of allocations || []) db.insert('allocations', a);
  res.json({ ok: true });
});

router.delete('/servers/:id', loadServer, async (req, res) => {
  try { await pm.power(req.server, 'kill'); } catch {}
  db.remove('servers', req.server.id);
  try { await fsp.rm(path.join(config.volumesDir, req.server.id), { recursive: true, force: true }); } catch {}
  res.json({ ok: true });
});

// ---- Power / command / install -------------------------------------------
router.post('/servers/:id/power', loadServer, async (req, res) => {
  const result = await pm.power(req.server, (req.body && req.body.action) || '');
  if (result && result.ok === false) return res.status(409).json(result);
  res.json(result || { ok: true });
});

router.post('/servers/:id/command', loadServer, (req, res) => {
  pm.command(req.server.id, (req.body && req.body.command) || '');
  res.json({ ok: true });
});

router.post('/servers/:id/install', loadServer, (req, res) => {
  // Fire-and-forget: progress streams over the console WS.
  pm.provision(req.server, { trigger: (req.body && req.body.trigger) || 'install' }).catch(() => {});
  res.json({ ok: true, started: true });
});

router.get('/servers/:id/state', loadServer, (req, res) => res.json(pm.state(req.server.id)));
router.get('/servers/:id/logs', loadServer, (req, res) => res.json({ data: pm.recentLogs(req.server.id) }));

// ---- Files (reuse services/files verbatim) -------------------------------
const wrap = (fn) => async (req, res) => {
  try { res.json({ data: await fn(req) }); }
  catch (e) { res.status(e.code === 'EACCES' ? 403 : e.code === 'EDQUOT' ? 413 : 400).json({ error: e.message }); }
};
router.post('/servers/:id/files/list', loadServer, wrap((req) => files.list(req.server, req.body.path || '/')));
router.post('/servers/:id/files/read', loadServer, wrap((req) => files.read(req.server, req.body.path)));
router.post('/servers/:id/files/write', loadServer, wrap((req) => files.write(req.server, req.body.path, req.body.content || '')));
router.post('/servers/:id/files/mkdir', loadServer, wrap((req) => files.mkdir(req.server, req.body.path)));
router.post('/servers/:id/files/rename', loadServer, wrap((req) => files.rename(req.server, req.body.from, req.body.to)));
router.post('/servers/:id/files/delete', loadServer, wrap((req) => files.remove(req.server, req.body.path)));
router.post('/servers/:id/files/unzip', loadServer, wrap((req) => files.unzip(req.server, req.body.path)));

// Upload streams the raw request body (no express.json on this route).
router.post('/servers/:id/files/upload', (req, res, next) => loadServer(req, res, next), async (req, res) => {
  try {
    const rel = String((req.query && req.query.path) || '/');
    const saved = await files.saveStream(req.server, rel, req);
    res.json({ data: saved });
  } catch (e) { res.status(e.code === 'EDQUOT' ? 413 : 400).json({ error: e.message }); }
});

// ---- Backups (reuse services/backups verbatim) ---------------------------
router.get('/servers/:id/backups', loadServer, (req, res) => res.json({ data: backups.list(req.server.id) }));
router.get('/servers/:id/backups/:bid', loadServer, (req, res) => {
  const b = backups.get(req.server.id, req.params.bid);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  res.json({ data: b });
});
router.post('/servers/:id/backups', loadServer, async (req, res) => {
  try { res.status(201).json({ data: await backups.create(req.server, { name: req.body && req.body.name, createdBy: (req.body && req.body.createdBy) || null }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/servers/:id/backups/:bid/restore', loadServer, async (req, res) => {
  try { res.json({ ok: true, ...(await backups.restore(req.server, req.params.bid)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/servers/:id/backups/:bid', loadServer, async (req, res) => {
  res.json({ ok: await backups.remove(req.server.id, req.params.bid) });
});
router.get('/servers/:id/backups/:bid/download', loadServer, (req, res) => {
  const b = backups.get(req.server.id, req.params.bid);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  res.download(backups.backupFile(req.server.id, b.id), `${b.name}.zip`);
});

/* ---- Console WebSocket proxy --------------------------------------------- */
const WS_PATH = /^\/api\/daemon\/servers\/([^/]+)\/ws$/;

function attachWs(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname, query;
    try { const u = new URL(req.url, 'http://x'); pathname = u.pathname; query = u.searchParams; }
    catch { socket.destroy(); return; }
    const m = WS_PATH.exec(pathname);
    if (!m) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    const serverId = decodeURIComponent(m[1]);
    const payload = nodeToken.verifyPanelToken(query.get('token'), config.daemonToken);
    if (!payload || (payload.sub !== '*' && payload.sub !== serverId)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    const server = db.get('servers', serverId);
    if (!server) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => handleWs(ws, server));
  });
}

function handleWs(ws, server) {
  const send = (o) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };
  const st = pm.state(server.id);
  send({ event: 'status', status: st.status });
  send({ event: 'stats', stats: st.stats });
  for (const entry of pm.recentLogs(server.id)) send({ event: 'console', ...entry });
  const unsub = pm.subscribe(server.id, send);
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'command') pm.command(server.id, msg.command);
    else if (msg.type === 'power' && ['start', 'stop', 'restart', 'kill'].includes(msg.action)) {
      const r = await pm.power(db.get('servers', server.id) || server, msg.action);
      if (r && r.ok === false) send({ event: 'error', message: r.error });
    } else if (msg.type === 'ping') send({ event: 'pong' });
  });
  const ka = setInterval(() => { try { ws.ping(); } catch {} }, 25000);
  if (ka.unref) ka.unref();
  ws.on('close', () => { unsub(); clearInterval(ka); });
}

module.exports = { router, attachWs };
