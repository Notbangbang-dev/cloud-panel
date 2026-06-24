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
  const root = files.rootFor(server);

  // Refresh the quota baseline accurately (off the event loop), then size budget.
  await files.diskUsageAsync(server);
  const budget = Math.min(files.remainingBytes(server), 8 * 1024 * 1024 * 1024); // quota + anti zip-bomb

  // ---- Pass 1: VALIDATE every entry — NO writes -----------------------------
  // Resolve each target (zip-slip safe), bound the file count, and reject up
  // front if the DECLARED uncompressed total already exceeds the budget. `safeRel`
  // is derived from the RESOLVED path (not the raw entry name) so it can't escape
  // the staging dir either.
  const plan = [];
  let declaredTotal = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    let finalPath;
    try { finalPath = files.resolve(server, '/' + entry.entryName); } catch { continue; } // skip zip-slip entries
    const safeRel = path.relative(root, finalPath);
    if (!safeRel || safeRel === '.') continue;
    declaredTotal += (entry.header && entry.header.size) || 0;
    if (declaredTotal > budget) {
      throw Object.assign(new Error('Backup contents exceed the disk quota for this server'), { code: 'EDQUOT' });
    }
    if (plan.length >= 20000) throw new Error('Backup contains too many files');
    plan.push({ entry, finalPath, safeRel });
  }

  // ---- Pass 2: extract to a STAGING dir, validate ACTUAL sizes, then commit --
  // Inflate every entry into a staging dir on the SAME filesystem, bounding the
  // REAL (inflated) total as we go. The live volume is not touched until the
  // whole archive is staged and within budget — so a crafted zip that lies about
  // its header sizes, or an inflation/IO error, can no longer half-overwrite real
  // files (the old in-place loop could). Commit is then a fast same-fs rename per
  // file; the staging dir is always cleaned up in `finally`.
  const stageDir = path.join(config.volumesDir, `.restore-${server.id}-${db.uid('rst')}`);
  let restored = 0;
  let written = 0;
  try {
    await fsp.mkdir(stageDir, { recursive: true });
    for (const item of plan) {
      const data = item.entry.getData();
      written += data.length;
      if (written > budget) { // a lying header is caught HERE — before any live write
        throw Object.assign(new Error('Backup contents exceed the disk quota for this server'), { code: 'EDQUOT' });
      }
      item.stagePath = path.join(stageDir, item.safeRel);
      await fsp.mkdir(path.dirname(item.stagePath), { recursive: true });
      await fsp.writeFile(item.stagePath, data);
    }
    // Commit: everything is validated and on disk — move it onto the live volume.
    for (const item of plan) {
      await fsp.mkdir(path.dirname(item.finalPath), { recursive: true });
      await fsp.rename(item.stagePath, item.finalPath);
      isolation.chown(item.finalPath);
      restored++;
    }
  } finally {
    try { await fsp.rm(stageDir, { recursive: true, force: true }); } catch {}
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
