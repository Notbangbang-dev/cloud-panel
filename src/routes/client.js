'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const dispatch = require('../services/nodeDispatch'); // local→pm/files, remote→node daemon
const files = dispatch.files; // same signatures as services/files
const javaSvc = require('../services/java');
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
const daily = require('../services/dailyrewards');
const appearance = require('../services/appearance');
const achievements = require('../services/achievements');
const pets = require('../services/pets');
const friends = require('../services/friends');
const presence = require('../services/presence');
const ledger = require('../services/ledger');
const billing = require('../services/billing');
const ipguard = require('../services/ipguard');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { rateLimit } = require('../middleware');
const { canAccessServer, serializeServer, serializeAllocation, hasPermission, isOwner } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired);

// Track presence on every authenticated client request (in-memory, cheap).
router.use((req, res, next) => { presence.touch(req.user.id); next(); });

// Single-IP lock — block a session reused from an IP other than the bound one.
router.use((req, res, next) => {
  const reason = ipguard.singleIpCheck(req.user, req.ip);
  if (reason) return res.status(403).json({ error: reason, ipLocked: true });
  next();
});

// Maintenance mode — lock non-admins out of the whole client API with a notice.
// Admins keep full access so they can still manage the panel while it's "down".
router.use((req, res, next) => {
  if (settings.maintenanceActive() && !req.user.admin) {
    const m = db.settings().maintenance || {};
    return res.status(503).json({ error: m.message || 'The panel is under maintenance.', maintenance: true });
  }
  next();
});

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
        databases: quota.databases - used.databases,
      },
      economyEnabled: settings.economyEnabled(),
    },
  });
});

router.post('/servers', activeRequired, (req, res) => {
  // Paywall: in paid / trial mode, a member must hold an active plan (or trial)
  // before deploying any server. Enforced here so it can't be bypassed via the API.
  if (billing.requiresPlan(req.user)) {
    return res.status(402).json({ error: 'Choose a plan to start deploying servers.', needsPlan: true });
  }
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
  try { achievements.evaluate(db.get('users', req.user.id)); } catch {}
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
  ledger.record(req.user.id, -cost, `shop: ${resource}`);
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
  if (earned) ledger.record(uid, earned, 'afk');
  // "Night Owl": grinding AFK coins between 2–5am local time.
  try { const hr = new Date().getHours(); if (hr >= 2 && hr < 5) achievements.bump(updated, 'afkNight'); } catch {}
  res.json({ data: { ...base, coins: updated.coins, earned, nextInSeconds: cfg.intervalSeconds } });
});

// ---- Daily reward ---------------------------------------------------------

router.get('/account/daily', (req, res) => {
  res.json({ data: daily.status(req.user) });
});

router.post('/account/daily/claim', activeRequired, (req, res) => {
  const r = daily.claim(req.user);
  if (!r.ok) return res.status(r.code === 'DISABLED' ? 403 : 409).json({ error: r.error });
  try { achievements.evaluate(db.get('users', req.user.id)); } catch {}
  res.json({ data: r });
});

// ---- Per-user theme + profile picture ------------------------------------

const PRESET_IDS = new Set(appearance.presetList().map((p) => p.id));

// Choose a personal theme preset (or null to follow the panel default).
router.put('/account/theme', (req, res) => {
  let preset = req.body && req.body.preset;
  if (preset === '' || preset === 'default' || preset === null) preset = null;
  if (preset !== null && !PRESET_IDS.has(preset)) return res.status(400).json({ error: 'Unknown theme preset' });
  const updated = db.update('users', req.user.id, { themePreset: preset });
  res.json({ data: { themePreset: updated.themePreset } });
});

// SECURITY: verify the file's CONTENT is a real image (magic bytes) rather than
// trusting the client-supplied filename/extension. This (plus the global
// X-Content-Type-Options: nosniff and the image-only extensions we write) stops
// someone storing HTML/SVG/script bytes under a ".png" name. SVG is NOT accepted
// (it can carry script). The stored extension is derived from the real type.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'; // GIF8
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp'; // RIFF…WEBP
  return null;
}

const avatarLimiter = rateLimit({ windowMs: 60000, max: 12, message: 'Too many avatar uploads — wait a minute and try again.' });

// Upload a profile picture (raw bytes; real images only, ≤ 3 MB).
router.post('/account/avatar', avatarLimiter, express.raw({ type: () => true, limit: '3mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Empty upload' });
  const kind = sniffImage(buf);
  if (!kind) return res.status(400).json({ error: 'Upload a real PNG, JPG, GIF or WebP image.' });
  const dir = path.join(config.uploadsDir, 'avatars');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Filename is fully server-generated (user id + time + random + verified ext)
    // — no part of the client filename is used, so no path-traversal surface.
    const name = `${req.user.id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${kind}`;
    fs.writeFileSync(path.join(dir, name), buf);
    // Best-effort cleanup of the user's previous avatar file.
    const prev = req.user.avatar;
    if (prev && /^\/uploads\/avatars\/[\w.-]+$/.test(prev)) {
      try { fs.rmSync(path.join(dir, path.basename(prev)), { force: true }); } catch {}
    }
    const url = `/uploads/avatars/${name}`;
    db.update('users', req.user.id, { avatar: url });
    res.status(201).json({ data: { avatar: url } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save avatar' });
  }
});

router.delete('/account/avatar', (req, res) => {
  const prev = req.user.avatar;
  if (prev && /^\/uploads\/avatars\/[\w.-]+$/.test(prev)) {
    try { fs.rmSync(path.join(config.uploadsDir, 'avatars', path.basename(prev)), { force: true }); } catch {}
  }
  db.update('users', req.user.id, { avatar: null });
  res.json({ data: { avatar: null } });
});

// ---- Achievements & XP ----------------------------------------------------

router.get('/achievements', (req, res) => {
  res.json({ data: achievements.list(req.user) });
});

// ---- Server pets ----------------------------------------------------------

router.get('/pets', (req, res) => {
  res.json({ data: pets.view(req.user) });
});

router.post('/pets/buy', activeRequired, (req, res) => {
  try { res.json({ data: pets.buy(req.user, String((req.body || {}).petId || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/pets/active', (req, res) => {
  try { res.json({ data: pets.setActive(req.user, (req.body || {}).petId || null) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Friends & presence ---------------------------------------------------

router.post('/presence/ping', (req, res) => { presence.touch(req.user.id); res.json({ ok: true }); });

router.get('/friends', (req, res) => res.json({ data: friends.list(req.user) }));
router.post('/friends/request', activeRequired, (req, res) => {
  try { res.json({ data: friends.request(req.user, (req.body || {}).username) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/friends/accept', (req, res) => {
  try { res.json({ data: friends.accept(req.user, (req.body || {}).id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/friends/decline', (req, res) => {
  try { res.json({ data: friends.decline(req.user, (req.body || {}).id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/friends/:id', (req, res) => {
  try { res.json({ data: friends.remove(req.user, req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Billing / paid plans -------------------------------------------------

router.get('/billing', (req, res) => {
  res.json({ data: { config: billing.publicConfig(), plans: billing.plans({ activeOnly: true }), current: billing.userPlan(req.user) } });
});

router.post('/billing/checkout', activeRequired, async (req, res) => {
  try {
    const planId = String((req.body || {}).planId || '');
    const plan = billing.getPlan(planId);
    if (plan && plan.price <= 0) return res.json({ data: { free: true, ...billing.selectFreePlan(req.user, planId) } });
    let origin = String((req.body || {}).origin || '');
    if (!/^https?:\/\/[^/]+$/.test(origin)) origin = `${req.protocol}://${req.get('host')}`;
    const r = await billing.createCheckout(req.user, planId, origin);
    res.json({ data: { url: r.url } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/billing/confirm', activeRequired, async (req, res) => {
  try { res.json({ data: await billing.confirmCheckout(req.user, String((req.body || {}).sessionId || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/billing/trial', activeRequired, async (req, res) => {
  try { res.json({ data: await billing.startTrial(req.user, String((req.body || {}).planId || ''), { ip: req.ip }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/servers/:id', loadServer, (req, res) => {
  res.json({ data: serializeServer(req.server, { detail: true, user: req.user }) });
});

router.get('/servers/:id/resources', loadServer, requirePerm('control.console'), (req, res) => {
  res.json({ data: dispatch.state(req.server) });
});

// ---- Power & console ------------------------------------------------------

router.post('/servers/:id/power', loadServer, requirePerm('control.power'), async (req, res) => {
  const action = (req.body && req.body.action) || '';
  if (!['start', 'stop', 'restart', 'kill'].includes(action))
    return res.status(400).json({ error: 'Invalid power action' });
  // "Crash Survivor": reviving a server that's currently crashed.
  if (action === 'start' || action === 'restart') {
    try { if (dispatch.state(req.server).status === 'crashed') achievements.bump(db.get('users', req.user.id), 'crashes'); } catch {}
  }
  const result = await dispatch.power(req.server, action);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true, action });
});

// Per-server console appearance (theme + custom ANSI palette), saved server-side.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ANSI_CODES = ['30', '31', '32', '33', '34', '35', '36', '37', '90', '91', '92', '93', '94', '95', '96', '97'];
function sanitizeConsole(input) {
  const b = input || {};
  const out = { theme: ['default', 'ink', 'solarized', 'matrix', 'light', 'custom'].includes(b.theme) ? b.theme : 'default' };
  if (HEX_RE.test(b.bg || '')) out.bg = b.bg;
  if (HEX_RE.test(b.fg || '')) out.fg = b.fg;
  if (b.ansi && typeof b.ansi === 'object') {
    out.ansi = {};
    for (const k of ANSI_CODES) if (HEX_RE.test(b.ansi[k] || '')) out.ansi[k] = b.ansi[k];
  }
  return out;
}
router.put('/servers/:id/console', loadServer, requirePerm('control.console'), (req, res) => {
  const updated = db.update('servers', req.server.id, { console: sanitizeConsole(req.body) });
  res.json({ data: { console: updated.console } });
});

router.post('/servers/:id/reinstall', loadServer, requireOwner, (req, res) => {
  if (dispatch.isInstalling(req.server))
    return res.status(409).json({ error: 'Server is already installing' });
  // Kick off in the background; progress streams to the console.
  dispatch.provision(req.server, { trigger: 'reinstall' }).catch(() => {});
  res.status(202).json({ ok: true });
});

router.post('/servers/:id/command', loadServer, requirePerm('control.command'), async (req, res) => {
  const command = (req.body && req.body.command) || '';
  if (!command.trim()) return res.status(400).json({ error: 'Command is required' });
  const result = await dispatch.command(req.server, command);
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

router.get('/servers/:id/logs', loadServer, requirePerm('control.console'), async (req, res) => {
  res.json({ data: await dispatch.recentLogs(req.server) });
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

router.post('/servers/:id/files/write', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    const saved = await files.write(req.server, p, content);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/mkdir', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    const saved = await files.mkdir(req.server, (req.body || {}).path);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/rename', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const saved = await files.rename(req.server, from, to);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/servers/:id/files/delete', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    await files.remove(req.server, (req.body || {}).path);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Streamed upload: raw body -> file at ?path=. Used for files & folder uploads
// (the client sends each file with its relative path).
router.post('/servers/:id/files/upload', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
  try {
    const saved = await files.saveStream(req.server, req.query.path || '/', req);
    res.json({ ok: true, path: saved });
  } catch (err) {
    res.status(err.code === 'TOO_LARGE' ? 413 : 400).json({ error: err.message });
  }
});

// Extract an uploaded .zip in place.
router.post('/servers/:id/files/unzip', loadServer, requirePerm('file'), activeRequired, async (req, res) => {
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

router.post('/servers/:id/backups', loadServer, requirePerm('backup'), activeRequired, async (req, res) => {
  // Each server can hold up to its featureLimits.backups (allocated from the
  // owner's quota in Settings → Resources).
  const cap = (req.server.featureLimits && req.server.featureLimits.backups) || 0;
  const have = backups.list(req.server.id).length;
  if (have >= cap)
    return res.status(403).json({ error: `Backup limit reached for this server (${cap}). Raise it in Settings → Resources, or buy more backup slots in the shop.` });
  let rec;
  try { rec = await backups.create(req.server, { name: (req.body || {}).name, createdBy: req.user.id }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  db.log({ type: 'backup', userId: req.user.id, serverId: req.server.id, message: `Backup '${rec.name}' created` });
  try { achievements.bump(db.get('users', req.user.id), 'backupsCreated'); } catch {}
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
  const javaEligible = javaSvc.isJavaEgg(egg);
  res.json({
    data: {
      startup: req.server.startup,
      environment: req.server.environment || {},
      variables: egg ? egg.variables : [],
      docker: egg ? egg.docker : null,
      java: javaEligible
        ? {
            eligible: true,
            options: javaSvc.ALLOWED_VERSIONS,
            default: javaSvc.defaultVersion(egg),
            current: javaSvc.normalizeVersion(req.server.javaVersion) || javaSvc.defaultVersion(egg),
            image: javaSvc.resolveImage(egg, req.server),
            compatFlags: javaSvc.compatFlags(egg),
          }
        : { eligible: false },
    },
  });
});

router.put('/servers/:id/startup', loadServer, requirePerm('startup'), (req, res) => {
  const { startup, environment, javaVersion } = req.body || {};
  const patch = {};
  // SECURITY: servers run as host processes, so the raw startup command is
  // effectively arbitrary code execution on the host. Only administrators may
  // change it; regular owners can only adjust their egg's variables.
  if (typeof startup === 'string') {
    if (!req.user.admin)
      return res.status(403).json({ error: 'Only an administrator can change the startup command. You can edit variables below.' });
    patch.startup = startup;
  }
  // Java version: SAFE for owners to change because it's constrained to a fixed
  // allowlist (java.js) — it can only ever select an `eclipse-temurin:<v>-jre`
  // image, never an arbitrary image or command. null/'' clears it (egg default).
  if (javaVersion !== undefined) {
    const egg = db.get('eggs', req.server.eggId);
    if (!javaSvc.isJavaEgg(egg))
      return res.status(400).json({ error: 'This server’s egg does not run on Java.' });
    if (javaVersion === null || javaVersion === '') {
      patch.javaVersion = null;
    } else {
      const v = javaSvc.normalizeVersion(javaVersion);
      if (!v)
        return res.status(400).json({ error: `Unsupported Java version. Choose one of: ${javaSvc.ALLOWED_VERSIONS.join(', ')}.` });
      patch.javaVersion = v;
    }
  }
  if (environment && typeof environment === 'object') {
    for (const v of Object.values(environment)) {
      if (typeof v === 'string' && /[\u0000-\u001f\u007f]/.test(v))
        return res.status(400).json({ error: 'Environment values can’t contain control characters.' });
    }
    patch.environment = { ...req.server.environment, ...environment };
  }
  const updated = db.update('servers', req.server.id, patch);
  db.log({ type: 'server', serverId: req.server.id, message: 'Startup configuration updated' });
  res.json({ data: serializeServer(updated, { detail: true, user: req.user }) });
});

// ---- Settings -------------------------------------------------------------

router.post('/servers/:id/settings/rename', loadServer, requirePerm('settings'), (req, res) => {
  const { name, description, autoStart, autoRestart } = req.body || {};
  const patch = {};
  if (name && name.trim()) patch.name = name.trim();
  if (typeof description === 'string') patch.description = description;
  // Reliability toggles: resume-on-boot + auto-restart-on-crash.
  if (autoStart !== undefined) patch.autoStart = !!autoStart;
  if (autoRestart !== undefined) patch.autoRestart = !!autoRestart;
  const updated = db.update('servers', req.server.id, patch);
  res.json({ data: serializeServer(updated, { detail: true, user: req.user }) });
});

// Edit this server's resources (RAM/CPU/disk) and feature limits (backups,
// databases) within the owner's quota. Owners (and admins) only — admins are
// not bound by the quota. Each value can grow up to (free quota + what this
// server already uses), and can't drop below what's already in use.
router.put('/servers/:id/build', loadServer, requireOwner, (req, res) => {
  const b = req.body || {};
  const lim = db.settings().limits;
  const owner = db.get('users', req.server.ownerId) || req.user;
  const isAdmin = !!req.user.admin;
  const avail = serversSvc.availableResources(owner); // free quota (excludes this edit)
  const curL = req.server.limits || {};
  const curF = req.server.featureLimits || {};

  const usedBackups = backups.list(req.server.id).length;
  const usedDatabases = databases.countForServer(req.server.id);

  const errors = [];
  // key, current allocation on this server, minimum, friendly label, optional floor (already-in-use)
  function resolve(key, cur, min, label, inUse) {
    if (b[key] === undefined || b[key] === null || b[key] === '') return cur;
    let v = Math.floor(Number(b[key]));
    if (!Number.isFinite(v)) { errors.push(`${label} is not a number`); return cur; }
    if (v < min) { errors.push(`${label} must be at least ${min}`); return cur; }
    if (inUse !== undefined && v < inUse) { errors.push(`${label} can't be below what's in use (${inUse})`); return cur; }
    if (!isAdmin && v > avail[key] + cur) { errors.push(`Not enough ${label} quota (max ${Math.max(min, avail[key] + cur)})`); return cur; }
    return v;
  }

  const memory = resolve('memory', curL.memory || 0, lim.minMemory, 'RAM');
  const cpu = resolve('cpu', curL.cpu || 0, lim.minCpu, 'CPU');
  const disk = resolve('disk', curL.disk || 0, lim.minDisk, 'Disk');
  const backupsLim = resolve('backups', curF.backups || 0, 0, 'Backups', usedBackups);
  const databasesLim = resolve('databases', curF.databases || 0, 0, 'Databases', usedDatabases);

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const updated = db.update('servers', req.server.id, {
    limits: { ...curL, memory, cpu, disk },
    featureLimits: { ...curF, backups: backupsLim, databases: databasesLim },
  });
  db.log({ type: 'server', userId: req.user.id, serverId: req.server.id, message: `Resources updated (${memory}MB RAM, ${cpu}% CPU, ${disk}MB disk, ${backupsLim} backups, ${databasesLim} databases)` });
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
  try {
    require('../services/users').validatePassword(password);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
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
