'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const pm = require('../services/processManager');
const files = require('../services/files');
const settings = require('../services/settings');
const serversSvc = require('../services/servers');
const backups = require('../services/backups');
const automations = require('../services/automations');
const subusers = require('../services/subusers');
const schedules = require('../services/schedules');
const databases = require('../services/databases');
const modrinth = require('../services/modrinth');
const players = require('../services/players');
const metrics = require('../services/metrics');
const totp = require('../services/totp');
const statuspage = require('../services/statuspage');
const { canAccessServer, serializeServer, serializeAllocation, hasPermission, isOwner } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired);

/** Require a specific per-server permission (owner/admin always pass). */
function requirePerm(perm) {
  return (req, res, next) => {
    if (hasPermission(req.user, req.server, perm)) return next();
    return res.status(403).json({ error: 'You do not have permission to do that on this server.' });
  };
}
/** Require the server owner (or an administrator). */
function requireOwner(req, res, next) {
  if (isOwner(req.user, req.server)) return next();
  return res.status(403).json({ error: 'Only the server owner can do this.' });
}

// AFK earning is timed on the SERVER (per user) so it can't be sped up by the
// client. Holds userId -> last-credited timestamp (resets on restart).
const afkState = new Map();
const AFK_MAX_INTERVALS = 40; // most a single heartbeat can credit at once
// Single-session lock: userId -> { sid, lastSeen }. Only one AFK page per user
// may earn at a time; a tab is "closed" once it stops sending heartbeats.
const afkSessions = new Map();
const AFK_SESSION_STALE_MS = 15000;

// ---- Server access middleware --------------------------------------------

function loadServer(req, res, next) {
  const server =
    db.get('servers', req.params.id) ||
    db.find('servers', (s) => s.identifier === req.params.id || s.uuid === req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (!canAccessServer(req.user, server))
    return res.status(403).json({ error: 'You do not have access to this server' });
  req.server = server;
  next();
}

/** Require an approved (active) account — admins always pass. */
function activeRequired(req, res, next) {
  if (req.user.admin || req.user.status === 'active') return next();
  return res.status(403).json({ error: 'Your account is awaiting approval before you can do this.' });
}

// ---- Short-lived scoped tickets (URL-based auth for WS + downloads) -------
router.post('/tickets', (req, res) => {
  const scope = (req.body && req.body.scope) || '';
  if (!['console', 'download'].includes(scope)) return res.status(400).json({ error: 'Invalid ticket scope' });
  res.json({ ticket: auth.signTicket(req.user, scope) });
});

// ---- Server listing -------------------------------------------------------

router.get('/servers', (req, res) => {
  const list = db
    .all('servers')
    .filter((s) => canAccessServer(req.user, s))
    .map((s) => serializeServer(s, { user: req.user }));
  res.json({ data: list });
});

// ---- Self-service: egg catalog, quotas, creation, shop -------------------

router.get('/eggs', (req, res) => {
  const data = db.all('eggs').map((e) => ({
    id: e.id, name: e.name, category: e.category, description: e.description,
    installer: e.installer || 'none',
    variables: (e.variables || []).map((v) => ({ name: v.name, env: v.env, default: v.default })),
  }));
  res.json({ data });
});

router.get('/account/resources', (req, res) => {
  const quota = serversSvc.quotaFor(req.user);
  const used = serversSvc.usedResources(req.user.id);
  res.json({
    data: {
      status: req.user.status,
      coins: req.user.coins || 0,
      quota,
      used,
      available: {
        memory: quota.memory - used.memory,
        cpu: quota.cpu - used.cpu,
        disk: quota.disk - used.disk,
        servers: quota.servers - used.servers,
        backups: quota.backups - used.backups,
      },
      economyEnabled: settings.economyEnabled(),
    },
  });
});

router.post('/servers', activeRequired, (req, res) => {
  const b = req.body || {};
  const lim = db.settings().limits;
  const memory = Math.floor(Number(b.memory) || 0);
  const cpu = Math.floor(Number(b.cpu) || 0);
  const disk = Math.floor(Number(b.disk) || 0);
  if (!b.eggId) return res.status(400).json({ error: 'Choose a server type (egg).' });
  if (memory < lim.minMemory) return res.status(400).json({ error: `Memory must be at least ${lim.minMemory} MB` });
  if (cpu < lim.minCpu) return res.status(400).json({ error: `CPU must be at least ${lim.minCpu}%` });
  if (disk < lim.minDisk) return res.status(400).json({ error: `Disk must be at least ${lim.minDisk} MB` });

  const avail = serversSvc.availableResources(req.user);
  if (avail.servers < 1) return res.status(403).json({ error: 'No server slots left — buy one in the shop or delete a server.' });
  if (memory > avail.memory) return res.status(403).json({ error: `Not enough RAM: ${avail.memory} MB available.` });
  if (cpu > avail.cpu) return res.status(403).json({ error: `Not enough CPU: ${avail.cpu}% available.` });
  if (disk > avail.disk) return res.status(403).json({ error: `Not enough disk: ${avail.disk} MB available.` });

  let server;
  try {
    server = serversSvc.createServer({ name: b.name, ownerId: req.user.id, eggId: b.eggId, memory, cpu, disk, environment: b.environment });
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  db.log({ type: 'server', userId: req.user.id, serverId: server.id, message: `${req.user.username} created server '${server.name}'` });
  res.status(201).json({ data: serializeServer(server, { detail: true }) });
});

router.get('/shop', (req, res) => {
  if (!settings.economyEnabled()) return res.status(403).json({ error: 'The shop is disabled.' });
  const s = db.settings();
  res.json({ data: { coins: req.user.coins || 0, shop: s.shop, resources: serversSvc.quotaFor(req.user) } });
});

router.post('/shop/buy', activeRequired, (req, res) => {
  if (!settings.economyEnabled()) return res.status(403).json({ error: 'The shop is disabled.' });
  const { resource, quantity } = req.body || {};
  const s = db.settings();
  const item = s.shop[resource];
  if (!item) return res.status(400).json({ error: 'Unknown shop item.' });
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const cost = item.price * qty;
  const coins = req.user.coins || 0;
  if (cost > coins) return res.status(402).json({ error: `Not enough coins — this costs ${cost}, you have ${coins}.` });
  const resources = { ...req.user.resources };
  resources[resource] = (resources[resource] || 0) + item.amount * qty;
  const updated = db.update('users', req.user.id, { coins: coins - cost, resources });
  db.log({ type: 'shop', userId: req.user.id, message: `${req.user.username} bought ${item.amount * qty} ${resource} for ${cost} coins` });
  res.json({ data: { coins: updated.coins, resources: updated.resources, bought: { resource, amount: item.amount * qty, cost } } });
});

// ---- AFK earning ----------------------------------------------------------

function afkConfig() {
  const a = db.settings().afk || {};
  return { enabled: settings.economyEnabled() && !!a.enabled, coins: a.coins || 0, intervalSeconds: a.intervalSeconds || 30 };
}

router.get('/afk', (req, res) => {
  const cfg = afkConfig();
  res.json({ data: { enabled: cfg.enabled, perInterval: cfg.coins, intervalSeconds: cfg.intervalSeconds, coins: req.user.coins || 0 } });
});

router.post('/afk/heartbeat', activeRequired, (req, res) => {
  const cfg = afkConfig();
  if (!cfg.enabled) return res.status(403).json({ error: 'AFK earning is disabled.' });

  const uid = req.user.id;
  const sid = String((req.body && req.body.sid) || '');
  const now = Date.now();
  const intervalMs = cfg.intervalSeconds * 1000;
  const base = { intervalSeconds: cfg.intervalSeconds, perInterval: cfg.coins, coins: req.user.coins || 0 };

  // ---- Single-session lock (anti multi-tab) ----
  const sess = afkSessions.get(uid);
  if (sess && sess.sid !== sid && now - sess.lastSeen < AFK_SESSION_STALE_MS) {
    return res.json({ data: { ...base, locked: true } });
  }
  const isNewSession = !sess || sess.sid !== sid;
  afkSessions.set(uid, { sid, lastSeen: now });

  // New/claiming session (or very first beat): (re)start the clock from NOW so
  // no coins are earned for time when no AFK page was actually open.
  if (isNewSession || afkState.get(uid) == null) {
    afkState.set(uid, now);
    return res.json({ data: { ...base, earned: 0, nextInSeconds: cfg.intervalSeconds } });
  }

  const last = afkState.get(uid);
  let intervals = Math.floor((now - last) / intervalMs);
  if (intervals <= 0) {
    return res.json({ data: { ...base, earned: 0, nextInSeconds: Math.ceil((intervalMs - (now - last)) / 1000) } });
  }
  if (intervals > AFK_MAX_INTERVALS) intervals = AFK_MAX_INTERVALS;

  afkState.set(uid, last + intervals * intervalMs);
  const earned = intervals * cfg.coins;
  const updated = db.update('users', uid, { coins: (req.user.coins || 0) + earned });
  res.json({ data: { ...base, coins: updated.coins, earned, nextInSeconds: cfg.intervalSeconds } });
});

router.get('/servers/:id', loadServer, (req, res) => {
  res.json({ data: serializeServer(req.server, { detail: true, user: req.user }) });
});

router.get('/servers/:id/resources', loadServer, requirePerm('control.console'), (req, res) => {
  res.json({ data: pm.state(req.server.id) });
});

// ---- Power & console ------------------------------------------------------

router.post('/servers/:id/power', loadServer, requirePerm('control.power'), async (req, res) => {
  const action = (req.body && req.body.action) || '';
  if (!['start', 'stop', 'restart', 'kill'].includes(action))
    return res.status(400).json({ error: 'Invalid power action' });
  const result = await pm.power(req.server, action);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true, action });
});

router.post('/servers/:id/reinstall', loadServer, requireOwner, (req, res) => {
  if (pm.isInstalling(req.server.id))
    return res.status(409).json({ error: 'Server is already installing' });
  // Kick off in the background; progress streams to the console.
  pm.provision(req.server, { trigger: 'reinstall' }).catch(() => {});
  res.status(202).json({ ok: true });
});

router.post('/servers/:id/command', loadServer, requirePerm('control.command'), (req, res) => {
  const command = (req.body && req.body.command) || '';
  if (!command.trim()) return res.status(400).json({ error: 'Command is required' });
  const result = pm.command(req.server.id, command);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

router.get('/servers/:id/logs', loadServer, requirePerm('control.console'), (req, res) => {
  res.json({ data: pm.recentLogs(req.server.id) });
});

// ---- Files ----------------------------------------------------------------

router.get('/servers/:id/files/list', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const dir = req.query.path || '/';
    res.json({ path: dir, data: await files.list(req.server, dir) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/servers/:id/files/contents', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const content = await files.read(req.server, req.query.path || '/');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/write', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    const saved = await files.write(req.server, p, content);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/mkdir', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const saved = await files.mkdir(req.server, (req.body || {}).path);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/rename', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const saved = await files.rename(req.server, from, to);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/delete', loadServer, requirePerm('file'), async (req, res) => {
  try {
    await files.remove(req.server, (req.body || {}).path);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Streamed upload: raw body -> file at ?path=. Used for files & folder uploads
// (the client sends each file with its relative path).
router.post('/servers/:id/files/upload', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const saved = await files.saveStream(req.server, req.query.path || '/', req);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(err.code === 'TOO_LARGE' ? 413 : 400).json({ error: err.message });
  }
});

// Extract an uploaded .zip in place.
router.post('/servers/:id/files/unzip', loadServer, requirePerm('file'), async (req, res) => {
  try {
    const result = await files.unzip(req.server, (req.body || {}).path);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Backups --------------------------------------------------------------

const serializeBackup = (b) => ({ id: b.id, name: b.name, sizeBytes: b.sizeBytes || 0, createdAt: b.createdAt });

router.get('/servers/:id/backups', loadServer, requirePerm('backup'), (req, res) => {
  res.json({ data: backups.list(req.server.id).map(serializeBackup) });
});

router.post('/servers/:id/backups', loadServer, requirePerm('backup'), activeRequired, (req, res) => {
  // Quota counts against the server owner (admins bypass).
  if (!req.user.admin) {
    const owner = db.get('users', req.server.ownerId) || req.user;
    if (serversSvc.availableResources(owner).backups < 1)
      return res.status(403).json({ error: 'No backup slots left — buy more in the shop or delete an old backup.' });
  }
  let rec;
  try { rec = backups.create(req.server, { name: (req.body || {}).name, createdBy: req.user.id }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  db.log({ type: 'backup', userId: req.user.id, serverId: req.server.id, message: `Backup '${rec.name}' created` });
  res.status(201).json({ data: serializeBackup(rec) });
});

router.post('/servers/:id/backups/:bid/restore', loadServer, requirePerm('backup'), async (req, res) => {
  try {
    const result = await backups.restore(req.server, req.params.bid);
    db.log({ type: 'backup', userId: req.user.id, serverId: req.server.id, message: 'Backup restored' });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Backup downloads are handled by the ticket-authed public route (routes/download.js)
// so the browser can navigate to them without putting a session token in the URL.

router.delete('/servers/:id/backups/:bid', loadServer, requirePerm('backup'), async (req, res) => {
  const removed = await backups.remove(req.server.id, req.params.bid);
  if (!removed) return res.status(404).json({ error: 'Backup not found' });
  res.json({ ok: true });
});

// ---- Console Automations --------------------------------------------------
// Reactive rules: when console output matches a pattern, run an action.

router.get('/servers/:id/automations', loadServer, requirePerm('automation'), (req, res) => {
  res.json({ data: automations.list(req.server.id) });
});

router.post('/servers/:id/automations', loadServer, requirePerm('automation'), activeRequired, (req, res) => {
  try {
    const rule = automations.create(req.server.id, req.body || {});
    db.log({ type: 'automation', userId: req.user.id, serverId: req.server.id, message: `Automation '${rule.name}' created` });
    res.status(201).json({ data: rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/servers/:id/automations/:aid', loadServer, requirePerm('automation'), (req, res) => {
  const cur = automations.get(req.params.aid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Automation not found' });
  try {
    res.json({ data: automations.update(req.params.aid, req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/servers/:id/automations/:aid', loadServer, requirePerm('automation'), (req, res) => {
  const cur = automations.get(req.params.aid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Automation not found' });
  automations.remove(req.params.aid);
  res.json({ ok: true });
});

// Live "does this sample line match?" check for the rule editor.
router.post('/servers/:id/automations/test', loadServer, requirePerm('automation'), (req, res) => {
  const { rule, line } = req.body || {};
  res.json({ data: { matched: automations.testLine(rule || {}, line || '') } });
});

// ---- Network / allocations ------------------------------------------------

router.get('/servers/:id/allocations', loadServer, requirePerm('allocation'), (req, res) => {
  const ids = [req.server.allocationId, ...(req.server.additionalAllocationIds || [])];
  const data = ids
    .map((id) => {
      const a = db.get('allocations', id);
      if (!a) return null;
      return { ...serializeAllocation(a), primary: a.id === req.server.allocationId };
    })
    .filter(Boolean);
  res.json({ data });
});

// ---- Startup --------------------------------------------------------------

router.get('/servers/:id/startup', loadServer, requirePerm('startup'), (req, res) => {
  const egg = db.get('eggs', req.server.eggId);
  res.json({
    data: {
      startup: req.server.startup,
      environment: req.server.environment || {},
      variables: egg ? egg.variables : [],
      docker: egg ? egg.docker : null,
    },
  });
});

router.put('/servers/:id/startup', loadServer, requirePerm('startup'), (req, res) => {
  const { startup, environment } = req.body || {};
  const patch = {};
  // SECURITY: servers run as host processes, so the raw startup command is
  // effectively arbitrary code execution on the host. Only administrators may
  // change it; regular owners can only adjust their egg's variables.
  if (typeof startup === 'string') {
    if (!req.user.admin)
      return res.status(403).json({ error: 'Only an administrator can change the startup command. You can edit variables below.' });
    patch.startup = startup;
  }
  if (environment && typeof environment === 'object')
    patch.environment = { ...req.server.environment, ...environment };
  const updated = db.update('servers', req.server.id, patch);
  db.log({ type: 'server', serverId: req.server.id, message: 'Startup configuration updated' });
  res.json({ data: serializeServer(updated, { detail: true, user: req.user }) });
});

// ---- Settings -------------------------------------------------------------

router.post('/servers/:id/settings/rename', loadServer, requirePerm('settings'), (req, res) => {
  const { name, description } = req.body || {};
  const patch = {};
  if (name && name.trim()) patch.name = name.trim();
  if (typeof description === 'string') patch.description = description;
  const updated = db.update('servers', req.server.id, patch);
  res.json({ data: serializeServer(updated, { detail: true, user: req.user }) });
});

// ---- Subusers (per-server sharing) ---------------------------------------
// Only the owner (or an admin) may manage who else can access the server.

router.get('/servers/:id/subusers', loadServer, requireOwner, (req, res) => {
  res.json({ data: subusers.list(req.server.id), permissions: subusers.PERMISSIONS });
});

router.post('/servers/:id/subusers', loadServer, requireOwner, activeRequired, (req, res) => {
  try {
    const su = subusers.create(req.server, { identifier: (req.body || {}).identifier, permissions: (req.body || {}).permissions, invitedBy: req.user.id });
    db.log({ type: 'subuser', userId: req.user.id, serverId: req.server.id, message: `Added subuser ${su.user.username}` });
    res.status(201).json({ data: su });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/servers/:id/subusers/:sid', loadServer, requireOwner, (req, res) => {
  const cur = subusers.get(req.params.sid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Subuser not found' });
  try { res.json({ data: subusers.update(req.params.sid, { permissions: (req.body || {}).permissions }) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/servers/:id/subusers/:sid', loadServer, requireOwner, (req, res) => {
  const cur = subusers.get(req.params.sid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Subuser not found' });
  subusers.remove(req.params.sid);
  res.json({ ok: true });
});

// ---- Scheduled tasks (cron) ----------------------------------------------

router.get('/servers/:id/schedules', loadServer, requirePerm('schedule'), (req, res) => {
  res.json({ data: schedules.list(req.server.id) });
});

router.post('/servers/:id/schedules', loadServer, requirePerm('schedule'), activeRequired, (req, res) => {
  try {
    const row = schedules.create(req.server.id, req.body || {});
    db.log({ type: 'schedule', userId: req.user.id, serverId: req.server.id, message: `Schedule '${row.name}' created` });
    res.status(201).json({ data: row });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/servers/:id/schedules/:sid', loadServer, requirePerm('schedule'), (req, res) => {
  const cur = schedules.get(req.params.sid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Schedule not found' });
  try { res.json({ data: schedules.update(req.params.sid, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/servers/:id/schedules/:sid', loadServer, requirePerm('schedule'), (req, res) => {
  const cur = schedules.get(req.params.sid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Schedule not found' });
  schedules.remove(req.params.sid);
  res.json({ ok: true });
});

// ---- Per-server databases -------------------------------------------------

router.get('/servers/:id/databases', loadServer, requirePerm('database'), (req, res) => {
  res.json({
    data: databases.list(req.server.id),
    hosts: databases.hosts().map(databases.publicHost),
    limit: databases.quotaFor(req.server),
    used: databases.countForServer(req.server.id),
    driver: databases.driverAvailable(),
  });
});

router.post('/servers/:id/databases', loadServer, requirePerm('database'), activeRequired, async (req, res) => {
  try {
    const d = await databases.create(req.server, { hostId: (req.body || {}).hostId, name: (req.body || {}).name, remote: (req.body || {}).remote });
    db.log({ type: 'database', userId: req.user.id, serverId: req.server.id, message: `Created database ${d.database}` });
    res.status(201).json({ data: d });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/servers/:id/databases/:dbid/rotate', loadServer, requirePerm('database'), async (req, res) => {
  const cur = databases.get(req.params.dbid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Database not found' });
  try { res.json({ data: await databases.rotatePassword(req.params.dbid) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/servers/:id/databases/:dbid', loadServer, requirePerm('database'), async (req, res) => {
  const cur = databases.get(req.params.dbid);
  if (!cur || cur.serverId !== req.server.id) return res.status(404).json({ error: 'Database not found' });
  await databases.remove(req.params.dbid);
  res.json({ ok: true });
});

// ---- Plugin / mod browser (Modrinth) -------------------------------------

router.get('/servers/:id/plugins/search', loadServer, requirePerm('file'), async (req, res) => {
  try { res.json({ data: await modrinth.search(req.server, { query: req.query.q || '', gameVersion: req.query.version || '' }) }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.get('/servers/:id/plugins/versions/:project', loadServer, requirePerm('file'), async (req, res) => {
  try { res.json({ data: await modrinth.versions(req.server, req.params.project, { gameVersion: req.query.version || '' }) }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.get('/servers/:id/plugins/installed', loadServer, requirePerm('file'), async (req, res) => {
  try { res.json({ data: await modrinth.installed(req.server) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/servers/:id/plugins/install', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    const r = await modrinth.install(req.server, { projectId: (req.body || {}).projectId, versionId: (req.body || {}).versionId });
    res.status(201).json({ data: r });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---- Live player list -----------------------------------------------------

router.get('/servers/:id/players', loadServer, requirePerm('player'), (req, res) => {
  res.json({ data: players.list(req.server.id) });
});

router.post('/servers/:id/players/refresh', loadServer, requirePerm('player'), (req, res) => {
  players.refresh(req.server);
  res.json({ ok: true });
});

router.post('/servers/:id/players/:name/kick', loadServer, requirePerm('player'), (req, res) => {
  const r = players.kick(req.server, req.params.name, (req.body || {}).reason);
  if (!r.ok) return res.status(409).json(r);
  db.log({ type: 'player', userId: req.user.id, serverId: req.server.id, message: `Kicked ${req.params.name}` });
  res.json({ ok: true });
});

router.post('/servers/:id/players/:name/ban', loadServer, requirePerm('player'), (req, res) => {
  const r = players.ban(req.server, req.params.name, (req.body || {}).reason);
  if (!r.ok) return res.status(409).json(r);
  db.log({ type: 'player', userId: req.user.id, serverId: req.server.id, message: `Banned ${req.params.name}` });
  res.json({ ok: true });
});

// ---- Historical metrics ---------------------------------------------------

router.get('/servers/:id/metrics', loadServer, requirePerm('control.console'), (req, res) => {
  const rangeSeconds = Math.min(7 * 86400, Math.max(600, parseInt(req.query.range, 10) || 86400));
  res.json({ data: metrics.get(req.server.id, { rangeSeconds }), summary: metrics.summary(req.server.id, rangeSeconds) });
});

// ---- Public status page (config) -----------------------------------------

router.get('/servers/:id/statuspage', loadServer, requirePerm('settings'), (req, res) => {
  res.json({ data: statuspage.configOf(req.server) });
});

router.put('/servers/:id/statuspage', loadServer, requirePerm('settings'), (req, res) => {
  const cfg = statuspage.update(req.server, req.body || {});
  db.log({ type: 'server', userId: req.user.id, serverId: req.server.id, message: `Status page ${cfg.enabled ? 'enabled' : 'disabled'}` });
  res.json({ data: cfg });
});

// ---- Account (self-service) ----------------------------------------------

router.get('/account/activity', (req, res) => {
  const data = db
    .filter('activity', (a) => a.userId === req.user.id || a.type === 'auth')
    .slice(0, 50);
  res.json({ data });
});

router.put('/account/email', (req, res) => {
  const { email, password } = req.body || {};
  if (!auth.checkPassword(req.user, password || ''))
    return res.status(403).json({ error: 'Current password is incorrect' });
  if (!email || !/.+@.+\..+/.test(email))
    return res.status(400).json({ error: 'Valid email required' });
  db.update('users', req.user.id, { email });
  res.json({ ok: true });
});

router.put('/account/password', (req, res) => {
  const { current, password } = req.body || {};
  if (!auth.checkPassword(req.user, current || ''))
    return res.status(403).json({ error: 'Current password is incorrect' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  // Bumping tokenVersion invalidates every existing session token (revocation).
  const updated = db.update('users', req.user.id, {
    password: auth.hashPassword(password),
    tokenVersion: (req.user.tokenVersion || 0) + 1,
  });
  db.log({ type: 'auth', userId: req.user.id, message: 'Password changed (other sessions signed out)' });
  res.json({ ok: true, token: auth.sign(updated) }); // re-issue so THIS session stays signed in
});

// ---- Two-factor authentication (TOTP) ------------------------------------

router.get('/account/2fa', (req, res) => {
  const t = req.user.totp || {};
  res.json({ data: { enabled: !!t.enabled, backupCodesRemaining: Array.isArray(t.backupCodes) ? t.backupCodes.length : 0 } });
});

/** Begin enrollment: mint a pending secret + otpauth URI (not yet active). */
router.post('/account/2fa/setup', (req, res) => {
  if (req.user.totp && req.user.totp.enabled)
    return res.status(409).json({ error: 'Two-factor is already enabled. Disable it first to re-enroll.' });
  const secret = totp.generateSecret();
  db.update('users', req.user.id, { totp: { enabled: false, secret, backupCodes: [] } });
  res.json({ data: { secret, otpauth: totp.otpauthUri(secret, req.user.email || req.user.username, 'Cloud Panel') } });
});

/** Confirm enrollment with a code; returns one-time recovery codes. */
router.post('/account/2fa/enable', (req, res) => {
  const cur = req.user.totp || {};
  if (cur.enabled) return res.status(409).json({ error: 'Two-factor is already enabled.' });
  if (!cur.secret) return res.status(400).json({ error: 'Start setup first.' });
  if (!totp.verify(cur.secret, (req.body || {}).token))
    return res.status(400).json({ error: 'That code is incorrect or expired — check your authenticator app.' });
  const backupCodes = totp.generateBackupCodes();
  db.update('users', req.user.id, {
    twoFactor: true,
    totp: { enabled: true, secret: cur.secret, backupCodes: backupCodes.map(totp.hashCode) },
  });
  db.log({ type: 'auth', userId: req.user.id, message: 'Two-factor authentication enabled' });
  res.json({ data: { enabled: true, backupCodes } });
});

/** Disable 2FA (requires the current password). */
router.post('/account/2fa/disable', (req, res) => {
  if (!auth.checkPassword(req.user, (req.body || {}).password || ''))
    return res.status(403).json({ error: 'Current password is incorrect' });
  db.update('users', req.user.id, { twoFactor: false, totp: { enabled: false, secret: null, backupCodes: [] } });
  db.log({ type: 'auth', userId: req.user.id, message: 'Two-factor authentication disabled' });
  res.json({ ok: true });
});

module.exports = router;
