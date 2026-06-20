'use strict';

const express = require('express');
const crypto = require('crypto');
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
    discordEnabled: settings.discordReady(),
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

  // If the account has 2FA enabled, the password is only step one — issue a
  // short-lived, single-purpose ticket and ask for the authenticator code.
  if (user.totp && user.totp.enabled) {
    return res.json({ twoFactorRequired: true, ticket: auth.signTicket(user, '2fa', 300) });
  }

  db.log({ type: 'auth', userId: user.id, message: `${user.username} signed in` });
  res.json({ token: auth.sign(user), user: auth.publicUser(user) });
});

/** Second factor: exchange a 2FA ticket + TOTP code (or recovery code) for a session. */
const twoFaLimiter = rateLimit({ windowMs: 60000, max: 10, message: 'Too many codes — wait a minute and try again.' });
router.post('/2fa', twoFaLimiter, (req, res) => {
  const { ticket, token } = req.body || {};
  const user = ticket && auth.verifyTicket(ticket, '2fa');
  if (!user) return res.status(401).json({ error: 'Your sign-in request expired — please log in again.' });
  if (!user.totp || !user.totp.enabled) return res.status(400).json({ error: 'Two-factor is not enabled on this account.' });

  const totp = require('../services/totp');
  const code = String(token || '');
  let ok = totp.verify(user.totp.secret, code);
  if (!ok) {
    // Allow a one-time recovery code (consumed on use).
    const hash = totp.hashCode(code);
    const remaining = (user.totp.backupCodes || []).filter((h) => h !== hash);
    if (remaining.length !== (user.totp.backupCodes || []).length) {
      ok = true;
      db.update('users', user.id, { totp: { ...user.totp, backupCodes: remaining } });
      db.log({ type: 'auth', userId: user.id, message: 'Signed in with a 2FA recovery code' });
    }
  }
  if (!ok) return res.status(401).json({ error: 'Invalid authentication code.' });

  const fresh = db.get('users', user.id);
  db.log({ type: 'auth', userId: user.id, message: `${user.username} signed in (2FA)` });
  res.json({ token: auth.sign(fresh), user: auth.publicUser(fresh) });
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

// ---- Discord OAuth2 login -------------------------------------------------
// The operator configures their own Discord app (client id/secret/redirect) in
// Admin → Login. The session token is delivered back to the SPA in the URL
// hash (#login_token=…), which — unlike the query string — isn't sent to
// servers or logged.

const oauthLimiter = rateLimit({ windowMs: 60000, max: 20, message: 'Too many login attempts — wait a minute and try again.' });
const backToApp = (res, hash) => res.redirect('/#' + hash);

router.get('/discord/login', oauthLimiter, (req, res) => {
  if (!settings.discordReady()) return backToApp(res, 'login_error=' + encodeURIComponent('Discord login is not configured.'));
  const d = settings.discord();
  const params = new URLSearchParams({
    client_id: d.clientId,
    redirect_uri: d.redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state: auth.signState({ n: crypto.randomBytes(8).toString('hex') }),
    prompt: 'consent',
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
});

router.get('/discord/callback', oauthLimiter, async (req, res) => {
  const fail = (msg) => backToApp(res, 'login_error=' + encodeURIComponent(msg));
  if (!settings.discordReady()) return fail('Discord login is not configured.');
  const { code, state } = req.query;
  if (!code || !auth.verifyState(state)) return fail('Login failed (invalid or expired request). Please try again.');
  const d = settings.discord();
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: d.clientId,
        client_secret: d.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: d.redirectUri,
      }),
    });
    if (!tokenRes.ok) return fail('Discord rejected the login.');
    const tok = await tokenRes.json();
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!meRes.ok) return fail('Could not read your Discord profile.');
    const du = await meRes.json();
    if (!du || !du.id) return fail('Discord did not return a valid profile.');

    const user = resolveDiscordUser(du, d);
    if (!user) return fail('No account is linked to that Discord, and sign-ups via Discord are disabled.');
    if (user.status === 'declined') return fail('Your account request was declined.');

    db.log({ type: 'auth', userId: user.id, message: `${user.username} signed in via Discord` });
    return backToApp(res, 'login_token=' + encodeURIComponent(auth.sign(user)));
  } catch (err) {
    return fail('Discord login failed. Please try again.');
  }
});

function sanitizeUsername(name) {
  let s = String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32);
  if (s.length < 3) s = ('user' + s).slice(0, 32);
  return s;
}

/** Find an existing linked/email-matched user, or create one (if allowed). */
function resolveDiscordUser(du, d) {
  // 1) Already linked by Discord ID.
  let user = db.find('users', (u) => u.discordId && u.discordId === du.id);
  if (user) return user;
  // 2) Link to an existing account ONLY on a *verified* email match (prevents
  //    takeover via an unverified Discord email).
  if (du.email && du.verified) {
    user = db.find('users', (u) => u.email && u.email.toLowerCase() === String(du.email).toLowerCase());
    if (user) return db.update('users', user.id, { discordId: du.id });
  }
  // 3) Create a new account if the operator allows it.
  if (!d.createAccounts) return null;
  const base = sanitizeUsername(du.username || du.global_name || ('discord' + du.id));
  let username = base;
  for (let i = 1; db.find('users', (u) => u.username.toLowerCase() === username.toLowerCase()); i++) {
    username = (base + i).slice(0, 32);
  }
  const password = crypto.randomBytes(24).toString('hex'); // they log in via Discord
  const status = settings.requireApproval() ? 'pending' : 'active';
  const placeholder = `discord_${du.id}@discord.local`;
  const email = du.email && du.verified ? du.email : placeholder;
  let created;
  try { created = users.createUser({ username, email, password, admin: false, status }); }
  catch { created = users.createUser({ username, email: placeholder, password, admin: false, status }); }
  return db.update('users', created.id, { discordId: du.id });
}

router.get('/me', auth.authRequired, (req, res) => {
  res.json({
    user: auth.publicUser(req.user),
    brand: config.brand,
    economyEnabled: settings.economyEnabled(),
    afkEnabled: settings.economyEnabled() && settings.afkEnabled(),
  });
});

module.exports = router;
