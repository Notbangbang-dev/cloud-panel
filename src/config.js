'use strict';

/**
 * Cloud Panel configuration.
 *
 * Default service ports follow PufferPanel conventions (NOT Pterodactyl):
 *   - Web / API : 8080   (PufferPanel default web port)
 *   - SFTP       : 5657   (PufferPanel default SFTP port)
 *
 * Pterodactyl by comparison uses 80/443 for the panel and 2022 for SFTP — we
 * deliberately do not use those.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// ---- Minimal .env loader (no dependency) --------------------------------
(function loadEnv() {
  const envPath = process.env.CP_ENV_FILE || path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore malformed .env */
  }
})();

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const DATA_DIR = process.env.CP_DATA_DIR || path.join(ROOT, 'data');

/**
 * JWT secret resolution — NO hard-coded fallback.
 * Uses CP_JWT_SECRET if provided; otherwise generates a strong random secret
 * once and persists it to data/.jwt-secret so tokens survive restarts.
 */
function resolveJwtSecret() {
  if (process.env.CP_JWT_SECRET) return process.env.CP_JWT_SECRET;
  const crypto = require('crypto');
  const file = path.join(DATA_DIR, '.jwt-secret');
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    console.log('[config] generated a persistent JWT secret -> data/.jwt-secret');
    return secret;
  } catch {
    return crypto.randomBytes(48).toString('hex'); // ephemeral last resort
  }
}

const config = {
  root: ROOT,

  // ---- Network (PufferPanel ports) ----------------------------------------
  host: process.env.CP_HOST || '0.0.0.0',
  webPort: int(process.env.CP_WEB_PORT, 8080), // PufferPanel web port
  sftpPort: int(process.env.CP_SFTP_PORT, 5657), // PufferPanel SFTP port

  // The domain or IP people use to reach the panel. Shown for SFTP/allocation
  // hints, and used as the canonical address. Examples:
  //   CP_PUBLIC_HOST=panel.yourdomain.com   or   CP_PUBLIC_HOST=203.0.113.10
  publicHost: process.env.CP_PUBLIC_HOST || '127.0.0.1',

  // Trust X-Forwarded-* headers (so the panel works correctly behind a reverse
  // proxy / Cloudflare Tunnel and reports https + the real client IP). Set
  // CP_TRUST_PROXY=0 to disable.
  trustProxy: process.env.CP_TRUST_PROXY !== '0',

  // ---- Security -----------------------------------------------------------
  // No hard-coded secret: CP_JWT_SECRET if set, else auto-generated & persisted.
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.CP_JWT_TTL || '7d',
  bcryptRounds: int(process.env.CP_BCRYPT_ROUNDS, 10),

  // ---- Storage ------------------------------------------------------------
  dataDir: DATA_DIR,
  // Real database (SQLite). Falls back to the JSON file if better-sqlite3
  // cannot be loaded on this platform.
  sqliteFile: process.env.CP_SQLITE_FILE || path.join(DATA_DIR, 'cloud-panel.db'),
  dbFile: process.env.CP_DB_FILE || path.join(DATA_DIR, 'cloud-panel.json'),
  forceJsonStore: process.env.CP_FORCE_JSON === '1',
  // Per-server file storage lives here: <volumesDir>/<serverId>
  volumesDir: process.env.CP_VOLUMES_DIR || path.join(DATA_DIR, 'volumes'),
  // Per-server backups (zip snapshots): <backupsDir>/<serverId>/<backupId>.zip
  backupsDir: process.env.CP_BACKUPS_DIR || path.join(DATA_DIR, 'backups'),
  hostKeyFile:
    process.env.CP_SFTP_HOSTKEY || path.join(DATA_DIR, 'sftp_host.key'),

  // ---- Branding -----------------------------------------------------------
  brand: {
    name: 'Cloud Panel',
    tagline: 'Deploy. Scale. Dominate.',
  },

  // ---- Default allocation port range for game servers ---------------------
  // (These are the ports handed to game servers, mirroring how PufferPanel /
  //  Pterodactyl manage allocations — separate from the panel's own ports.)
  allocationRange: {
    start: int(process.env.CP_ALLOC_START, 25565),
    end: int(process.env.CP_ALLOC_END, 25600),
  },
};

module.exports = config;
