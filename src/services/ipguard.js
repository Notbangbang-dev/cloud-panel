'use strict';

/**
 * IP security — two admin-toggleable controls:
 *   • Single-IP lock  — bind each (non-admin) account to the first IP it uses.
 *   • Anti-VPN/proxy  — reject sign-ins/sign-ups from VPN/proxy (and optionally
 *                       datacenter/hosting) IPs, via ip-api.com.
 *
 * VPN lookups are cached and FAIL-OPEN (if the lookup errors or the IP is local,
 * the user is allowed) so an outage or rate-limit never locks everyone out.
 * Admins are always exempt. Requires a correct client IP — set CP_TRUST_PROXY
 * when the panel runs behind a reverse proxy / tunnel.
 */

const db = require('../db');
const nettrust = require('./nettrust');

const sec = () => db.settings().security || {};
const singleIpEnabled = () => !!sec().singleIp;
const antiVpnEnabled = () => !!sec().antiVpn;
const blockHosting = () => !!sec().blockHosting;

const cache = new Map(); // ip -> { proxy, hosting, ts }
const TTL = 6 * 3600 * 1000;

function isLocal(ip) {
  if (!ip) return true;
  try { return nettrust.isPrivateIp(ip); } catch { return false; }
}

async function lookup(ip) {
  if (isLocal(ip)) return { proxy: false, hosting: false, local: true };
  const c = cache.get(ip);
  if (c && Date.now() - c.ts < TTL) return c;
  try {
    const key = sec().ipApiKey;
    const base = key ? 'https://pro.ip-api.com/json/' : 'http://ip-api.com/json/';
    const url = `${base}${encodeURIComponent(ip)}?fields=status,proxy,hosting${key ? `&key=${encodeURIComponent(key)}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500), headers: { 'User-Agent': 'CloudPanel' } });
    const d = await res.json();
    const out = { proxy: !!d.proxy, hosting: !!d.hosting, ts: Date.now() };
    cache.set(ip, out);
    return out;
  } catch {
    return { proxy: false, hosting: false, error: true }; // fail-open
  }
}

/** Returns a block reason string, or null if the IP is allowed. */
async function vpnBlockReason(ip) {
  if (!antiVpnEnabled()) return null;
  const d = await lookup(ip);
  if (d.local || d.error) return null; // never block local / on lookup failure
  if (d.proxy) return 'VPN or proxy connections aren’t allowed here.';
  if (blockHosting() && d.hosting) return 'Connections from datacenter / hosting networks aren’t allowed.';
  return null;
}

/** Binds the account to `ip` on first use; returns a reason if it's locked elsewhere. */
function singleIpCheck(user, ip) {
  if (!singleIpEnabled() || !user || user.admin || !ip || isLocal(ip)) return null;
  if (!user.lockedIp) { db.update('users', user.id, { lockedIp: ip }); return null; }
  if (user.lockedIp !== ip) return 'Your account is locked to a different IP address. Ask an admin to reset it.';
  return null;
}

function resetIp(userId) { return db.update('users', userId, { lockedIp: null }); }

module.exports = { singleIpEnabled, antiVpnEnabled, vpnBlockReason, singleIpCheck, resetIp, lookup };
