'use strict';

/** Read/update the global, admin-editable settings (economy, registration, shop). */

const db = require('../db');
const appearance = require('./appearance');

const get = () => db.settings();
const defaults = () => get().defaults;
const economyEnabled = () => !!get().economy.enabled;
const registrationEnabled = () => !!get().registration.enabled;
const requireApproval = () => !!get().registration.requireApproval;
const afkEnabled = () => !!(get().afk && get().afk.enabled);
const discord = () => (get().oauth && get().oauth.discord) || {};
/** True only when Discord login is enabled AND fully configured. */
const discordReady = () => {
  const d = discord();
  return !!(d.enabled && d.clientId && d.clientSecret && d.redirectUri);
};

function deepMerge(target, patch) {
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], pv);
    } else {
      target[k] = pv;
    }
  }
  return target;
}

const num = (v, min = 0) => Math.max(min, Math.floor(Number(v) || 0));

/** Apply a (partial) settings patch with whitelisting + coercion. */
function update(patch = {}) {
  const cur = JSON.parse(JSON.stringify(get()));
  const allowed = ['economy', 'registration', 'defaults', 'limits', 'shop', 'afk', 'security'];
  const clean = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  deepMerge(cur, clean);

  // Database hosts (array of { id, name, host, port, username, password,
  // phpMyAdminUrl }) are replaced wholesale + coerced. Managed via the
  // dedicated Admin → Databases endpoints (not the generic settings form).
  if (patch.databaseHosts !== undefined && Array.isArray(patch.databaseHosts)) {
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    cur.databaseHosts = patch.databaseHosts.map((h) => ({
      id: str(h.id, 64) || ('dbhost_' + Math.random().toString(16).slice(2, 10)),
      name: str(h.name, 60) || 'Database Host',
      host: str(h.host, 200),
      port: Math.min(65535, Math.max(1, parseInt(h.port, 10) || 3306)),
      username: str(h.username, 64) || 'root',
      password: typeof h.password === 'string' ? h.password : '',
      phpMyAdminUrl: str(h.phpMyAdminUrl, 300),
    }));
  }

  // Appearance is replaced wholesale (the editor always sends a full document)
  // and fully validated/normalized by its own engine.
  if (patch.appearance !== undefined) cur.appearance = appearance.sanitize(patch.appearance);

  // Discord OAuth config (replaced wholesale + sanitized).
  if (patch.oauth !== undefined) {
    const d = (patch.oauth && patch.oauth.discord) || {};
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    cur.oauth = {
      discord: {
        enabled: !!d.enabled,
        clientId: str(d.clientId, 64),
        clientSecret: str(d.clientSecret, 200),
        redirectUri: str(d.redirectUri, 300),
        createAccounts: d.createAccounts === undefined ? true : !!d.createAccounts,
      },
    };
  }

  if (!cur.security) cur.security = {};
  cur.security.force2faAdmins = !!cur.security.force2faAdmins;
  cur.economy.enabled = !!cur.economy.enabled;
  cur.registration.enabled = !!cur.registration.enabled;
  cur.registration.requireApproval = !!cur.registration.requireApproval;
  if (!cur.afk) cur.afk = {};
  cur.afk.enabled = !!cur.afk.enabled;
  cur.afk.coins = num(cur.afk.coins);
  cur.afk.intervalSeconds = Math.max(5, num(cur.afk.intervalSeconds)); // never below 5s
  for (const key of ['coins', 'memory', 'cpu', 'disk', 'servers', 'backups'])
    cur.defaults[key] = num(cur.defaults[key]);
  for (const key of ['minMemory', 'minCpu', 'minDisk'])
    cur.limits[key] = num(cur.limits[key]);
  for (const r of ['memory', 'cpu', 'disk', 'servers', 'backups']) {
    if (!cur.shop[r]) continue;
    cur.shop[r].price = num(cur.shop[r].price);
    cur.shop[r].amount = num(cur.shop[r].amount, 1);
  }

  db.update('settings', 'global', cur);
  return get();
}

module.exports = { get, defaults, economyEnabled, registrationEnabled, requireApproval, afkEnabled, discord, discordReady, update };
