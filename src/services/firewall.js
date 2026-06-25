'use strict';

/**
 * Best-effort host firewall (ufw) automation.
 *
 * When a game-server allocation is added — and for the default allocation range
 * at boot — we try to open the matching port in ufw so the operator doesn't have
 * to remember to. This is purely a CONVENIENCE for the host OS firewall:
 *
 *   - It is BEST-EFFORT and never throws into a request: if ufw is absent, the
 *     panel lacks privileges, or anything fails, we log one actionable line
 *     ("run: sudo ufw allow <port>") and move on. We never pretend it worked.
 *   - On a cloud host (AWS/GCP/Azure), the provider's SECURITY GROUP is the real
 *     gate and the panel cannot touch it — so this does not replace opening the
 *     port in your cloud console.
 *
 * SECURITY: ports are validated as integers in [1,65535] and passed as separate
 * argv to execFile (never a shell string), and only the fixed `ufw`/`sudo`
 * binaries are invoked — so an allocation port can't inject a command.
 */

const fs = require('fs');
const { execFile } = require('child_process');
const config = require('../config');
const { log } = require('../log');

const POSIX = process.platform !== 'win32';
const UFW_PATHS = ['/usr/sbin/ufw', '/sbin/ufw', '/usr/bin/ufw', '/bin/ufw'];

let _ufwBin; // undefined = unprobed, string = path, null = not found
let _warned = false; // log the "couldn't open" hint at most once per process

/** 'off' | 'auto' (run ufw directly) | 'sudo' (run `sudo -n ufw`). */
function mode() {
  const m = config.manageFirewall;
  return m === 'off' || m === 'sudo' ? m : 'auto';
}

/** Path to the ufw binary, or null when it isn't installed (probed once). */
function ufwBin() {
  if (_ufwBin !== undefined) return _ufwBin;
  _ufwBin = null;
  if (POSIX) {
    for (const p of UFW_PATHS) {
      try { if (fs.existsSync(p)) { _ufwBin = p; break; } } catch { /* ignore */ }
    }
  }
  return _ufwBin;
}

/** True when firewall automation is enabled AND ufw is present. */
function available() {
  return mode() !== 'off' && !!ufwBin();
}

/** Coerce to a valid port integer, or null. */
function port(p) {
  const n = Math.trunc(Number(p));
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** Build {cmd,args} for a ufw rule spec (e.g. "25565" or "25565:25600/tcp"). */
function buildArgs(spec) {
  const bin = ufwBin() || 'ufw';
  return mode() === 'sudo'
    ? { cmd: 'sudo', args: ['-n', bin, 'allow', spec] }
    : { cmd: bin, args: ['allow', spec] };
}

function warnOnce(msg) {
  if (_warned) { log.debug && log.debug(`[firewall] ${msg}`); return; }
  _warned = true;
  log.warn(`[firewall] ${msg}`);
}

/** Run a ufw rule spec, resolving to a structured result. Never rejects. */
function runSpec(spec, label) {
  return new Promise((resolve) => {
    if (mode() === 'off') return resolve({ ok: false, skipped: 'disabled' });
    if (!POSIX || !ufwBin()) return resolve({ ok: false, skipped: 'ufw-unavailable' });
    const { cmd, args } = buildArgs(spec);
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message || '').trim().split(/\r?\n/)[0];
        warnOnce(
          `couldn't open ${label} automatically (${detail || 'no privileges'}). ` +
          `Open it manually with:  sudo ufw allow ${spec}`
        );
        return resolve({ ok: false, error: err.message });
      }
      log.info(`[firewall] opened ${label} in ufw (allow ${spec})`);
      resolve({ ok: true });
    });
  });
}

/** Best-effort open a single allocation port (tcp+udp via ufw's combined rule). */
async function allowPort(p) {
  const n = port(p);
  if (n === null) return { ok: false, skipped: 'invalid-port' };
  return runSpec(String(n), `port ${n}`);
}

/** Best-effort open an inclusive port range, tcp + udp. */
async function allowRange(start, end) {
  const a = port(start);
  const b = port(end);
  if (a === null || b === null || b < a) return { ok: false, skipped: 'invalid-range' };
  if (b - a > 20000) return { ok: false, skipped: 'range-too-large' }; // sanity bound
  const tcp = await runSpec(`${a}:${b}/tcp`, `ports ${a}-${b}/tcp`);
  const udp = await runSpec(`${a}:${b}/udp`, `ports ${a}-${b}/udp`);
  return { ok: tcp.ok && udp.ok, tcp, udp };
}

/**
 * Boot-time: open the DEFAULT allocation range (and the panel's own web/SFTP
 * ports) so the out-of-the-box ports work without manual ufw rules. Best-effort
 * and quiet when disabled/unprivileged.
 */
async function ensureDefaults() {
  if (!available()) return;
  const r = config.allocationRange || {};
  await allowRange(r.start, r.end);
  await allowPort(config.webPort);
  await allowPort(config.sftpPort);
}

module.exports = {
  mode,
  available,
  allowPort,
  allowRange,
  ensureDefaults,
  // exported for tests / inspection
  _internals: { port, buildArgs, ufwBin },
};
