'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');

function sign(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, admin: !!user.admin, tv: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * A short-lived session token for an admin to "view as" another user. It's a
 * normal session for the target (so the panel behaves exactly as they see it)
 * but carries an `imp` claim recording which admin issued it, for auditing.
 */
function signImpersonation(targetUser, adminId) {
  return jwt.sign(
    { sub: targetUser.id, username: targetUser.username, admin: !!targetUser.admin, tv: targetUser.tokenVersion || 0, imp: adminId },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

/**
 * Short-lived, single-purpose token for things that must carry auth in a URL
 * (WebSocket upgrade, file downloads) where an Authorization header isn't
 * possible. Scoped + short TTL so a leaked URL can't be replayed as a session.
 */
function signTicket(user, scope, ttlSeconds = 120) {
  return jwt.sign({ sub: user.id, scope, tv: user.tokenVersion || 0 }, config.jwtSecret, {
    expiresIn: ttlSeconds,
  });
}

/** Verify a ticket of an exact scope and return the live user (or null). */
function verifyTicket(token, scope) {
  const p = token && verifyToken(token);
  if (!p || p.scope !== scope) return null;
  const user = db.get('users', p.sub);
  if (!user || (user.tokenVersion || 0) !== (p.tv || 0)) return null;
  return user;
}

/** Signed, short-lived CSRF state for the OAuth redirect flow. */
function signState(payload = {}, ttlSeconds = 600) {
  return jwt.sign({ ...payload, kind: 'oauth-state' }, config.jwtSecret, { expiresIn: ttlSeconds });
}
function verifyState(token) {
  const p = token && verifyToken(token);
  return p && p.kind === 'oauth-state' ? p : null;
}

function publicUser(user) {
  if (!user) return null;
  // Never expose the password hash, raw TOTP secret/recovery codes, or the
  // internal Stripe customer/subscription ids.
  const { password, totp, stripeCustomerId, stripeSubId, ...rest } = user;
  rest.twoFactorEnabled = !!((totp && totp.enabled) || user.twoFactor);
  return rest;
}

// A fixed bcrypt hash compared against when the user (or their hash) is missing,
// so the "no such user" path costs ~the same as a real comparison and login
// timing can't be used to enumerate usernames (CWE-208).
const DUMMY_HASH = bcrypt.hashSync('cloud-panel::nonexistent-account', config.bcryptRounds);

function checkPassword(user, plain) {
  const hash = (user && typeof user.password === 'string' && user.password) || DUMMY_HASH;
  // Always run bcrypt (even for unknown users) to keep timing uniform.
  const ok = bcrypt.compareSync(String(plain == null ? '' : plain), hash);
  return !!user && ok;
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, config.bcryptRounds);
}

function tokenFromReq(req) {
  // Session tokens are accepted ONLY via the Authorization header — never the
  // query string (which leaks into logs/history). URL-borne auth uses scoped
  // tickets at dedicated endpoints (WebSocket, downloads) instead.
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Express middleware: requires a valid session JWT and loads req.user. */
function authRequired(req, res, next) {
  const token = tokenFromReq(req);
  const payload = token && verifyToken(token);
  // Reject scoped tickets here — they're only valid at their dedicated routes.
  if (!payload || payload.scope) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.get('users', payload.sub);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if ((user.tokenVersion || 0) !== (payload.tv || 0))
    return res.status(401).json({ error: 'Session expired — please sign in again.' });
  req.user = user;
  next();
}

/** Express middleware: requires an admin user. */
function adminRequired(req, res, next) {
  if (!req.user || !req.user.admin)
    return res.status(403).json({ error: 'Administrator access required' });
  next();
}

module.exports = {
  sign,
  signImpersonation,
  signTicket,
  signState,
  verifyState,
  verifyToken,
  verifyTicket,
  publicUser,
  checkPassword,
  hashPassword,
  tokenFromReq,
  authRequired,
  adminRequired,
};
