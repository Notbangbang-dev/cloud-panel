'use strict';

/**
 * Panel-side receiver for daemon → panel traffic (heartbeats). Public route, but
 * each request is authenticated with the node's own shared secret (the daemon
 * signs, the panel verifies with that node's daemonToken).
 */

const express = require('express');
const db = require('../db');
const nodeToken = require('../services/nodeToken');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

router.post('/nodes/:id/heartbeat', (req, res) => {
  const node = db.get('nodes', req.params.id);
  if (!node || !node.daemonToken) return res.status(404).json({ error: 'Unknown node' });
  const payload = nodeToken.verifyDaemonToken(nodeToken.bearer(req), node.daemonToken);
  if (!payload || payload.nodeId !== node.id) return res.status(401).json({ error: 'Unauthorized' });
  const b = req.body || {};
  db.update('nodes', node.id, {
    status: 'online',
    lastSeen: new Date().toISOString(),
    daemonVersion: typeof b.version === 'string' ? b.version : null,
    daemonRunning: Number(b.running) || 0,
  });
  res.json({ ok: true });
});

module.exports = router;
