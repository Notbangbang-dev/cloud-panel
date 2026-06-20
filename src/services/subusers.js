'use strict';

/**
 * Subusers — share a single server with other Cloud Panel accounts, each with
 * a granular set of permissions (console, files, power, backups, …). The owner
 * (and admins) always hold every permission; subusers hold only what's granted.
 */

const db = require('../db');
const { PERMISSIONS } = require('../routes/helpers');

const COLL = 'subusers';

function sanitizePermissions(input) {
  const arr = Array.isArray(input) ? input : [];
  const set = new Set(arr.filter((p) => PERMISSIONS.includes(p)));
  // Sending commands implies being able to see the console.
  if (set.has('control.command')) set.add('control.console');
  return [...set];
}

function publicUserFor(userId) {
  const u = db.get('users', userId);
  if (!u) return null;
  return { id: u.id, username: u.username, email: u.email };
}

function serialize(row) {
  return {
    id: row.id,
    user: publicUserFor(row.userId) || { id: row.userId, username: '(deleted user)', email: '' },
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    createdAt: row.createdAt,
  };
}

const list = (serverId) =>
  db.filter(COLL, (s) => s.serverId === serverId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(serialize);

const get = (id) => db.get(COLL, id);

/** Resolve an account by email or username (case-insensitive). */
function findAccount(identifier) {
  const needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return null;
  return db.find('users', (u) => u.email.toLowerCase() === needle || u.username.toLowerCase() === needle) || null;
}

function create(server, { identifier, permissions, invitedBy } = {}) {
  const target = findAccount(identifier);
  if (!target) throw new Error('No Cloud Panel account matches that email or username.');
  if (target.id === server.ownerId) throw new Error('That user already owns this server.');
  if (target.admin) throw new Error('Administrators already have full access to every server.');
  if (db.find(COLL, (s) => s.serverId === server.id && s.userId === target.id))
    throw new Error('That user is already a subuser on this server.');

  const perms = sanitizePermissions(permissions);
  if (!perms.length) throw new Error('Grant at least one permission.');

  const row = db.insert(COLL, {
    id: db.uid('sub'),
    serverId: server.id,
    userId: target.id,
    permissions: perms,
    invitedBy: invitedBy || null,
    createdAt: new Date().toISOString(),
  });
  return serialize(row);
}

function update(id, { permissions } = {}) {
  const cur = db.get(COLL, id);
  if (!cur) return null;
  const perms = sanitizePermissions(permissions);
  if (!perms.length) throw new Error('Grant at least one permission.');
  return serialize(db.update(COLL, id, { permissions: perms }));
}

function remove(id) {
  return db.remove(COLL, id);
}

/** Remove every subuser row for a server (called when a server is deleted). */
function removeAllForServer(serverId) {
  for (const s of db.filter(COLL, (x) => x.serverId === serverId)) db.remove(COLL, s.id);
}

module.exports = { list, get, create, update, remove, removeAllForServer, sanitizePermissions, PERMISSIONS };
