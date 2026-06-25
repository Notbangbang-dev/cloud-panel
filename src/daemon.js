'use strict';

/**
 * Cloud Panel daemon (node agent).
 *
 * Runs on each node VPS (CP_ROLE=daemon). A stripped HTTP+WS server that lets the
 * panel run servers on THIS machine via Docker, reusing the panel's own runtime
 * modules (processManager / oci / files). No users, UI, billing or sessions — the
 * only auth is the per-node shared secret (CP_DAEMON_TOKEN).
 *
 *   CP_ROLE=daemon CP_DAEMON_TOKEN=<secret> CP_PANEL_URL=<url> CP_NODE_ID=<id> \
 *   CP_WEB_PORT=8080 CP_DATA_DIR=/var/lib/cloud-panel-daemon node src/daemon.js
 */

const http = require('http');
const express = require('express');
const config = require('./config');
const db = require('./db');
const isolation = require('./services/isolation');
const oci = require('./services/oci');
const pm = require('./services/processManager');
const daemonRoutes = require('./routes/daemon');
const nodeToken = require('./services/nodeToken');

let VERSION = '0.0.0';
try { VERSION = require('../package.json').version; } catch {}

if (config.role !== 'daemon') {
  console.error('[daemon] refusing to start: set CP_ROLE=daemon. (Did you mean `node src/server.js`?)');
  process.exit(1);
}
if (!config.daemonToken) {
  console.error('[daemon] CP_DAEMON_TOKEN is required — get it from the panel when you add the node.');
  process.exit(1);
}

db.load();
isolation.init();
oci.init(); // with CP_OCI forced on for the daemon role, refuses to run servers if Docker is missing
try {
  const wasRunning = pm.reconcile();
  const resume = wasRunning.filter((s) => s.autoStart !== false && !s.suspended);
  if (resume.length) console.log(`[daemon] resuming ${resume.length} server(s) running before restart`);
  for (const s of resume) {
    const r = pm.start(s);
    if (r && r.ok === false) console.warn(`[daemon] could not resume '${s.id}': ${r.error}`);
  }
} catch (e) { console.warn('[daemon] reconcile/resume failed:', e.message); }

const app = express();
app.disable('x-powered-by');
app.get('/', (req, res) => res.json({ ok: true, role: 'daemon', version: VERSION }));
app.use('/api/daemon', daemonRoutes.router);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const httpServer = http.createServer(app);
daemonRoutes.attachWs(httpServer);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`[daemon] port ${config.webPort} is in use.`);
  else console.error('[daemon] server error:', err.message);
  process.exit(1);
});

httpServer.listen(config.webPort, config.host, () => {
  console.log(`[daemon] Cloud Panel daemon v${VERSION} listening on ${config.host}:${config.webPort} (node ${config.nodeId || '?'})`);
  const s = oci.status();
  console.log(`[daemon] sandbox: ${s.active ? `OCI ${s.runtime} active` : (s.enabled ? `OCI required but ${s.runtime} UNAVAILABLE` : 'host-process mode')}`);
  startHeartbeat();
});

// ---- Heartbeat: tell the panel we're online every ~15s --------------------
function startHeartbeat() {
  if (!config.panelUrl || !config.nodeId) {
    console.warn('[daemon] CP_PANEL_URL / CP_NODE_ID not set — online status won\'t show in the panel.');
    return;
  }
  const beat = async () => {
    try {
      const token = nodeToken.signDaemonToken(config.nodeId, config.daemonToken);
      const running = [...db.all('servers')].filter((x) => pm.state(x.id).status === 'running').length;
      await fetch(`${config.panelUrl}/api/remote/nodes/${encodeURIComponent(config.nodeId)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ version: VERSION, sandbox: oci.status(), running }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { /* panel may be temporarily down — keep beating */ }
  };
  beat();
  const t = setInterval(beat, 15000);
  if (t.unref) t.unref();
}

// ---- Graceful shutdown ----------------------------------------------------
let stopping = false;
function shutdown() {
  if (stopping) return; stopping = true;
  console.log('[daemon] shutting down…');
  try { pm.shutdownAll(); } catch {}
  try { db.persistNow(); } catch {}
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
