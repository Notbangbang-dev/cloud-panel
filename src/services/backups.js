'use strict';

/** Per-server backups: zip snapshots of a server's volume, with metadata in DB. */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Worker } = require('worker_threads');
const config = require('../config');
const db = require('../db');
const files = require('./files');
const isolation = require('./isolation');

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

// Zip the volume in a WORKER THREAD so a multi-GB backup never blocks the panel's
// single event loop — consoles, HTTP and SFTP keep responding while it runs.
// Only an absent/empty volume is acceptable; a real read error fails the backup
// loudly rather than silently writing an empty zip the user would trust.
function zipFolderInWorker(root, dest) {
  return new Promise((resolve, reject) => {
    const code = `
      const { parentPort, workerData } = require('worker_threads');
      const fs = require('fs');
      (function () {
        let AdmZip;
        try { AdmZip = require('adm-zip'); } catch { return parentPort.postMessage({ ok:false, error:'adm-zip not installed' }); }
        try {
          const zip = new AdmZip();
          if (fs.existsSync(workerData.root)) {
            try { zip.addLocalFolder(workerData.root); }
            catch (e) { return parentPort.postMessage({ ok:false, error:'read:' + e.message }); }
          }
          zip.writeZip(workerData.dest);
          let size = 0; try { size = fs.statSync(workerData.dest).size; } catch {}
          parentPort.postMessage({ ok:true, size });
        } catch (e) { parentPort.postMessage({ ok:false, error:e.message }); }
      })();
    `;
    const w = new Worker(code, { eval: true, workerData: { root, dest } });
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; w.terminate(); fn(v); } };
    w.on('message', (m) => {
      if (m.ok) return done(resolve, m.size);
      const msg = (m.error || '').startsWith('read:')
        ? 'Backup failed while reading server files: ' + m.error.slice(5)
        : (m.error || 'Backup failed');
      done(reject, new Error(msg));
    });
    w.on('error', (e) => done(reject, e));
    w.on('exit', (c) => { if (!settled) done(reject, new Error('Backup worker exited unexpectedly (' + c + ')')); });
  });
}

async function create(server, { name, createdBy } = {}) {
  loadZip(); // surface a clear error if adm-zip is missing before spawning the worker
  const root = files.rootFor(server);
  const id = db.uid('bak');
  const dest = backupFile(server.id, id);
  const sizeBytes = await zipFolderInWorker(root, dest);
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

  // Refresh the quota baseline accurately (off the event loop), then size budget.
  await files.diskUsageAsync(server);
  const budget = Math.min(files.remainingBytes(server), 8 * 1024 * 1024 * 1024); // quota + anti zip-bomb

  // ---- Pass 1: VALIDATE the whole archive before touching the live volume ----
  // Resolve every target (zip-slip safe), bound the file count, and reject up
  // front if the DECLARED uncompressed total exceeds the budget. This is the fix
  // for the half-overwrite bug: previously the quota check ran mid-write, so a
  // backup that exceeded quota would leave the volume partially overwritten with
  // no rollback. Now a quota failure aborts before a single byte is written.
  const plan = [];
  let declaredTotal = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    let target;
    try { target = files.resolve(server, '/' + entry.entryName); } catch { continue; } // skip zip-slip entries
    declaredTotal += (entry.header && entry.header.size) || 0;
    if (declaredTotal > budget) {
      throw Object.assign(new Error('Backup contents exceed the disk quota for this server'), { code: 'EDQUOT' });
    }
    if (plan.length >= 20000) throw new Error('Backup contains too many files');
    plan.push({ entry, target });
  }

  // ---- Pass 2: write the validated set --------------------------------------
  let restored = 0;
  let written = 0;
  try {
    for (const { entry, target } of plan) {
      const data = entry.getData();
      written += data.length;
      // Defensive: the archive header could under-report sizes (a crafted zip).
      // Still bound the actual inflated total so a lying backup can't blow quota.
      if (written > budget) {
        throw Object.assign(new Error('Backup contents exceed the disk quota for this server'), { code: 'EDQUOT' });
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, data);
      isolation.chown(target);
      restored++;
    }
  } finally {
    files.invalidateDisk(server.id);
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
