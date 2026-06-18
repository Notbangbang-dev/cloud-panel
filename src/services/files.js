'use strict';

/**
 * Safe per-server file operations. All paths are confined to the server's
 * volume directory; traversal attempts (../) are rejected.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');

function rootFor(server) {
  const dir = path.join(config.volumesDir, server.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- Real disk usage (recursive size), cached with a short TTL ----------
const _diskCache = new Map(); // serverId -> { at, bytes }
const DISK_TTL = 15000;

function dirSize(dir, budget) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (budget.stop) break;
    const full = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += dirSize(full, budget);
      else if (e.isFile()) total += fs.statSync(full).size;
    } catch {
      /* skip unreadable entries */
    }
    budget.count++;
    if (budget.count > 50000 || Date.now() - budget.start > 1500) budget.stop = true;
  }
  return total;
}

/** Returns real disk usage in bytes for a server's volume (cached). */
function diskUsage(server) {
  const id = server.id;
  const cached = _diskCache.get(id);
  if (cached && Date.now() - cached.at < DISK_TTL) return cached.bytes;
  const bytes = dirSize(rootFor(server), { count: 0, start: Date.now(), stop: false });
  _diskCache.set(id, { at: Date.now(), bytes });
  return bytes;
}

/** Resolve a client path safely within the server root. Returns absolute path. */
function resolve(server, rel) {
  const root = rootFor(server);
  const clean = path.normalize(rel || '/').replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.resolve(root, '.' + path.sep + clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Path escapes server root'), { code: 'EACCES' });
  }
  return abs;
}

function toRel(server, abs) {
  const root = rootFor(server);
  const rel = abs.slice(root.length).split(path.sep).join('/');
  return rel.startsWith('/') ? rel : '/' + rel;
}

async function list(server, rel) {
  const abs = resolve(server, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(abs, e.name);
    let stat;
    try {
      stat = await fsp.stat(full);
    } catch {
      continue;
    }
    out.push({
      name: e.name,
      directory: e.isDirectory(),
      file: e.isFile(),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      mode: '0' + (stat.mode & 0o777).toString(8),
      mime: e.isDirectory() ? 'inode/directory' : guessMime(e.name),
    });
  }
  out.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

async function read(server, rel) {
  const abs = resolve(server, rel);
  const stat = await fsp.stat(abs);
  if (stat.isDirectory()) throw new Error('Cannot read a directory');
  if (stat.size > 5 * 1024 * 1024) throw new Error('File too large to edit (>5MB)');
  return fsp.readFile(abs, 'utf8');
}

async function write(server, rel, content) {
  const abs = resolve(server, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content ?? '', 'utf8');
  return toRel(server, abs);
}

async function mkdir(server, rel) {
  const abs = resolve(server, rel);
  await fsp.mkdir(abs, { recursive: true });
  return toRel(server, abs);
}

async function rename(server, from, to) {
  const a = resolve(server, from);
  const b = resolve(server, to);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  return toRel(server, b);
}

async function remove(server, rel) {
  const abs = resolve(server, rel);
  await fsp.rm(abs, { recursive: true, force: true });
  return true;
}

function guessMime(name) {
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.properties': 'text/plain',
    '.cfg': 'text/plain',
    '.conf': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.css': 'text/css',
    '.sh': 'application/x-sh',
    '.jar': 'application/java-archive',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = { rootFor, resolve, toRel, list, read, write, mkdir, rename, remove, diskUsage };
