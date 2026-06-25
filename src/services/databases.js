'use strict';

/**
 * Per-server databases — provision real MySQL / MariaDB databases. Admins
 * register one or more database *hosts* in
 * Admin → Databases; server owners then create databases that count against
 * their server's `featureLimits.databases` quota.
 *
 * Real provisioning uses the optional `mysql2` driver. If it isn't installed
 * (or no host is configured) the API returns a clear, actionable error instead
 * of silently doing nothing.
 */

const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');

const COLL = 'databases';
const ID_RE = /^[a-zA-Z0-9_]+$/;

function driver() {
  try { return require('mysql2/promise'); }
  catch { return null; }
}

function hosts() {
  const list = (settings.get().databaseHosts || []);
  return Array.isArray(list) ? list : [];
}
const hostById = (id) => hosts().find((h) => h.id === id) || null;

/** Strip a host's admin password before sending to clients. */
function publicHost(h) {
  return { id: h.id, name: h.name, host: h.host, port: h.port, phpMyAdminUrl: h.phpMyAdminUrl || '' };
}

function serialize(row) {
  const h = hostById(row.hostId);
  return {
    id: row.id,
    database: row.database,
    username: row.username,
    password: row.password,
    remote: row.remote || '%',
    host: h ? { id: h.id, name: h.name, host: h.host, port: h.port, phpMyAdminUrl: h.phpMyAdminUrl || '' }
            : { id: row.hostId, name: '(removed host)', host: '?', port: 3306 },
    connectionString: h ? `mysql://${row.username}:${row.password}@${h.host}:${h.port}/${row.database}` : null,
    createdAt: row.createdAt,
  };
}

const list = (serverId) =>
  db.filter(COLL, (d) => d.serverId === serverId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(serialize);

const get = (id) => db.get(COLL, id);
const countForServer = (serverId) => db.filter(COLL, (d) => d.serverId === serverId).length;

function quotaFor(server) {
  const fl = server.featureLimits || {};
  return Number(fl.databases) || 0;
}

/** A short, collision-resistant suffix derived from the server id. */
function shortId(server) {
  return crypto.createHash('sha1').update(server.id).digest('hex').slice(0, 6);
}

async function withAdmin(host, fn) {
  const mysql = driver();
  if (!mysql) throw new Error('The MySQL driver is not installed on the panel. Run "npm install mysql2" to enable per-server databases.');
  let conn;
  try {
    conn = await mysql.createConnection({
      host: host.host, port: Number(host.port) || 3306,
      user: host.username, password: host.password,
      connectTimeout: 8000, multipleStatements: false,
    });
  } catch (err) {
    throw new Error(`Could not connect to database host "${host.name}": ${err.message}`);
  }
  try { return await fn(conn); }
  finally { try { await conn.end(); } catch {} }
}

/** Live connectivity check used by the admin "Test" button. */
async function testHost(host) {
  return withAdmin(host, async (conn) => {
    const [rows] = await conn.query('SELECT VERSION() AS v');
    return { ok: true, version: rows && rows[0] && rows[0].v };
  });
}

async function create(server, { hostId, name, remote } = {}) {
  const host = hostById(hostId) || hosts()[0];
  if (!host) throw new Error('No database host is configured. Ask an administrator to add one in Admin → Databases.');

  const quota = quotaFor(server);
  if (countForServer(server.id) >= quota)
    throw new Error(`Database limit reached (${quota}). Ask an administrator to raise this server's database limit.`);

  const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 16) || 'db';
  const dbName = `s${shortId(server)}_${base}`.slice(0, 48);
  const user = `u${shortId(server)}_${crypto.randomBytes(3).toString('hex')}`.slice(0, 32);
  const password = crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const allowFrom = (typeof remote === 'string' && remote.trim()) ? remote.trim().slice(0, 60) : '%';

  if (!ID_RE.test(dbName) || !ID_RE.test(user)) throw new Error('Could not generate a valid database name.');
  if (db.find(COLL, (d) => d.database === dbName)) throw new Error('A database with that name already exists — try a different name.');

  await withAdmin(host, async (conn) => {
    await conn.query(`CREATE DATABASE \`${dbName}\``);
    await conn.query(`CREATE USER ?@? IDENTIFIED BY ?`, [user, allowFrom, password]);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO ?@?`, [user, allowFrom]);
    await conn.query('FLUSH PRIVILEGES');
  });

  const row = db.insert(COLL, {
    id: db.uid('db'), serverId: server.id, hostId: host.id,
    database: dbName, username: user, password, remote: allowFrom,
    createdAt: new Date().toISOString(),
  });
  return serialize(row);
}

async function rotatePassword(id) {
  const row = db.get(COLL, id);
  if (!row) return null;
  const host = hostById(row.hostId);
  if (!host) throw new Error('The database host for this database no longer exists.');
  const password = crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  await withAdmin(host, async (conn) => {
    await conn.query(`ALTER USER ?@? IDENTIFIED BY ?`, [row.username, row.remote || '%', password]);
    await conn.query('FLUSH PRIVILEGES');
  });
  return serialize(db.update(COLL, id, { password }));
}

async function remove(id) {
  const row = db.get(COLL, id);
  if (!row) return false;
  const host = hostById(row.hostId);
  if (host) {
    try {
      await withAdmin(host, async (conn) => {
        await conn.query(`DROP DATABASE IF EXISTS \`${row.database}\``);
        await conn.query(`DROP USER IF EXISTS ?@?`, [row.username, row.remote || '%']);
        await conn.query('FLUSH PRIVILEGES');
      });
    } catch (err) {
      // If the host is unreachable we still drop our record so the slot frees up.
      db.log({ type: 'database', serverId: row.serverId, message: `Could not drop database on host: ${err.message}` });
    }
  }
  return db.remove(COLL, id);
}

async function removeAllForServer(serverId) {
  for (const d of db.filter(COLL, (x) => x.serverId === serverId)) {
    try { await remove(d.id); } catch { db.remove(COLL, d.id); }
  }
}

/* ---- admin host management ---------------------------------------------- */

function sanitizeHost(input) {
  const a = input && typeof input === 'object' ? input : {};
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const name = str(a.name, 60) || 'Database Host';
  const host = str(a.host, 200);
  if (!host) throw new Error('A host address is required.');
  const port = Math.min(65535, Math.max(1, parseInt(a.port, 10) || 3306));
  const username = str(a.username, 64) || 'root';
  return {
    id: a.id || db.uid('dbhost'),
    name, host, port, username,
    password: typeof a.password === 'string' ? a.password : (a.password == null ? '' : String(a.password)),
    phpMyAdminUrl: str(a.phpMyAdminUrl, 300),
  };
}

function addHost(input) {
  const clean = sanitizeHost(input);
  const all = hosts().concat([clean]);
  settings.update({ databaseHosts: all });
  return publicHost(clean);
}

function updateHost(id, input) {
  const all = hosts();
  const idx = all.findIndex((h) => h.id === id);
  if (idx === -1) throw new Error('Database host not found.');
  // Keep the existing password if the form left it blank.
  const merged = { ...all[idx], ...input, id };
  if (!input.password) merged.password = all[idx].password;
  all[idx] = sanitizeHost(merged);
  settings.update({ databaseHosts: all });
  return publicHost(all[idx]);
}

function removeHost(id) {
  if (db.find(COLL, (d) => d.hostId === id))
    throw new Error('This host still has databases — delete them first.');
  settings.update({ databaseHosts: hosts().filter((h) => h.id !== id) });
  return true;
}

module.exports = {
  list, get, create, rotatePassword, remove, removeAllForServer, countForServer, quotaFor,
  hosts, hostById, publicHost, addHost, updateHost, removeHost, testHost, sanitizeHost,
  driverAvailable: () => !!driver(),
};
