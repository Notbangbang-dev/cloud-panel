'use strict';

/**
 * Public, ticket-authenticated downloads.
 *
 * Browsers can't attach an Authorization header when navigating to a download
 * link, so these endpoints accept a short-lived, single-purpose `?ticket=`
 * (scope "download") instead of the long-lived session token — which must
 * never appear in a URL (logs/history leakage).
 */

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const backups = require('../services/backups');
const { canAccessServer, hasPermission } = require('./helpers');

const router = express.Router();

// GET /api/dl/backups/:sid/:bid?ticket=...
router.get('/dl/backups/:sid/:bid', (req, res) => {
  const user = auth.verifyTicket(req.query.ticket, 'download');
  if (!user) return res.status(401).json({ error: 'Invalid or expired download link' });

  const server =
    db.get('servers', req.params.sid) ||
    db.find('servers', (s) => s.identifier === req.params.sid || s.uuid === req.params.sid);
  // The 'download' ticket only proves identity — it carries no server/resource
  // scope. Enforce the SAME authorization the API does: access to the server
  // AND the 'backup' permission. Without this, a subuser with any access (e.g.
  // console-only) could download backups they were never granted.
  if (!server || !canAccessServer(user, server) || !hasPermission(user, server, 'backup'))
    return res.status(403).json({ error: 'Forbidden' });

  const b = backups.get(server.id, req.params.bid);
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  res.download(backups.backupFile(server.id, b.id), `${b.name}.zip`);
});

module.exports = router;
