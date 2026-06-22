'use strict';

/**
 * Optional server-process isolation.
 *
 * By default the panel spawns game servers as its own OS user — which means a
 * server (running user-supplied code) can read the panel's database, secrets
 * and other servers' files (audit finding C1).
 *
 * When `CP_SERVER_UID`/`CP_SERVER_GID` are configured AND the panel runs as
 * root, we instead spawn each server with those credentials (dropped
 * privileges) and chown server volumes to that user, while locking the panel's
 * own data/secrets to root. The server user then cannot read panel internals.
 *
 * NOTE: this uses a single shared "server" user, so it isolates servers from
 * the PANEL (the C1 worst case: stealing the JWT secret / DB). Servers are not
 * isolated from EACH OTHER by a shared user — for that, use per-server users or
 * containers.
 *
 * Everything here is a no-op unless explicitly configured + running as root, so
 * the default deployment is unchanged.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const POSIX = process.platform !== 'win32';
const CONFIGURED = POSIX && Number.isInteger(config.serverUid) && Number.isInteger(config.serverGid);
const IS_ROOT = POSIX && typeof process.getuid === 'function' && process.getuid() === 0;

/** True when isolation is configured AND we can actually drop privileges. */
function active() {
  return CONFIGURED && IS_ROOT;
}

/** Spawn options to drop a child to the server user (empty when inactive). */
function spawnCreds() {
  return active() ? { uid: config.serverUid, gid: config.serverGid } : {};
}

/** Best-effort chown a single path to the server user. */
function chown(p) {
  if (!active()) return;
  try { fs.chownSync(p, config.serverUid, config.serverGid); } catch { /* best-effort */ }
}

/** Best-effort recursive chown (used to hand a whole volume to the server user). */
function chownTree(dir) {
  if (!active()) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  chown(dir);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) chownTree(full);
    else chown(full);
  }
}

/** The panel's most sensitive files (admin-token secret, DB, host key, .env). */
function secretFiles() {
  return [
    config.sqliteFile,
    config.dbFile,
    config.hostKeyFile,
    path.join(config.dataDir, '.jwt-secret'),
    path.join(config.root, '.env'),
  ];
}

/** Best-effort: restrict panel secrets to the owner (0600). Runs even when full
 *  per-user isolation is inactive, so at least OTHER OS users can't read them. */
function lockSecrets() {
  if (!POSIX) return;
  for (const f of secretFiles()) {
    try { fs.chmodSync(f, 0o600); } catch { /* best-effort */ }
  }
}

/** Loud warning when the panel can run untrusted code without isolation (C1). */
function warnUnisolated() {
  let registrationOpen = false;
  try {
    const db = require('../db');
    const s = db.settings();
    registrationOpen = !!(s && s.registration && s.registration.enabled);
  } catch { /* settings unavailable — warn generically */ }
  console.warn(
    '[isolation] ******************************************************************\n' +
    '[isolation] WARNING: server sandboxing is INACTIVE — game/app servers run as ' +
    'the panel user and (with code-running eggs: Node/Python/.jar) can execute ' +
    'arbitrary code, reading the panel DB / JWT secret and other servers\u2019 files (C1). ' +
    (registrationOpen
      ? 'Public registration is ENABLED, so this is reachable by anyone who signs up. '
      : 'Only allow users you trust until this is fixed. ') +
    'Strongly recommended: enable the OCI container sandbox (CP_OCI=1 with ' +
    'Docker/Podman), or per-server-user isolation (CP_SERVER_UID/GID as root). ' +
    'See SECURITY.md (C1).\n' +
    '[isolation] ******************************************************************'
  );
}

/** Boot-time: warn if requested-but-inactive, and lock panel internals to root. */
function init() {
  // Always best-effort lock the panel's secrets so other OS users can't read
  // them, regardless of whether per-user isolation is configured.
  lockSecrets();

  // If the OCI container sandbox is active, every server already runs isolated
  // in its own container — per-server-user isolation is redundant and the C1
  // warning would be misleading, so acknowledge that and stop here.
  let ociActive = false;
  try { ociActive = require('./oci').active(); } catch { /* oci optional */ }
  if (ociActive) {
    console.log('[isolation] server sandboxing provided by the OCI container runtime (CP_OCI).');
    return;
  }

  if (!CONFIGURED) {
    warnUnisolated();
    return;
  }
  if (!IS_ROOT) {
    console.warn(
      '[isolation] CP_SERVER_UID/GID are set but the panel is NOT running as root — ' +
      'server isolation is INACTIVE (servers still run as the panel user). ' +
      'Run the panel as root to enable it. See SECURITY.md.'
    );
    warnUnisolated();
    return;
  }
  // Server user may TRAVERSE data/ + volumes/ (to reach its own volume) but the
  // sensitive files are locked to root, and backups are fully closed off.
  try { fs.chmodSync(config.dataDir, 0o711); } catch {}
  try { fs.chmodSync(config.volumesDir, 0o711); } catch {}
  try { fs.chmodSync(config.backupsDir, 0o700); } catch {}
  for (const f of [
    config.sqliteFile,
    config.dbFile,
    config.hostKeyFile,
    path.join(config.dataDir, '.jwt-secret'),
    path.join(config.root, '.env'),
  ]) {
    try { fs.chmodSync(f, 0o600); } catch {}
  }
  console.log(`[isolation] active — servers run as uid:${config.serverUid} gid:${config.serverGid}`);
}

module.exports = { active, spawnCreds, chown, chownTree, init };
