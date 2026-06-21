'use strict';

/** Public, read-only status pages — no authentication required. */

const express = require('express');
const db = require('../db');
const pm = require('../services/processManager');
const statuspage = require('../services/statuspage');
const { rateLimit } = require('../middleware');

const router = express.Router();
const limiter = rateLimit({ windowMs: 60000, max: 120, message: 'Too many requests — slow down.' });

// Panel-wide network status (admin-toggleable) at /status.
router.get('/status', limiter, (req, res) => {
  const cfg = db.settings().statusOverview || {};
  if (!cfg.enabled) return res.status(404).json({ error: 'The network status page is not enabled.' });
  const servers = db.all('servers');
  let online = 0;
  for (const sv of servers) { try { if (pm.state(sv.id).status === 'running') online++; } catch {} }
  res.json({ data: { title: cfg.title || 'Network Status', total: servers.length, online, nodes: db.all('nodes').length, updatedAt: new Date().toISOString() } });
});

router.get('/status/:slug', limiter, (req, res) => {
  const server = statuspage.findBySlug(req.params.slug);
  if (!server) return res.status(404).json({ error: 'No public status page found for that address.' });
  res.json({ data: statuspage.publicView(server) });
});

module.exports = router;
