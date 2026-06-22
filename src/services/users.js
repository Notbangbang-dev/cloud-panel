'use strict';

/** Shared user creation/validation used by the setup wizard, admin API and CLI. */

const db = require('../db');
const auth = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const PW_MIN = 8;
// bcrypt only considers the first 72 BYTES of the password and silently ignores
// the rest. Reject longer inputs so users aren't given a false sense of strength
// (and so two passwords sharing a 72-byte prefix aren't treated as identical).
const PW_MAX_BYTES = 72;

/** Validate a password (shared by signup, setup, admin edit and self-service change). */
function validatePassword(password) {
  const pw = String(password == null ? '' : password);
  if (pw.length < PW_MIN) throw new Error(`password must be at least ${PW_MIN} characters`);
  if (Buffer.byteLength(pw, 'utf8') > PW_MAX_BYTES)
    throw new Error(`password must be at most ${PW_MAX_BYTES} bytes`);
  return pw;
}

function validate({ username, email, password }) {
  if (!username || !email || !password) throw new Error('username, email and password are required');
  if (!USERNAME_RE.test(username)) throw new Error('username must be 3-32 chars (letters, numbers, . _ -)');
  if (!EMAIL_RE.test(email)) throw new Error('a valid email address is required');
  validatePassword(password);
}

function createUser({ username, email, password, admin = false, firstName = '', lastName = '', status, coins, resources }) {
  validate({ username, email, password });
  if (db.find('users', (u) => u.username.toLowerCase() === username.toLowerCase()))
    throw new Error(`username "${username}" is already taken`);
  if (db.find('users', (u) => u.email.toLowerCase() === email.toLowerCase()))
    throw new Error(`email "${email}" is already in use`);

  const d = db.settings().defaults;
  return db.insert('users', {
    id: db.uid('user'),
    uuid: db.uuid(),
    username,
    email,
    firstName: firstName || '',
    lastName: lastName || '',
    password: auth.hashPassword(password),
    admin: !!admin,
    twoFactor: false,
    // ---- economy / access ----
    status: status || 'active',
    coins: coins != null ? coins : d.coins,
    resources: resources || { memory: d.memory, cpu: d.cpu, disk: d.disk, servers: d.servers, backups: d.backups, databases: d.databases },
    createdAt: new Date().toISOString(),
  });
}

const countUsers = () => db.all('users').length;
const countAdmins = () => db.filter('users', (u) => u.admin).length;

module.exports = { createUser, validate, validatePassword, countUsers, countAdmins, EMAIL_RE, USERNAME_RE };
