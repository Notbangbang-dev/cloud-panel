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

/** Parse a boolean-ish env value ("1"/"true"/"yes"/"on"). */
function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

/**
 * Resolve a value safe to pass to Express's `trust proxy` setting.
 * Defaults to `false` (do not trust client-supplied X-Forwarded-* headers).
 */
function resolveTrustProxy(v) {
  if (v === undefined || v === '' || v === '0' || v === 'false') return false;
  if (v === 'true') return true; // trust all hops (discouraged)
  const n = parseInt(v, 10);
  if (String(n) === String(v).trim()) return n; // number of hops (recommended)
  return v; // an IP / subnet (or comma-separated list) handed to Express verbatim
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

  // Trust X-Forwarded-* headers. SECURITY: defaults to OFF, because trusting
  // these headers when the panel is reachable directly lets attackers spoof
  // X-Forwarded-For to forge req.ip and bypass IP-based rate limiting.
  // Only enable it when actually behind a trusted proxy / Cloudflare Tunnel:
  //   CP_TRUST_PROXY=1            -> trust ONE proxy hop (recommended)
  //   CP_TRUST_PROXY=2            -> trust two hops, etc.
  //   CP_TRUST_PROXY=10.0.0.0/8   -> trust a specific proxy IP/subnet (list ok)
  //   CP_TRUST_PROXY=true         -> trust all hops (discouraged)
  //   CP_TRUST_PROXY=0 / unset    -> do not trust (default)
  trustProxy: resolveTrustProxy(process.env.CP_TRUST_PROXY),

  // ---- Security -----------------------------------------------------------
  // No hard-coded secret: CP_JWT_SECRET if set, else auto-generated & persisted.
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.CP_JWT_TTL || '7d',
  bcryptRounds: int(process.env.CP_BCRYPT_ROUNDS, 10),

  // ---- Server process isolation (optional; POSIX; panel must run as root) --
  // When set, each game server is spawned as this unprivileged uid/gid so it
  // can't read the panel's data/secrets or other panel-owned files. Obtain
  // them with `id -u cp-servers` / `id -g cp-servers`. See SECURITY.md.
  serverUid: int(process.env.CP_SERVER_UID, null),
  serverGid: int(process.env.CP_SERVER_GID, null),

  // Secure by default: with NO sandbox active (neither OCI nor CP_SERVER_UID/GID),
  // a running server executes code as the panel user and can read the JWT secret
  // / DB (audit C1). So servers REFUSE TO START unless a sandbox is active OR the
  // operator explicitly accepts the risk here. Set this ONLY for a trusted,
  // single-operator panel; for any untrusted/multi-user use, enable CP_OCI=1
  // instead. (Can also be toggled at Admin → Settings: security.allowUnsandboxed.)
  allowUnsandboxed: bool(process.env.CP_ALLOW_UNSANDBOXED),

  // ---- OCI container sandbox (optional; strongest isolation) --------------
  // When enabled, every game/app server runs inside its own OCI container
  // (Docker or Podman) instead of as a host child process. The container is
  // the sandbox: server code can't read the panel's data/secrets, other
  // servers' files, or the host — even for code-running eggs (Node/Python/jar).
  // Each egg already declares its image in `egg.docker`. This is opt-in and
  // loud-on-misconfig (mirrors CP_SERVER_UID/GID): when CP_OCI=1 but the
  // runtime is unavailable, servers refuse to start rather than silently run
  // unsandboxed. See SECURITY.md.
  oci: {
    // Require containers for every server. When on but the runtime is missing,
    // starts fail loudly (we never silently fall back to host processes).
    enabled: bool(process.env.CP_OCI),
    // Container engine CLI: "docker" (default) or "podman" (drop-in, rootless-capable).
    runtime: (process.env.CP_OCI_RUNTIME || 'docker').trim(),
    // Fallback image when an egg has no `docker` image set (rare; all built-in eggs do).
    image: (process.env.CP_OCI_IMAGE || '').trim(),
    // Host IP to publish game ports on ("" = all interfaces / 0.0.0.0).
    bind: (process.env.CP_OCI_BIND || '').trim(),
    // Container network: "" = default bridge (ports are published); or "host", a network name…
    network: (process.env.CP_OCI_NETWORK || '').trim(),
    // Run as this in-container user "uid[:gid]" ("" = the image's own user).
    user: (process.env.CP_OCI_USER || '').trim(),
    // In-container working directory the server volume is mounted at.
    workdir: (process.env.CP_OCI_WORKDIR || '/home/container').trim(),
    // Max process/thread count per container (anti fork-bomb). 0 disables the cap.
    pidsLimit: int(process.env.CP_OCI_PIDS_LIMIT, 512),
    // Derive a hard `--cpus` cap from each server's CPU limit (100 = 1 core).
    cpuLimit: bool(process.env.CP_OCI_CPU_LIMIT, true),
    // Read-only root filesystem (+ tmpfs /tmp). Off by default — some servers
    // write outside their volume; enable for the strictest sandbox.
    readOnly: bool(process.env.CP_OCI_READONLY),
    // Image pull policy passed to `run`: missing | always | never.
    pull: (process.env.CP_OCI_PULL || 'missing').trim(),
    // Advanced: extra args appended to every `run` (shell-style, quotes honored).
    extraArgs: (process.env.CP_OCI_EXTRA_ARGS || '').trim(),
  },

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
  // Admin-uploaded assets (theme backgrounds: images / gifs / video). Served at /uploads.
  uploadsDir: process.env.CP_UPLOADS_DIR || path.join(DATA_DIR, 'uploads'),
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
