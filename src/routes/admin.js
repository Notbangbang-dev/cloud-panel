'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const pm = require('../services/processManager');
const users = require('../services/users');
const settings = require('../services/settings');
const appearance = require('../services/appearance');
const backups = require('../services/backups');
const pkg = require('../../package.json');
const { serializeServer, serializeNode } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired, auth.adminRequired);

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
  const { email, firstName, lastName, admin, password, status, coins, resources } = req.body || {};
  const patch = {};
  if (email) patch.email = email;
  if (firstName !== undefined) patch.firstName = firstName;
  if (lastName !== undefined) patch.lastName = lastName;
  if (admin !== undefined) patch.admin = !!admin;
  if (password) patch.password = auth.hashPassword(password);
  if (status && ['active', 'pending', 'declined'].includes(status)) patch.status = status;
  if (coins !== undefined) patch.coins = Math.max(0, Math.floor(Number(coins) || 0));
  if (resources && typeof resources === 'object') {
    patch.resources = {
      memory: Math.max(0, Math.floor(Number(resources.memory ?? user.resources?.memory) || 0)),
      cpu: Math.max(0, Math.floor(Number(resources.cpu ?? user.resources?.cpu) || 0)),
      disk: Math.max(0, Math.floor(Number(resources.disk ?? user.resources?.disk) || 0)),
      servers: Math.max(0, Math.floor(Number(resources.servers ?? user.resources?.servers) || 0)),
      backups: Math.max(0, Math.floor(Number(resources.backups ?? user.resources?.backups) || 0)),
    };
  }
  res.json({ data: auth.publicUser(db.update('users', user.id, patch)) });
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
  res.json({ data: settings.get() });
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
const UPLOAD_TYPES = { png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', mp4: 'video', webm: 'video', ogg: 'video' };
router.post('/appearance/upload', express.raw({ type: () => true, limit: '40mb' }), (req, res) => {
  const filename = String(req.query.filename || 'upload');
  const ext = path.extname(filename).toLowerCase().replace('.', '').slice(0, 8);
  if (!UPLOAD_TYPES[ext])
    return res.status(400).json({ error: 'Unsupported file type. Use png, jpg, gif, webp, svg, mp4 or webm.' });
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
    scheme: b.scheme || 'http',
    memory: Number(b.memory) || 8192,
    memoryOverallocate: Number(b.memoryOverallocate) || 0,
    disk: Number(b.disk) || 51200,
    diskOverallocate: Number(b.diskOverallocate) || 0,
    cpu: Number(b.cpu) || 400,
    daemonPort: config.webPort,
    sftpPort: config.sftpPort,
    maintenance: false,
    createdAt: new Date().toISOString(),
  });
  db.log({ type: 'admin', userId: req.user.id, message: `Created node ${node.name}` });
  res.status(201).json({ data: serializeNode(node) });
});

router.patch('/nodes/:id', (req, res) => {
  const node = db.get('nodes', req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const fields = ['name', 'description', 'locationId', 'fqdn', 'scheme', 'memory', 'disk', 'cpu', 'maintenance', 'memoryOverallocate', 'diskOverallocate'];
  const patch = {};
  for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f];
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
    featureLimits: { databases: 5, backups: 5, allocations: 5 },
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
  // Auto-provision real server files when the egg has an installer (Paper/Vanilla).
  pm.provision(server, { trigger: 'install' }).catch(() => {});
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
  await pm.kill(server);
  [server.allocationId, ...(server.additionalAllocationIds || [])].forEach((id) => {
    if (db.get('allocations', id)) db.update('allocations', id, { serverId: null, primary: false });
  });
  await backups.removeAllForServer(server.id);
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
