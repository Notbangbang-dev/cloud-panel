'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const pm = require('../services/processManager');
const files = require('../services/files');
const { canAccessServer, serializeServer, serializeAllocation } = require('./helpers');

const router = express.Router();
router.use(auth.authRequired);

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

// ---- Server listing -------------------------------------------------------

router.get('/servers', (req, res) => {
  const list = db
    .all('servers')
    .filter((s) => canAccessServer(req.user, s))
    .map((s) => serializeServer(s));
  res.json({ data: list });
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
  if (typeof startup === 'string') patch.startup = startup;
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
