'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const users = require('../services/users');
const { rateLimit } = require('../middleware');

const router = express.Router();

// Prevent abuse of the one-time setup endpoint.
const setupLimiter = rateLimit({ windowMs: 60000, max: 6, message: 'Too many setup attempts — wait a minute and try again.' });

/** Whether the panel still needs its first administrator. */
router.get('/status', (req, res) => {
  res.json({
    needsSetup: db.needsSetup(),
    brand: config.brand,
    ports: { web: config.webPort, sftp: config.sftpPort },
  });
});

// Guards the check-and-create against concurrent setup POSTs (CWE-362): the flag
// is set synchronously and the needsSetup() state is re-checked under it, so
// only the first request can create the initial administrator.
let creating = false;

/** Create the first administrator. Only works while NO users exist. */
router.post('/', setupLimiter, (req, res) => {
  if (creating || !db.needsSetup())
    return res.status(403).json({ error: 'Setup has already been completed.' });

  creating = true;
  let user;
  try {
    if (!db.needsSetup()) return res.status(403).json({ error: 'Setup has already been completed.' });
    const { username, email, password, firstName, lastName } = req.body || {};
    user = users.createUser({ username, email, password, admin: true, firstName, lastName });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  } finally {
    creating = false;
  }

  db.log({ type: 'setup', userId: user.id, message: `Initial administrator "${user.username}" created via setup` });
  res.status(201).json({ token: auth.sign(user), user: auth.publicUser(user) });
});

module.exports = router;
