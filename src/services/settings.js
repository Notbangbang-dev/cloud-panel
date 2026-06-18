'use strict';

/** Read/update the global, admin-editable settings (economy, registration, shop). */

const db = require('../db');

const get = () => db.settings();
const defaults = () => get().defaults;
const economyEnabled = () => !!get().economy.enabled;
const registrationEnabled = () => !!get().registration.enabled;
const requireApproval = () => !!get().registration.requireApproval;
const afkEnabled = () => !!(get().afk && get().afk.enabled);

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
  const allowed = ['economy', 'registration', 'defaults', 'limits', 'shop', 'afk'];
  const clean = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  deepMerge(cur, clean);

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

module.exports = { get, defaults, economyEnabled, registrationEnabled, requireApproval, afkEnabled, update };
