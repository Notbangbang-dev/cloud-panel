'use strict';

/**
 * Achievements & XP.
 *
 * A small, mostly stat-driven engine: most achievements unlock automatically
 * when a user's derivable stats (servers owned, coins, daily streak, 2FA) or a
 * few tracked counters (backups created, AFK-at-night, crash recoveries) cross
 * a threshold. Admins can toggle the whole feature and add their own custom
 * achievements (stored in the `achievements` collection).
 *
 * XP = sum of unlocked achievement XP. Level = floor(xp / 250) + 1.
 */

const db = require('../db');

function enabled() {
  return !!(db.settings().achievements || {}).enabled;
}

// Built-in catalog. `condition: { stat, value }` — unlock when stat >= value.
const BUILTIN = [
  { id: 'first_server', name: 'Liftoff', icon: '🚀', xp: 50, desc: 'Deploy your first server.', condition: { stat: 'servers', value: 1 } },
  { id: 'fleet', name: 'Fleet Commander', icon: '🛰️', xp: 150, desc: 'Own 5 servers.', condition: { stat: 'servers', value: 5 } },
  { id: 'first_backup', name: 'Just in Case', icon: '💾', xp: 40, desc: 'Create your first backup.', condition: { stat: 'backupsCreated', value: 1 } },
  { id: 'backup_hoarder', name: 'Backup Hoarder', icon: '🗄️', xp: 200, desc: 'Create 10 backups.', condition: { stat: 'backupsCreated', value: 10 } },
  { id: 'crash_survivor', name: 'Crash Survivor', icon: '🧯', xp: 60, desc: 'Bring a crashed server back to life.', condition: { stat: 'crashes', value: 1 } },
  { id: 'night_owl', name: 'Night Owl', icon: '🦉', xp: 80, desc: 'Earn AFK coins between 2–5am.', condition: { stat: 'afkNight', value: 1 } },
  { id: 'dedicated', name: 'Dedicated', icon: '🔥', xp: 150, desc: 'Reach a 7-day daily-reward streak.', condition: { stat: 'streak', value: 7 } },
  { id: 'loaded', name: 'Loaded', icon: '💰', xp: 100, desc: 'Hold 1,000 coins at once.', condition: { stat: 'coins', value: 1000 } },
  { id: 'locked_down', name: 'Locked Down', icon: '🔐', xp: 70, desc: 'Enable two-factor authentication.', condition: { stat: 'twofa', value: 1 } },
];
const BUILTIN_IDS = new Set(BUILTIN.map((b) => b.id));

function customList() {
  return db.all('achievements').map((a) => ({ ...a, custom: true }));
}
function catalog() {
  return [...BUILTIN, ...customList()];
}

/** Resolve the numeric stats achievements are checked against. */
function statsFor(user) {
  const servers = db.all('servers').filter((s) => s.ownerId === user.id).length;
  const st = user.stats || {};
  return {
    servers,
    coins: user.coins || 0,
    streak: user.dailyStreak || 0,
    twofa: (user.totp && user.totp.enabled) || user.twoFactor ? 1 : 0,
    backupsCreated: st.backupsCreated || 0,
    crashes: st.crashes || 0,
    afkNight: st.afkNight || 0,
  };
}

function levelFor(xp) {
  xp = Math.max(0, xp || 0);
  const span = 250;
  const level = Math.floor(xp / span) + 1;
  return { level, into: xp - (level - 1) * span, span, next: level * span };
}

/** Recompute unlocks from current stats; persist + return the new state. */
function evaluate(user) {
  if (!user) return { unlocked: [], xp: 0, newly: [] };
  const all = catalog();
  const byId = Object.fromEntries(all.map((a) => [a.id, a]));
  const have = new Set((user.achievements || []).filter((id) => byId[id]));
  const newly = [];

  if (enabled()) {
    const stats = statsFor(user);
    for (const a of all) {
      const c = a.condition || {};
      if (have.has(a.id)) continue;
      if (c.stat && typeof stats[c.stat] === 'number' && stats[c.stat] >= (c.value || 1)) {
        have.add(a.id); newly.push(a);
      }
    }
  }

  let xp = 0;
  for (const id of have) xp += (byId[id] && byId[id].xp) || 0;

  const changed = newly.length || (user.xp || 0) !== xp || (user.achievements || []).length !== have.size;
  if (changed) {
    db.update('users', user.id, { achievements: [...have], xp });
    for (const a of newly) {
      db.log({ type: 'achievement', userId: user.id, message: `${user.username} unlocked “${a.name}” (+${a.xp} XP)` });
    }
  }
  return { unlocked: [...have], xp, newly };
}

/** Increment a tracked counter (e.g. backupsCreated) then re-evaluate. */
function bump(user, stat, n = 1) {
  if (!user) return null;
  const stats = { ...(user.stats || {}) };
  stats[stat] = (stats[stat] || 0) + n;
  const updated = db.update('users', user.id, { stats });
  return evaluate(updated);
}

/** Full list for the client (with locked/unlocked flags + level). */
function list(user) {
  const res = evaluate(user);
  const have = new Set(res.unlocked);
  const items = catalog().map((a) => ({
    id: a.id, name: a.name, icon: a.icon || '🏅', xp: a.xp || 0,
    desc: a.desc || '', custom: !!a.custom, unlocked: have.has(a.id),
  }));
  return { enabled: enabled(), xp: res.xp, level: levelFor(res.xp), achievements: items };
}

/* ---- Admin: custom achievements ---- */
const ID_RE = /^[a-z0-9_]{2,32}$/;
const ALLOWED_STATS = ['servers', 'coins', 'streak', 'backupsCreated', 'afkNight', 'crashes'];

function addCustom(input = {}) {
  const id = String(input.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
  if (!ID_RE.test(id)) throw new Error('Invalid id — use 2–32 of a–z, 0–9, _.');
  if (BUILTIN_IDS.has(id) || db.get('achievements', id)) throw new Error('That achievement id already exists.');
  const stat = ALLOWED_STATS.includes(input.stat) ? input.stat : 'coins';
  const rec = {
    id,
    name: String(input.name || id).slice(0, 60),
    desc: String(input.desc || '').slice(0, 200),
    icon: String(input.icon || '🏅').slice(0, 8),
    xp: Math.max(0, Math.floor(Number(input.xp) || 0)),
    condition: { stat, value: Math.max(1, Math.floor(Number(input.value) || 1)) },
  };
  db.insert('achievements', rec);
  return rec;
}
function removeCustom(id) {
  const a = db.get('achievements', id);
  if (a) db.remove('achievements', id);
  return !!a;
}
function adminList() {
  return { builtin: BUILTIN, custom: customList(), allowedStats: ALLOWED_STATS };
}

module.exports = { enabled, evaluate, bump, list, addCustom, removeCustom, adminList, levelFor };
