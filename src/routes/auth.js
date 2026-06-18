'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const settings = require('../services/settings');
const users = require('../services/users');
const { rateLimit } = require('../middleware');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 60000, max: 10, message: 'Too many login attempts — wait a minute and try again.' });
const registerLimiter = rateLimit({ windowMs: 60000, max: 5, message: 'Too many sign-up attempts — wait a minute and try again.' });

/** Public config used by the login/signup screen. */
router.get('/config', (req, res) => {
  res.json({
    brand: config.brand,
    registrationEnabled: settings.registrationEnabled(),
    requireApproval: settings.requireApproval(),
    economyEnabled: settings.economyEnabled(),
    afkEnabled: settings.economyEnabled() && settings.afkEnabled(),
  });
});

router.post('/login', loginLimiter, (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password)
    return res.status(400).json({ error: 'Username/email and password are required' });

  const needle = String(login).toLowerCase();
  const user = db.find(
    'users',
    (u) => u.username.toLowerCase() === needle || u.email.toLowerCase() === needle
  );

  if (!user || !auth.checkPassword(user, password))
    return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status === 'declined')
    return res.status(403).json({ error: 'Your account request was declined.' });

  db.log({ type: 'auth', userId: user.id, message: `${user.username} signed in` });
  res.json({ token: auth.sign(user), user: auth.publicUser(user) });
});

/** Public self-service registration (if enabled). */
router.post('/register', registerLimiter, (req, res) => {
  if (!settings.registrationEnabled())
    return res.status(403).json({ error: 'Public sign-ups are currently disabled.' });

  const { username, email, password, firstName, lastName } = req.body || {};
  const status = settings.requireApproval() ? 'pending' : 'active';
  let user;
  try {
    user = users.createUser({ username, email, password, admin: false, firstName, lastName, status });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.log({ type: 'auth', userId: user.id, message: `${user.username} registered (${status})` });
  res.status(201).json({ token: auth.sign(user), user: auth.publicUser(user), status });
});

router.get('/me', auth.authRequired, (req, res) => {
  res.json({
    user: auth.publicUser(req.user),
    brand: config.brand,
    economyEnabled: settings.economyEnabled(),
    afkEnabled: settings.economyEnabled() && settings.afkEnabled(),
  });
});

module.exports = router;
