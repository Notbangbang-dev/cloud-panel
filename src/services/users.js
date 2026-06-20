'use strict';

/** Shared user creation/validation used by the setup wizard, admin API and CLI. */

const db = require('../db');
const auth = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function validate({ username, email, password }) {
  if (!username || !email || !password) throw new Error('username, email and password are required');
  if (!USERNAME_RE.test(username)) throw new Error('username must be 3-32 chars (letters, numbers, . _ -)');
  if (!EMAIL_RE.test(email)) throw new Error('a valid email address is required');
  if (String(password).length < 8) throw new Error('password must be at least 8 characters');
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

module.exports = { createUser, validate, countUsers, countAdmins, EMAIL_RE, USERNAME_RE };
