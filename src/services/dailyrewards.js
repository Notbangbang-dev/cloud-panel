'use strict';

/**
 * Daily login reward — members can claim coins once per (UTC) day. An optional
 * per-day streak bonus rewards consecutive claims (missing a day resets it).
 * Fully admin-configurable (Admin → Settings) and gated on the economy.
 */

const db = require('../db');
const settings = require('./settings');
const ledger = require('./ledger');

function config() {
  const d = db.settings().dailyReward || {};
  return {
    enabled: settings.economyEnabled() && !!d.enabled,
    coins: Math.max(0, Math.floor(d.coins || 0)),
    streakBonus: Math.max(0, Math.floor(d.streakBonus || 0)),
    maxBonus: Math.max(0, Math.floor(d.maxBonus || 0)),
  };
}

/** UTC calendar day key, e.g. "2026-06-20". */
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

function bonusFor(cfg, streak) {
  const raw = cfg.streakBonus * Math.max(0, streak - 1);
  return cfg.maxBonus ? Math.min(cfg.maxBonus, raw) : raw;
}

/** What the user would get if they claimed right now (no mutation). */
function status(user) {
  const cfg = config();
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  const last = user.lastDailyAt ? dayKey(user.lastDailyAt) : null;
  const claimedToday = last === today;
  const nextStreak = last === yesterday ? (user.dailyStreak || 0) + 1 : 1;
  const bonus = bonusFor(cfg, nextStreak);
  return {
    enabled: cfg.enabled,
    claimedToday,
    streak: user.dailyStreak || 0,
    nextStreak,
    baseCoins: cfg.coins,
    bonus,
    nextReward: cfg.coins + bonus,
  };
}

/** Claim today's reward (mutates the user). */
function claim(user) {
  const cfg = config();
  if (!cfg.enabled) return { ok: false, error: 'Daily rewards are disabled.', code: 'DISABLED' };

  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  const last = user.lastDailyAt ? dayKey(user.lastDailyAt) : null;
  if (last === today) return { ok: false, error: 'You already claimed today — come back tomorrow!', code: 'CLAIMED' };

  const streak = last === yesterday ? (user.dailyStreak || 0) + 1 : 1;
  const bonus = bonusFor(cfg, streak);
  const reward = cfg.coins + bonus;

  const updated = db.update('users', user.id, {
    coins: (user.coins || 0) + reward,
    lastDailyAt: new Date().toISOString(),
    dailyStreak: streak,
  });
  ledger.record(user.id, reward, 'daily reward');
  db.log({ type: 'economy', userId: user.id, message: `${user.username} claimed their daily reward (+${reward} coins, ${streak}-day streak)` });
  return { ok: true, reward, bonus, streak, coins: updated.coins };
}

module.exports = { config, status, claim };
