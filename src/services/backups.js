'use strict';

/** Per-server backups: zip snapshots of a server's volume, with metadata in DB. */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');
const db = require('../db');
const files = require('./files');

function backupDir(serverId) {
  const dir = path.join(config.backupsDir, serverId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function backupFile(serverId, backupId) {
  return path.join(backupDir(serverId), backupId + '.zip');
}

function loadZip() {
  try { return require('adm-zip'); }
  catch { throw new Error('Backups need the adm-zip package — run "npm install".'); }
}

function list(serverId) {
  return db
    .filter('backups', (b) => b.serverId === serverId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(serverId, backupId) {
  const b = db.get('backups', backupId);
  return b && b.serverId === serverId ? b : null;
}

function create(server, { name, createdBy } = {}) {
  const AdmZip = loadZip();
  const root = files.rootFor(server);
  const id = db.uid('bak');
  const dest = backupFile(server.id, id);
  const zip = new AdmZip();
  try { zip.addLocalFolder(root); } catch { /* empty volume is fine */ }
  zip.writeZip(dest);
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(dest).size; } catch {}
  return db.insert('backups', {
    id,
    serverId: server.id,
    name: (name && String(name).trim()) || `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
    sizeBytes,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
  });
}

async function restore(server, backupId) {
  const AdmZip = loadZip();
  const b = get(server.id, backupId);
  if (!b) throw new Error('Backup not found');
  const src = backupFile(server.id, backupId);
  if (!fs.existsSync(src)) throw new Error('Backup file is missing on disk');
  const zip = new AdmZip(src);
  let restored = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    let target;
    try { target = files.resolve(server, '/' + entry.entryName); } catch { continue; } // zip-slip safe
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
    restored++;
  }
  return { restored };
}

async function remove(serverId, backupId) {
  const b = get(serverId, backupId);
  if (!b) return false;
  try { await fsp.rm(backupFile(serverId, backupId), { force: true }); } catch {}
  db.remove('backups', backupId);
  return true;
}

async function removeAllForServer(serverId) {
  for (const b of db.filter('backups', (x) => x.serverId === serverId)) db.remove('backups', b.id);
  try { await fsp.rm(backupDir(serverId), { recursive: true, force: true }); } catch {}
}

module.exports = { list, get, create, restore, remove, removeAllForServer, backupFile };
