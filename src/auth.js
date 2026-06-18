'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');

function sign(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, admin: !!user.admin },
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

function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

function checkPassword(user, plain) {
  if (!user) return false;
  return bcrypt.compareSync(plain, user.password);
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, config.bcryptRounds);
}

function tokenFromReq(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

/** Express middleware: requires a valid JWT and loads req.user. */
function authRequired(req, res, next) {
  const token = tokenFromReq(req);
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.get('users', payload.sub);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
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
  verifyToken,
  publicUser,
  checkPassword,
  hashPassword,
  tokenFromReq,
  authRequired,
  adminRequired,
};
