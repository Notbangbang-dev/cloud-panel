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

const net = require('net');
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

/**
 * Canonicalize a client IP for stable identity comparisons (R3):
 *  - drop any IPv6 zone id (`%eth0`),
 *  - unwrap IPv4-mapped IPv6 (`::ffff:1.2.3.4` → `1.2.3.4`),
 *  - collapse a full IPv6 address to its `/64` network, so a client's rotating
 *    privacy addresses within one subnet count as a single identity.
 */
function canonicalIp(ip) {
  let s = String(ip || '').trim().split('%')[0];
  if (!s) return s;
  const m = s.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1];
  if (net.isIP(s) === 6) {
    const a = s.toLowerCase();
    let head, tail;
    if (a.includes('::')) {
      const [h, t] = a.split('::');
      head = h ? h.split(':') : [];
      tail = t ? t.split(':') : [];
    } else {
      head = a.split(':'); tail = [];
    }
    const fill = 8 - (head.length + tail.length);
    if (fill < 0) return a; // malformed — compare verbatim
    const groups = [...head, ...Array(fill).fill('0'), ...tail];
    return groups.slice(0, 4).map((g) => g || '0').join(':') + '::/64';
  }
  return s;
}

let warnedNoKey = false;

async function lookup(ip) {
  if (isLocal(ip)) return { proxy: false, hosting: false, local: true };
  const c = cache.get(ip);
  if (c && Date.now() - c.ts < TTL) return c;
  try {
    const key = sec().ipApiKey;
    // SECURITY (R1): the proxy/hosting verdict is a security decision, so it must
    // travel over HTTPS — a cleartext verdict is MITM-spoofable on the panel's
    // egress (force proxy:false to bypass, or proxy:true to DoS). We therefore
    // ALWAYS use https. ip-api's free tier is HTTP-only, so without a Pro key the
    // request fails and we fail-open (control inactive) rather than trusting
    // spoofable cleartext.
    if (!key && !warnedNoKey) {
      warnedNoKey = true;
      console.warn('[ipguard] anti-VPN/proxy needs an ip-api Pro key for HTTPS — without one the check fails open (does not block). Set it in Admin → Settings → IP security.');
    }
    const base = key ? 'https://pro.ip-api.com/json/' : 'https://ip-api.com/json/';
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
  const cur = canonicalIp(ip);
  if (!user.lockedIp) { db.update('users', user.id, { lockedIp: cur }); return null; }
  // Compare canonical forms so dual-stack / v4-mapped / IPv6 privacy addresses
  // for the same client don't trip the lock (and older raw values still match).
  if (canonicalIp(user.lockedIp) !== cur) return 'Your account is locked to a different IP address. Ask an admin to reset it.';
  return null;
}

function resetIp(userId) { return db.update('users', userId, { lockedIp: null }); }

module.exports = { singleIpEnabled, antiVpnEnabled, vpnBlockReason, singleIpCheck, resetIp, lookup, canonicalIp };
