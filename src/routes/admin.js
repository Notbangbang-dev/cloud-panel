'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const pm = require('../services/processManager');
const firewall = require('../services/firewall');
const nodeToken = require('../services/nodeToken');
const dispatch = require('../services/nodeDispatch');
const users = require('../services/users');
const settings = require('../services/settings');
const appearance = require('../services/appearance');
const achievements = require('../services/achievements');
const billing = require('../services/billing');
const ipguard = require('../services/ipguard');
const ledger = require('../services/ledger');
const backups = require('../services/backups');
const subusers = require('../services/subusers');
const schedules = require('../services/schedules');
const databases = require('../services/databases');
const metrics = require('../services/metrics');
const pkg = require('../../package.json');
const { serializeServer, serializeNode } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired, auth.adminRequired);

// ---- Panel self-health (admin-only; the public /api/health is just liveness) --
router.get('/health', (req, res) => {
  let servers = null;
  try { const all = db.all('servers'); servers = { total: all.length, running: all.filter((s) => s.status === 'running').length }; } catch { /* db not ready */ }
  let sandbox = { mode: 'host' };
  try { const s = require('../services/oci').status(); sandbox = { mode: s.active ? 'oci' : 'host', runtime: s.runtime, active: s.active }; } catch { /* oci optional */ }
  res.json({ data: {
    status: 'ok',
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    store: db.backend ? db.backend.kind : 'unknown',
    sandbox,
    servers,
    time: new Date().toISOString(),
  } });
});

// ---- Overview -------------------------------------------------------------

router.get('/overview', (req, res) => {
  const servers = db.all('servers');
  const running = servers.filter((s) => pm.state(s.id).status === 'running').length;
  res.json({
    data: {
      counts: {
        servers: servers.length,
        running,
        users: db.all('users').length,
        nodes: db.all('nodes').length,
        locations: db.all('locations').length,
        allocations: db.all('allocations').length,
        allocationsUsed: db.filter('allocations', (a) => a.serverId).length,
      },
      nodes: db.all('nodes').map(serializeNode),
      activity: db.all('activity').slice(0, 15),
      version: pkg.version,
      ports: { web: config.webPort, sftp: config.sftpPort },
    },
  });
});

// ---- Users ----------------------------------------------------------------

router.get('/users', (req, res) => {
  res.json({ data: db.all('users').map(auth.publicUser) });
});

router.post('/users', (req, res) => {
  const { username, email, firstName, lastName, password, admin } = req.body || {};
  let user;
  try {
    user = users.createUser({ username, email, password, admin, firstName, lastName });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.log({ type: 'admin', userId: req.user.id, message: `Created user ${username}` });
  res.status(201).json({ data: auth.publicUser(user) });
});

router.patch('/users/:id', (req, res) => {
  const user = db.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { email, firstName, lastName, admin, password, status, coins, resources, avatar } = req.body || {};
  const patch = {};
  if (email) patch.email = email;
  if (firstName !== undefined) patch.firstName = firstName;
  if (lastName !== undefined) patch.lastName = lastName;
  if (admin !== undefined) patch.admin = !!admin;
  if (password) {
    try { users.validatePassword(password); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    patch.password = auth.hashPassword(password);
    // Changing the password from the admin panel invalidates the target user's
    // existing sessions too (revocation), matching the self-service flow.
    patch.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  if (status && ['active', 'pending', 'declined'].includes(status)) patch.status = status;
  if (coins !== undefined) patch.coins = Math.max(0, Math.floor(Number(coins) || 0));
  if (avatar !== undefined) {
    // Only accept an uploaded, same-origin avatar path (or clear it). Blocks
    // remote/script URLs and CSS/HTML-injection via the avatar field.
    const a = avatar ? String(avatar).slice(0, 512) : '';
    patch.avatar = /^\/uploads\/avatars\/[\w.-]+$/.test(a) ? a : null;
  }
  if (resources && typeof resources === 'object') {
    patch.resources = {
      memory: Math.max(0, Math.floor(Number(resources.memory ?? user.resources?.memory) || 0)),
      cpu: Math.max(0, Math.floor(Number(resources.cpu ?? user.resources?.cpu) || 0)),
      disk: Math.max(0, Math.floor(Number(resources.disk ?? user.resources?.disk) || 0)),
      servers: Math.max(0, Math.floor(Number(resources.servers ?? user.resources?.servers) || 0)),
      backups: Math.max(0, Math.floor(Number(resources.backups ?? user.resources?.backups) || 0)),
      databases: Math.max(0, Math.floor(Number(resources.databases ?? user.resources?.databases) || 0)),
    };
  }
  res.json({ data: auth.publicUser(db.update('users', user.id, patch)) });
});

/* ---- Reset a user's locked IP (single-IP lock) -------------------------- */
router.post('/users/:id/reset-ip', (req, res) => {
  const u = db.get('users', req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  ipguard.resetIp(u.id);
  db.log({ type: 'admin', userId: req.user.id, message: `Reset locked IP for ${u.username}` });
  res.json({ ok: true });
});

/* ---- View as user (impersonation) --------------------------------------- */
router.post('/users/:id/impersonate', (req, res) => {
  const target = db.get('users', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You're already yourself." });
  const token = auth.signImpersonation(target, req.user.id);
  db.log({ type: 'admin', userId: req.user.id, message: `${req.user.username} started viewing as ${target.username}` });
  res.json({ data: { token, user: auth.publicUser(target) } });
});

/* ---- Panel analytics ----------------------------------------------------- */
router.get('/analytics', (req, res) => {
  const users = db.all('users');
  const servers = db.all('servers');
  const nodes = db.all('nodes');
  const allocations = db.all('allocations');

  // Signups over the last 14 days (UTC).
  const days = [];
  const byDay = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay[d] = 0; days.push(d);
  }
  users.forEach((u) => { const d = (u.createdAt || '').slice(0, 10); if (d in byDay) byDay[d]++; });

  // Servers grouped by egg.
  const eggName = Object.fromEntries(db.all('eggs').map((e) => [e.id, e.name]));
  const byEgg = {};
  servers.forEach((s) => { const n = eggName[s.eggId] || 'Unknown'; byEgg[n] = (byEgg[n] || 0) + 1; });

  let running = 0;
  servers.forEach((s) => { try { if (pm.state(s.id).status === 'running') running++; } catch {} });

  res.json({
    data: {
      totals: {
        users: users.length,
        usersActive: users.filter((u) => u.status === 'active').length,
        usersPending: users.filter((u) => u.status === 'pending').length,
        admins: users.filter((u) => u.admin).length,
        servers: servers.length,
        serversRunning: running,
        nodes: nodes.length,
        allocationsUsed: allocations.filter((a) => a.serverId).length,
        allocationsTotal: allocations.length,
        coins: users.reduce((s, u) => s + (u.coins || 0), 0),
        xpAwarded: users.reduce((s, u) => s + (u.xp || 0), 0),
        petsOwned: users.reduce((s, u) => s + ((u.pets || []).length), 0),
      },
      signups: days.map((d) => ({ date: d, count: byDay[d] })),
      economyFlow: ledger.recentDays(14),
      serversByEgg: Object.entries(byEgg).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      topBalances: users.slice().sort((a, b) => (b.coins || 0) - (a.coins || 0)).slice(0, 5).map((u) => ({ username: u.username, coins: u.coins || 0 })),
    },
  });
});

/* ---- Custom achievements ------------------------------------------------ */
router.get('/achievements', (req, res) => {
  res.json({ data: achievements.adminList() });
});
router.post('/achievements', (req, res) => {
  try { res.status(201).json({ data: achievements.addCustom(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/achievements/:id', (req, res) => {
  const ok = achievements.removeCustom(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Achievement not found' });
  res.json({ ok: true });
});

/** Approve / decline a pending user. */
router.post('/users/:id/approve', (req, res) => {
  const user = db.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updated = db.update('users', user.id, { status: 'active', approvedAt: new Date().toISOString() });
  db.log({ type: 'admin', userId: req.user.id, message: `Approved ${user.username}` });
  res.json({ data: auth.publicUser(updated) });
});

router.post('/users/:id/decline', (req, res) => {
  const user = db.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updated = db.update('users', user.id, { status: 'declined' });
  db.log({ type: 'admin', userId: req.user.id, message: `Declined ${user.username}` });
  res.json({ data: auth.publicUser(updated) });
});

/** Grant or remove coins (positive or negative amount). */
router.post('/users/:id/coins', (req, res) => {
  const user = db.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const amount = Math.floor(Number((req.body || {}).amount) || 0);
  const coins = Math.max(0, (user.coins || 0) + amount);
  const updated = db.update('users', user.id, { coins });
  if (amount) ledger.record(user.id, amount, 'admin adjustment');
  db.log({ type: 'admin', userId: req.user.id, message: `${amount >= 0 ? 'Gave' : 'Removed'} ${Math.abs(amount)} coins ${amount >= 0 ? 'to' : 'from'} ${user.username}` });
  res.json({ data: auth.publicUser(updated) });
});

router.delete('/users/:id', (req, res) => {
  const user = db.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  if (db.find('servers', (s) => s.ownerId === user.id))
    return res.status(409).json({ error: 'Reassign or delete this user\'s servers first' });
  db.remove('users', user.id);
  db.log({ type: 'admin', userId: req.user.id, message: `Deleted user ${user.username}` });
  res.json({ ok: true });
});

// ---- Settings (economy / registration / shop) ----------------------------

router.get('/settings', (req, res) => {
  // Redact Stripe secrets — never echo them back, even to admins.
  const s = JSON.parse(JSON.stringify(settings.get()));
  if (s.billing && s.billing.stripe) {
    s.billing.stripe.secretKey = s.billing.stripe.secretKey ? '__set__' : '';
    s.billing.stripe.webhookSecret = s.billing.stripe.webhookSecret ? '__set__' : '';
  }
  res.json({ data: s });
});

/* ---- Billing config + plans --------------------------------------------- */
router.get('/billing', (req, res) => {
  res.json({ data: { config: billing.adminConfig(), plans: billing.plans() } });
});

router.put('/billing', (req, res) => {
  const b = req.body || {};
  const curS = (db.settings().billing || {}).stripe || {};
  const inS = b.stripe || {};
  // Keep existing Stripe secrets unless a fresh, non-placeholder value is given.
  const keep = (val, cur) => (val && val !== '__set__') ? val : cur;
  settings.update({
    billing: {
      mode: b.mode, currency: b.currency, trialDays: b.trialDays, cancelBehavior: b.cancelBehavior, trialPlanId: b.trialPlanId,
      stripe: {
        enabled: !!inS.enabled,
        publishableKey: inS.publishableKey != null ? inS.publishableKey : curS.publishableKey,
        secretKey: keep(inS.secretKey, curS.secretKey),
        webhookSecret: keep(inS.webhookSecret, curS.webhookSecret),
      },
    },
  });
  db.log({ type: 'admin', userId: req.user.id, message: 'Updated billing settings' });
  res.json({ data: billing.adminConfig() });
});

router.post('/plans', (req, res) => {
  try { res.status(201).json({ data: billing.createPlan(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/plans/:id', (req, res) => {
  try { res.json({ data: billing.updatePlan(req.params.id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/plans/:id', (req, res) => {
  if (!billing.removePlan(req.params.id)) return res.status(404).json({ error: 'Plan not found' });
  res.json({ ok: true });
});

router.put('/settings', (req, res) => {
  const updated = settings.update(req.body || {});
  db.log({ type: 'admin', userId: req.user.id, message: 'Updated panel settings' });
  res.json({ data: updated });
});

// ---- Appearance / theming --------------------------------------------------

router.get('/appearance', (req, res) => {
  res.json({ data: { appearance: appearance.get(), presets: appearance.presetList() } });
});

/** Save the theme. Body: { appearance: {...} } (full document — replaces). */
router.put('/appearance', (req, res) => {
  const patch = req.body && req.body.appearance ? req.body.appearance : req.body || {};
  settings.update({ appearance: patch });
  db.log({ type: 'admin', userId: req.user.id, message: 'Updated appearance / theme' });
  res.json({ data: { appearance: appearance.get() } });
});

/** Reset the theme to the shipped default. */
router.post('/appearance/reset', (req, res) => {
  settings.update({ appearance: JSON.parse(JSON.stringify(appearance.DEFAULT_APPEARANCE)) });
  db.log({ type: 'admin', userId: req.user.id, message: 'Reset appearance to defaults' });
  res.json({ data: { appearance: appearance.get() } });
});

/** Live-preview CSS for an unsaved draft (single source of truth = the engine). */
router.post('/appearance/preview', (req, res) => {
  try {
    const draft = req.body && req.body.appearance ? req.body.appearance : req.body || {};
    res.type('text/css').send(appearance.generateCss(draft));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Upload a background asset (image / gif / video) as raw bytes. */
// NOTE: SVG is intentionally excluded — SVGs can carry scripts and would be
// served from our own origin (stored-XSS risk). Use png/jpg/gif/webp instead.
const UPLOAD_TYPES = { png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', mp4: 'video', webm: 'video', ogg: 'video' };
router.post('/appearance/upload', express.raw({ type: () => true, limit: '40mb' }), (req, res) => {
  const filename = String(req.query.filename || 'upload');
  const ext = path.extname(filename).toLowerCase().replace('.', '').slice(0, 8);
  if (!UPLOAD_TYPES[ext])
    return res.status(400).json({ error: 'Unsupported file type. Use png, jpg, gif, webp, mp4 or webm. (SVG is not allowed — it can carry scripts.)' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Empty upload' });
  const dir = path.join(config.uploadsDir, 'appearance');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    db.log({ type: 'admin', userId: req.user.id, message: `Uploaded theme asset ${name}` });
    res.status(201).json({ data: { url: `/uploads/appearance/${name}`, type: UPLOAD_TYPES[ext], name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save upload' });
  }
});

// ---- Locations ------------------------------------------------------------

router.get('/locations', (req, res) => {
  res.json({ data: db.all('locations') });
});

router.post('/locations', (req, res) => {
  const { short, long } = req.body || {};
  if (!short) return res.status(400).json({ error: 'short code required' });
  const loc = db.insert('locations', {
    id: db.uid('loc'),
    short,
    long: long || '',
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ data: loc });
});

router.delete('/locations/:id', (req, res) => {
  if (db.find('nodes', (n) => n.locationId === req.params.id))
    return res.status(409).json({ error: 'Location has nodes attached' });
  db.remove('locations', req.params.id);
  res.json({ ok: true });
});

// ---- Nodes ----------------------------------------------------------------

router.get('/nodes', (req, res) => {
  res.json({ data: db.all('nodes').map(serializeNode) });
});

// Build the one-command daemon installer line for a node (shown once at creation
// / token rotation). Uses the exact URL the admin is browsing as the panel URL.
function panelBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}
function daemonInstallCommand(req, node) {
  const base = panelBaseUrl(req);
  return `curl -fsSL ${base}/scripts/install-daemon.sh | sudo bash -s -- ` +
    `--panel ${base} --node ${node.id} --token ${node.daemonToken} --port ${node.daemonPort}`;
}

router.post('/nodes', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.locationId)
    return res.status(400).json({ error: 'name and locationId are required' });
  const node = db.insert('nodes', {
    id: db.uid('node'),
    uuid: db.uuid(),
    name: b.name,
    description: b.description || '',
    locationId: b.locationId,
    fqdn: b.fqdn || config.publicHost,
    scheme: b.scheme === 'https' ? 'https' : 'http',
    memory: Number(b.memory) || 8192,
    memoryOverallocate: Number(b.memoryOverallocate) || 0,
    disk: Number(b.disk) || 51200,
    diskOverallocate: Number(b.diskOverallocate) || 0,
    cpu: Number(b.cpu) || 400,
    daemonPort: Number(b.daemonPort) || config.webPort,
    sftpPort: Number(b.sftpPort) || config.sftpPort,
    daemonToken: nodeToken.generateNodeToken(), // per-node secret for the daemon
    status: 'unknown',
    maintenance: false,
    createdAt: new Date().toISOString(),
  });
  dispatch.markLocalNode(); // re-resolve which node is local (the new one may be a remote)
  db.log({ type: 'admin', userId: req.user.id, message: `Created node ${node.name}` });
  // Return the token + install command ONCE (Pterodactyl "configure token" pattern).
  res.status(201).json({ data: serializeNode(node), daemonToken: node.daemonToken, installCommand: daemonInstallCommand(req, node) });
});

// Rotate a node's daemon token (invalidates the old daemon until re-run).
router.post('/nodes/:id/rotate-token', (req, res) => {
  const node = db.get('nodes', req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const updated = db.update('nodes', node.id, { daemonToken: nodeToken.generateNodeToken(), status: 'unknown' });
  res.json({ data: serializeNode(updated), daemonToken: updated.daemonToken, installCommand: daemonInstallCommand(req, updated) });
});

router.patch('/nodes/:id', (req, res) => {
  const node = db.get('nodes', req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const fields = ['name', 'description', 'locationId', 'fqdn', 'scheme', 'memory', 'disk', 'cpu', 'maintenance', 'memoryOverallocate', 'diskOverallocate', 'daemonPort', 'sftpPort'];
  const numeric = new Set(['memory', 'disk', 'cpu', 'memoryOverallocate', 'diskOverallocate', 'daemonPort', 'sftpPort']);
  const patch = {};
  for (const f of fields) {
    if (req.body[f] === undefined) continue;
    // Coerce numeric capacity fields (the POST path does; PATCH used to store raw
    // values, which produced NaN in the public status-page totals).
    if (numeric.has(f)) patch[f] = Math.max(0, Number(req.body[f]) || 0);
    else if (f === 'maintenance') patch[f] = !!req.body[f];
    else patch[f] = req.body[f];
  }
  res.json({ data: serializeNode(db.update('nodes', node.id, patch)) });
});

router.delete('/nodes/:id', (req, res) => {
  if (db.find('servers', (s) => s.nodeId === req.params.id))
    return res.status(409).json({ error: 'Node still has servers' });
  db.filter('allocations', (a) => a.nodeId === req.params.id).forEach((a) =>
    db.remove('allocations', a.id)
  );
  db.remove('nodes', req.params.id);
  res.json({ ok: true });
});

// ---- Allocations ----------------------------------------------------------

router.get('/nodes/:id/allocations', (req, res) => {
  res.json({ data: db.filter('allocations', (a) => a.nodeId === req.params.id) });
});

router.post('/nodes/:id/allocations', (req, res) => {
  const node = db.get('nodes', req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const { ip, ports, alias } = req.body || {};
  const list = Array.isArray(ports) ? ports : parsePorts(ports);
  if (!list.length) return res.status(400).json({ error: 'Provide ports e.g. 25565,25570-25575' });
  const created = [];
  for (const port of list) {
    if (db.find('allocations', (a) => a.nodeId === node.id && a.ip === (ip || node.fqdn) && a.port === port))
      continue;
    created.push(
      db.insert('allocations', {
        id: db.uid('alloc'),
        nodeId: node.id,
        ip: ip || node.fqdn,
        alias: alias || null,
        port,
        serverId: null,
        primary: false,
        createdAt: new Date().toISOString(),
      })
    );
  }
  // Best-effort: open each new port in the host firewall (ufw). Fire-and-forget
  // so a slow/again-unprivileged ufw never blocks the API response; firewall.js
  // logs an actionable line if it can't (and is a no-op on cloud hosts where the
  // security group is the real gate).
  for (const a of created) firewall.allowPort(a.port).catch(() => {});
  res.status(201).json({ data: created });
});

router.delete('/allocations/:id', (req, res) => {
  const a = db.get('allocations', req.params.id);
  if (!a) return res.status(404).json({ error: 'Allocation not found' });
  if (a.serverId) return res.status(409).json({ error: 'Allocation is assigned to a server' });
  db.remove('allocations', a.id);
  res.json({ ok: true });
});

// ---- Eggs -----------------------------------------------------------------

router.get('/eggs', (req, res) => {
  res.json({ data: db.all('eggs') });
});

/**
 * Validate a container image reference (R4). Must be a plain image ref —
 * crucially NOT starting with '-' and containing no whitespace/control chars —
 * so it can't smuggle extra `run` flags (e.g. "--privileged") or shell-ish
 * tokens when placed on the `docker run … <image>` line.
 */
function validImageRef(s) {
  return typeof s === 'string'
    && s.length >= 1 && s.length <= 100
    && /^[A-Za-z0-9]/.test(s)            // starts alphanumeric (never '-', '.', '/')
    && /^[A-Za-z0-9._:/@-]+$/.test(s);   // safe charset only (no spaces/ctrl/$/;)
}

/** Validate + normalize an egg builder payload (custom, manual-install eggs). */
function buildEgg(body) {
  const b = body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Name is required.');
  const startup = String(b.startup || '').trim().slice(0, 500);
  if (!startup) throw new Error('Startup command is required.');
  const docker = String(b.docker || 'node:lts').trim().slice(0, 100);
  if (!validImageRef(docker))
    throw new Error('Invalid container image — use a reference like "eclipse-temurin:21-jre" (no spaces or leading dash).');
  const variables = (Array.isArray(b.variables) ? b.variables : []).slice(0, 30).map((v) => ({
    name: String(v.name || '').slice(0, 60),
    env: String(v.env || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+/, '').slice(0, 40),
    default: String(v.default == null ? '' : v.default).slice(0, 300),
    userEditable: !!v.userEditable,
  })).filter((v) => v.env);
  return {
    name,
    category: String(b.category || 'Custom').slice(0, 40),
    description: String(b.description || '').slice(0, 500),
    docker,
    startup,
    stopCommand: String(b.stopCommand || 'stop').slice(0, 60),
    variables,
  };
}

router.post('/eggs', (req, res) => {
  try {
    const e = buildEgg(req.body);
    const rec = { id: 'egg_' + crypto.randomBytes(6).toString('hex'), uuid: crypto.randomUUID(), createdAt: new Date().toISOString(), installer: 'none', custom: true, ...e };
    db.insert('eggs', rec);
    db.log({ type: 'admin', userId: req.user.id, message: `Created egg '${rec.name}'` });
    res.status(201).json({ data: rec });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/eggs/:id', (req, res) => {
  const egg = db.get('eggs', req.params.id);
  if (!egg) return res.status(404).json({ error: 'Egg not found' });
  try {
    const e = buildEgg({ ...egg, ...req.body });
    // Preserve the egg's installer (don't break a built-in's auto-installer).
    const rec = db.update('eggs', egg.id, { name: e.name, category: e.category, description: e.description, docker: e.docker, startup: e.startup, stopCommand: e.stopCommand, variables: e.variables });
    res.json({ data: rec });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/eggs/:id', (req, res) => {
  const egg = db.get('eggs', req.params.id);
  if (!egg) return res.status(404).json({ error: 'Egg not found' });
  db.remove('eggs', egg.id);
  db.log({ type: 'admin', userId: req.user.id, message: `Deleted egg '${egg.name}'` });
  res.json({ ok: true });
});

// ---- Database hosts (for per-server databases) ----------------------------

router.get('/database-hosts', (req, res) => {
  res.json({ data: databases.hosts().map(databases.publicHost), driver: databases.driverAvailable() });
});

router.post('/database-hosts', (req, res) => {
  try { res.status(201).json({ data: databases.addHost(req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/database-hosts/:id', (req, res) => {
  try { res.json({ data: databases.updateHost(req.params.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/database-hosts/:id', (req, res) => {
  try { databases.removeHost(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(409).json({ error: err.message }); }
});

router.post('/database-hosts/:id/test', async (req, res) => {
  const host = databases.hostById(req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  try { res.json({ data: await databases.testHost(host) }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// ---- Servers (admin CRUD) -------------------------------------------------

router.get('/servers', (req, res) => {
  res.json({ data: db.all('servers').map((s) => serializeServer(s)) });
});

router.post('/servers', (req, res) => {
  const b = req.body || {};
  const owner = db.get('users', b.ownerId);
  const node = db.get('nodes', b.nodeId);
  const egg = db.get('eggs', b.eggId);
  if (!owner || !node || !egg)
    return res.status(400).json({ error: 'Valid ownerId, nodeId and eggId are required' });

  let alloc = b.allocationId && db.get('allocations', b.allocationId);
  if (!alloc) alloc = db.find('allocations', (a) => a.nodeId === node.id && !a.serverId);
  if (!alloc) return res.status(409).json({ error: 'No free allocation on this node' });
  if (alloc.serverId) return res.status(409).json({ error: 'Allocation already in use' });

  const server = db.insert('servers', {
    id: db.uid('srv'),
    uuid: db.uuid(),
    identifier: crypto.randomBytes(4).toString('hex'),
    name: b.name || 'New Server',
    description: b.description || '',
    ownerId: owner.id,
    nodeId: node.id,
    eggId: egg.id,
    allocationId: alloc.id,
    additionalAllocationIds: [],
    status: 'offline',
    suspended: false,
    limits: {
      memory: Number(b.memory) || 1024,
      swap: 0,
      disk: Number(b.disk) || 5120,
      cpu: Number(b.cpu) || 100,
      io: 500,
    },
    featureLimits: {
      databases: Math.max(0, Math.floor(Number((b.featureLimits && b.featureLimits.databases) ?? 1))),
      backups: Math.max(0, Math.floor(Number((b.featureLimits && b.featureLimits.backups) ?? 1))),
      allocations: Math.max(0, Math.floor(Number((b.featureLimits && b.featureLimits.allocations) ?? 5))),
    },
    environment: {
      ...(egg.variables || []).reduce((acc, v) => {
        acc[v.env] = v.default;
        return acc;
      }, {}),
      ...(b.environment && typeof b.environment === 'object' ? b.environment : {}),
    },
    startup: egg.startup,
    createdAt: new Date().toISOString(),
  });
  db.update('allocations', alloc.id, { serverId: server.id, primary: true });
  db.log({ type: 'admin', userId: req.user.id, message: `Created server ${server.name}` });
  // Multi-node: push config to the target node's daemon (no-op for the local
  // node) and provision THERE. Dispatch routes local→pm, remote→the daemon.
  Promise.resolve()
    .then(() => dispatch.pushServer(server))
    .then(() => dispatch.provision(server, { trigger: 'install' }))
    .catch((e) => db.log({ type: 'install', serverId: server.id, message: `Install error: ${(e && e.message) || e}` }));
  try { require('../services/players').watch(server.id); } catch {}
  res.status(201).json({ data: serializeServer(server, { detail: true }) });
});

router.patch('/servers/:id', (req, res) => {
  const server = db.get('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const b = req.body || {};
  const patch = {};
  if (b.name) patch.name = b.name;
  if (b.description !== undefined) patch.description = b.description;
  if (b.ownerId && db.get('users', b.ownerId)) patch.ownerId = b.ownerId;
  if (b.suspended !== undefined) patch.suspended = !!b.suspended;
  if (b.limits) patch.limits = { ...server.limits, ...b.limits };
  if (b.featureLimits) patch.featureLimits = { ...server.featureLimits, ...b.featureLimits };
  res.json({ data: serializeServer(db.update('servers', server.id, patch), { detail: true }) });
});

router.delete('/servers/:id', async (req, res) => {
  const server = db.get('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (dispatch.isLocalServer(server)) await pm.kill(server);
  else { try { await dispatch.removeServer(server); } catch {} } // kill + wipe on the remote node
  [server.allocationId, ...(server.additionalAllocationIds || [])].forEach((id) => {
    if (db.get('allocations', id)) db.update('allocations', id, { serverId: null, primary: false });
  });
  await backups.removeAllForServer(server.id);
  subusers.removeAllForServer(server.id);
  schedules.removeAllForServer(server.id);
  try { await databases.removeAllForServer(server.id); } catch {}
  metrics.removeForServer(server.id);
  db.remove('servers', server.id);
  db.log({ type: 'admin', userId: req.user.id, message: `Deleted server ${server.name}` });
  res.json({ ok: true });
});

// ---- Activity -------------------------------------------------------------

router.get('/activity', (req, res) => {
  res.json({ data: db.all('activity').slice(0, 100) });
});

function parsePorts(str) {
  if (!str) return [];
  const out = [];
  for (const part of String(str).split(',')) {
    const trimmed = part.trim();
    if (/^\d+-\d+$/.test(trimmed)) {
      const [a, b] = trimmed.split('-').map(Number);
      for (let p = a; p <= b && out.length < 5000; p++) out.push(p);
    } else if (/^\d+$/.test(trimmed)) {
      out.push(Number(trimmed));
    }
  }
  return out;
}

module.exports = router;
