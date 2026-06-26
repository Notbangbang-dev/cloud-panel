'use strict';

/**
 * Local-vs-remote dispatch shim.
 *
 * The panel calls this instead of processManager/files directly. For servers on
 * the LOCAL node it forwards straight to processManager/files (today's behavior,
 * unchanged). For servers on a REMOTE node it forwards to that node's daemon over
 * the authenticated nodeClient transport.
 *
 * Backward compatibility: on a single-node install, exactly one node is marked
 * local and every server is local — so every method here is a passthrough.
 */

const db = require('../db');
const config = require('../config');
const pm = require('./processManager');
const F = require('./files');
const B = require('./backups');
const nodeClient = require('./nodeClient');

let _localNodeId = null;

/** Boot-time (panel role): mark exactly one node as the panel's own machine. */
function markLocalNode() {
  if (config.role === 'daemon') return null;
  const nodes = db.all('nodes');
  if (!nodes.length) { _localNodeId = null; return null; }
  let local = null;
  if (config.nodeId) local = nodes.find((n) => n.id === config.nodeId);
  if (!local) local = nodes.find((n) => n.fqdn === config.publicHost && Number(n.daemonPort) === Number(config.webPort));
  if (!local && nodes.length === 1) local = nodes[0];
  if (!local) local = nodes.find((n) => !n.daemonToken) || nodes[0];
  _localNodeId = local ? local.id : null;
  for (const n of nodes) {
    const isLocal = n.id === _localNodeId;
    if (!!n.isLocal !== isLocal) db.update('nodes', n.id, { isLocal });
  }
  return _localNodeId;
}

function nodeFor(server) {
  return server && server.nodeId ? db.get('nodes', server.nodeId) : null;
}

/** True when this server runs on the panel's own machine (call pm directly). */
function isLocalServer(server) {
  const node = nodeFor(server);
  if (!node) return true;                 // no node → run locally (backward compat)
  if (node.isLocal) return true;
  if (_localNodeId && node.id === _localNodeId) return true;
  return !node.daemonToken;               // a node never set up as a remote daemon
}

function nodeErr(node, e) {
  const where = node ? `node "${node.name || node.id}"` : 'remote node';
  if (e && e.status) return `${where}: ${e.message}`;
  return `${where} is unreachable (${(e && e.message) || 'no response'}). Is the daemon online?`;
}

/* ---- processManager mirror ---------------------------------------------- */

async function power(server, action) {
  if (isLocalServer(server)) return pm.power(server, action);
  const node = nodeFor(server);
  try {
    return await nodeClient.daemonFetch(node, 'POST', `/api/daemon/servers/${server.id}/power`, { sub: server.id, body: { action } });
  } catch (e) { return { ok: false, error: nodeErr(node, e) }; }
}

async function command(server, cmd) {
  if (isLocalServer(server)) { pm.command(server.id, cmd); return { ok: true }; }
  const node = nodeFor(server);
  try { await nodeClient.daemonFetch(node, 'POST', `/api/daemon/servers/${server.id}/command`, { sub: server.id, body: { command: cmd } }); return { ok: true }; }
  catch (e) { return { ok: false, error: nodeErr(node, e) }; }
}

async function provision(server, opts = {}) {
  if (isLocalServer(server)) return pm.provision(server, opts);
  const node = nodeFor(server);
  try { return await nodeClient.daemonFetch(node, 'POST', `/api/daemon/servers/${server.id}/install`, { sub: server.id, body: { trigger: opts.trigger || 'install' } }); }
  catch (e) { return { ok: false, error: nodeErr(node, e) }; }
}

async function recentLogs(server) {
  if (isLocalServer(server)) return pm.recentLogs(server.id);
  const node = nodeFor(server);
  try { const r = await nodeClient.daemonFetch(node, 'GET', `/api/daemon/servers/${server.id}/logs`, { sub: server.id }); return (r && r.data) || []; }
  catch { return []; }
}

// ---- Non-blocking state (mirrors pm.state, sync). Remote state is cached ~2s
// and refreshed in the background so serializeServer's per-row call never fans
// out a network request (same pattern as the files.js disk cache).
const EMPTY_STATS = { cpu: 0, memory: 0, memoryLimit: 0, disk: 0, diskLimit: 0, uptime: 0 };
const _stateCache = new Map();   // serverId -> { at, state }
const _stateRefreshing = new Set();

function refreshRemoteState(server) {
  const id = server.id;
  if (_stateRefreshing.has(id)) return;
  const node = nodeFor(server);
  if (!node) return;
  _stateRefreshing.add(id);
  nodeClient.daemonFetch(node, 'GET', `/api/daemon/servers/${id}/state`, { sub: id, timeoutMs: 6000 })
    .then((s) => { if (s) _stateCache.set(id, { at: Date.now(), state: s }); })
    .catch(() => {})
    .finally(() => _stateRefreshing.delete(id));
}

function state(server) {
  if (isLocalServer(server)) return pm.state(server.id);
  const c = _stateCache.get(server.id);
  if (c && Date.now() - c.at < 2000) return c.state;
  refreshRemoteState(server);
  if (c) return c.state;
  return { status: 'unknown', stats: { ...EMPTY_STATS }, startedAt: 0 };
}

function isInstalling(server) {
  if (isLocalServer(server)) return pm.isInstalling(server.id);
  return state(server).status === 'installing';
}

/* ---- Config push / removal ---------------------------------------------- */

async function pushServer(server) {
  if (isLocalServer(server)) return { ok: true, local: true };
  const node = nodeFor(server);
  const egg = db.get('eggs', server.eggId) || null;
  const allocIds = [server.allocationId, ...(server.additionalAllocationIds || [])].filter(Boolean);
  const allocations = allocIds.map((id) => db.get('allocations', id)).filter(Boolean);
  return nodeClient.daemonFetch(node, 'POST', `/api/daemon/servers/${server.id}`, { sub: server.id, body: { server, egg, allocations } });
}

async function removeServer(server) {
  if (isLocalServer(server)) return { ok: true, local: true };
  const node = nodeFor(server);
  try { await nodeClient.daemonFetch(node, 'DELETE', `/api/daemon/servers/${server.id}`, { sub: server.id }); return { ok: true }; }
  catch (e) { return { ok: false, error: nodeErr(node, e) }; }
}

/* ---- Files facade (same signatures as services/files) ------------------- */

async function remoteFile(server, method, op, payload) {
  const node = nodeFor(server);
  const r = await nodeClient.daemonFetch(node, method, `/api/daemon/servers/${server.id}/files/${op}`, { sub: server.id, body: payload });
  return r ? r.data : undefined;
}

const files = {
  rootFor: F.rootFor, // local-only helper; remote callers don't use it
  resolve: F.resolve,
  toRel: F.toRel,
  diskUsage: F.diskUsage,
  async list(server, rel) { return isLocalServer(server) ? F.list(server, rel) : remoteFile(server, 'POST', 'list', { path: rel }); },
  async read(server, rel) { return isLocalServer(server) ? F.read(server, rel) : remoteFile(server, 'POST', 'read', { path: rel }); },
  async write(server, rel, content) { return isLocalServer(server) ? F.write(server, rel, content) : remoteFile(server, 'POST', 'write', { path: rel, content }); },
  async mkdir(server, rel) { return isLocalServer(server) ? F.mkdir(server, rel) : remoteFile(server, 'POST', 'mkdir', { path: rel }); },
  async rename(server, from, to) { return isLocalServer(server) ? F.rename(server, from, to) : remoteFile(server, 'POST', 'rename', { from, to }); },
  async remove(server, rel) { return isLocalServer(server) ? F.remove(server, rel) : remoteFile(server, 'POST', 'delete', { path: rel }); },
  // Bulk delete works for both local and remote: locally it's the service's own
  // batch op; remotely we loop single deletes through the daemon so no new daemon
  // endpoint is required. Either way one bad path never aborts the rest.
  async removeMany(server, rels) {
    if (isLocalServer(server)) return F.removeMany(server, rels);
    const list = Array.isArray(rels) ? rels.filter((r) => typeof r === 'string' && r) : [];
    let removed = 0;
    const failed = [];
    for (const rel of list) {
      try { await remoteFile(server, 'POST', 'delete', { path: rel }); removed++; }
      catch (err) { failed.push({ path: rel, error: err.message }); }
    }
    return { removed, failed };
  },
  async unzip(server, rel) { return isLocalServer(server) ? F.unzip(server, rel) : remoteFile(server, 'POST', 'unzip', { path: rel }); },
  async saveStream(server, rel, readable, opts) {
    if (isLocalServer(server)) return F.saveStream(server, rel, readable, opts);
    const node = nodeFor(server);
    const r = await nodeClient.daemonUpload(node, server.id, `/api/daemon/servers/${server.id}/files/upload?path=${encodeURIComponent(rel)}`, readable);
    return r ? r.data : undefined;
  },
};

/* ---- Backups facade (local → services/backups, remote → daemon) --------- */

async function remoteBackup(server, method, suffix, body) {
  return nodeClient.daemonFetch(nodeFor(server), method, `/api/daemon/servers/${server.id}/backups${suffix}`, { sub: server.id, body });
}
const backups = {
  backupFile: B.backupFile,
  async list(server) { if (isLocalServer(server)) return B.list(server.id); const r = await remoteBackup(server, 'GET', ''); return (r && r.data) || []; },
  async get(server, bid) { if (isLocalServer(server)) return B.get(server.id, bid); const r = await remoteBackup(server, 'GET', `/${bid}`); return r && r.data; },
  async create(server, opts) { if (isLocalServer(server)) return B.create(server, opts); const r = await remoteBackup(server, 'POST', '', { name: opts && opts.name, createdBy: opts && opts.createdBy }); return r && r.data; },
  async restore(server, bid) { if (isLocalServer(server)) return B.restore(server, bid); return remoteBackup(server, 'POST', `/${bid}/restore`); },
  async remove(server, bid) { if (isLocalServer(server)) return B.remove(server.id, bid); const r = await remoteBackup(server, 'DELETE', `/${bid}`); return !!(r && r.ok); },
};

module.exports = {
  markLocalNode,
  nodeFor,
  isLocalServer,
  backups,
  power,
  command,
  provision,
  recentLogs,
  state,
  isInstalling,
  pushServer,
  removeServer,
  files,
  // exposed for tests
  _setLocalNodeId(id) { _localNodeId = id; },
};
