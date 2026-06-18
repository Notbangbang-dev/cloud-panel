'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const { rateLimit } = require('../middleware');

const router = express.Router();

// Brute-force protection: max 10 login attempts per IP per minute.
const loginLimiter = rateLimit({ windowMs: 60000, max: 10, message: 'Too many login attempts — wait a minute and try again.' });

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

  db.log({ type: 'auth', userId: user.id, message: `${user.username} signed in` });
  res.json({ token: auth.sign(user), user: auth.publicUser(user) });
});

router.get('/me', auth.authRequired, (req, res) => {
  res.json({ user: auth.publicUser(req.user), brand: config.brand });
});

module.exports = router;
