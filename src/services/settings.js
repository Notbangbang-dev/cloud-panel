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

// Keys that must never be merged from client input — merging them walks into
// Object.prototype (prototype pollution, CWE-1321). Even though settings are
// admin-only, we refuse them as defense in depth.
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function deepMerge(target, patch) {
  for (const k of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(k)) continue; // block prototype pollution
    const pv = patch[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
      if (!Object.prototype.hasOwnProperty.call(target, k) || !target[k] || typeof target[k] !== 'object') target[k] = {};
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
  const allowed = ['economy', 'registration', 'defaults', 'limits', 'shop', 'afk', 'security', 'dailyReward', 'maintenance', 'banner', 'seasonal', 'achievements', 'pets', 'bragCards', 'statusOverview', 'billing'];
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

  // Daily reward.
  if (!cur.dailyReward) cur.dailyReward = {};
  cur.dailyReward.enabled = !!cur.dailyReward.enabled;
  cur.dailyReward.coins = num(cur.dailyReward.coins);
  cur.dailyReward.streakBonus = num(cur.dailyReward.streakBonus);
  cur.dailyReward.maxBonus = num(cur.dailyReward.maxBonus);

  // Maintenance mode.
  if (!cur.maintenance) cur.maintenance = {};
  cur.maintenance.enabled = !!cur.maintenance.enabled;
  cur.maintenance.allowAdmins = cur.maintenance.allowAdmins === undefined ? true : !!cur.maintenance.allowAdmins;
  cur.maintenance.title = (String(cur.maintenance.title || '').trim().slice(0, 100)) || "We'll be right back";
  cur.maintenance.message = String(cur.maintenance.message || '').slice(0, 1000);
  cur.maintenance.scheduleEnabled = !!cur.maintenance.scheduleEnabled;
  cur.maintenance.start = String(cur.maintenance.start || '').slice(0, 40);
  cur.maintenance.end = String(cur.maintenance.end || '').slice(0, 40);

  // Broadcast banner.
  if (!cur.banner) cur.banner = {};
  cur.banner.enabled = !!cur.banner.enabled;
  cur.banner.text = String(cur.banner.text || '').slice(0, 300);
  cur.banner.style = ['info', 'warn', 'success', 'danger'].includes(cur.banner.style) ? cur.banner.style : 'info';

  // Seasonal auto-themes.
  if (!cur.seasonal) cur.seasonal = {};
  cur.seasonal.mode = ['off', 'auto', 'halloween', 'winter', 'christmas', 'newyear'].includes(cur.seasonal.mode) ? cur.seasonal.mode : 'off';

  // Achievements & pets feature flags.
  if (!cur.achievements) cur.achievements = {};
  cur.achievements.enabled = !!cur.achievements.enabled;
  if (!cur.pets) cur.pets = {};
  cur.pets.enabled = !!cur.pets.enabled;

  // Brag cards + panel-wide status overview.
  if (!cur.bragCards) cur.bragCards = {};
  cur.bragCards.enabled = !!cur.bragCards.enabled;
  if (!cur.statusOverview) cur.statusOverview = {};
  cur.statusOverview.enabled = !!cur.statusOverview.enabled;
  cur.statusOverview.title = String(cur.statusOverview.title || '').slice(0, 80);

  // Billing / paid plans.
  if (!cur.billing) cur.billing = {};
  cur.billing.mode = ['free', 'paid', 'trial'].includes(cur.billing.mode) ? cur.billing.mode : 'free';
  cur.billing.currency = String(cur.billing.currency || 'usd').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) || 'usd';
  cur.billing.trialDays = Math.min(365, Math.max(0, Math.floor(Number(cur.billing.trialDays) || 0)));
  cur.billing.cancelBehavior = cur.billing.cancelBehavior === 'keep' ? 'keep' : 'revert';
  cur.billing.trialPlanId = cur.billing.trialPlanId ? String(cur.billing.trialPlanId).slice(0, 40) : null;
  if (!cur.billing.stripe) cur.billing.stripe = {};
  cur.billing.stripe.enabled = !!cur.billing.stripe.enabled;
  cur.billing.stripe.publishableKey = String(cur.billing.stripe.publishableKey || '').slice(0, 200);
  cur.billing.stripe.secretKey = String(cur.billing.stripe.secretKey || '').slice(0, 200);
  cur.billing.stripe.webhookSecret = String(cur.billing.stripe.webhookSecret || '').slice(0, 200);

  db.update('settings', 'global', cur);
  return get();
}

/** Effective maintenance state — manual toggle OR an active scheduled window. */
function maintenanceActive() {
  const m = (get().maintenance) || {};
  if (m.enabled) return true;
  if (m.scheduleEnabled && m.start && m.end) {
    const now = Date.now();
    const s = Date.parse(m.start), e = Date.parse(m.end);
    if (!Number.isNaN(s) && !Number.isNaN(e) && now >= s && now <= e) return true;
  }
  return false;
}

module.exports = { get, defaults, economyEnabled, registrationEnabled, requireApproval, afkEnabled, discord, discordReady, update, maintenanceActive };
