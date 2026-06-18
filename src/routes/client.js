'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const pm = require('../services/processManager');
const files = require('../services/files');
const settings = require('../services/settings');
const serversSvc = require('../services/servers');
const { canAccessServer, serializeServer, serializeAllocation } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired);

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

// ---- Server listing -------------------------------------------------------

router.get('/servers', (req, res) => {
  const list = db
    .all('servers')
    .filter((s) => canAccessServer(req.user, s))
    .map((s) => serializeServer(s));
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
  res.json({ data: serializeServer(req.server, { detail: true }) });
});

router.get('/servers/:id/resources', loadServer, (req, res) => {
  res.json({ data: pm.state(req.server.id) });
});

// ---- Power & console ------------------------------------------------------

router.post('/servers/:id/power', loadServer, async (req, res) => {
  const action = (req.body && req.body.action) || '';
  if (!['start', 'stop', 'restart', 'kill'].includes(action))
    return res.status(400).json({ error: 'Invalid power action' });
  const result = await pm.power(req.server, action);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true, action });
});

router.post('/servers/:id/reinstall', loadServer, (req, res) => {
  if (pm.isInstalling(req.server.id))
    return res.status(409).json({ error: 'Server is already installing' });
  // Kick off in the background; progress streams to the console.
  pm.provision(req.server, { trigger: 'reinstall' }).catch(() => {});
  res.status(202).json({ ok: true });
});

router.post('/servers/:id/command', loadServer, (req, res) => {
  const command = (req.body && req.body.command) || '';
  if (!command.trim()) return res.status(400).json({ error: 'Command is required' });
  const result = pm.command(req.server.id, command);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

router.get('/servers/:id/logs', loadServer, (req, res) => {
  res.json({ data: pm.recentLogs(req.server.id) });
});

// ---- Files ----------------------------------------------------------------

router.get('/servers/:id/files/list', loadServer, async (req, res) => {
  try {
    const dir = req.query.path || '/';
    res.json({ path: dir, data: await files.list(req.server, dir) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/servers/:id/files/contents', loadServer, async (req, res) => {
  try {
    const content = await files.read(req.server, req.query.path || '/');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/write', loadServer, async (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    const saved = await files.write(req.server, p, content);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/mkdir', loadServer, async (req, res) => {
  try {
    const saved = await files.mkdir(req.server, (req.body || {}).path);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/rename', loadServer, async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const saved = await files.rename(req.server, from, to);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/delete', loadServer, async (req, res) => {
  try {
    await files.remove(req.server, (req.body || {}).path);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Network / allocations ------------------------------------------------

router.get('/servers/:id/allocations', loadServer, (req, res) => {
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

router.get('/servers/:id/startup', loadServer, (req, res) => {
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

router.put('/servers/:id/startup', loadServer, (req, res) => {
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
  res.json({ data: serializeServer(updated, { detail: true }) });
});

// ---- Settings -------------------------------------------------------------

router.post('/servers/:id/settings/rename', loadServer, (req, res) => {
  const { name, description } = req.body || {};
  const patch = {};
  if (name && name.trim()) patch.name = name.trim();
  if (typeof description === 'string') patch.description = description;
  const updated = db.update('servers', req.server.id, patch);
  res.json({ data: serializeServer(updated, { detail: true }) });
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
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.update('users', req.user.id, { password: auth.hashPassword(password) });
  db.log({ type: 'auth', userId: req.user.id, message: 'Password changed' });
  res.json({ ok: true });
});

module.exports = router;
