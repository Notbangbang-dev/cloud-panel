'use strict';

/**
 * Coin ledger — a lightweight record of every coin movement (earned/spent), so
 * the admin analytics page can chart real economy flow over time. Best-effort
 * and never blocks the action that triggered it.
 */

const db = require('../db');

const MAX_ENTRIES = 5000;

function record(userId, delta, reason) {
  delta = Math.round(Number(delta) || 0);
  if (!userId || !delta) return;
  try {
    db.insert('ledger', {
      id: 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      userId,
      delta,
      reason: String(reason || '').slice(0, 60),
      at: new Date().toISOString(),
    });
    // Bound storage: drop the oldest entries past the cap.
    const all = db.all('ledger');
    if (all.length > MAX_ENTRIES) {
      all.slice(0, all.length - MAX_ENTRIES).forEach((tx) => { try { db.remove('ledger', tx.id); } catch {} });
    }
  } catch { /* best-effort */ }
}

/** Per-day earned/spent totals over the last `days` (UTC), oldest first. */
function recentDays(days = 14) {
  const byDay = {};
  const order = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay[d] = { date: d, earned: 0, spent: 0 };
    order.push(d);
  }
  for (const tx of db.all('ledger')) {
    const d = (tx.at || '').slice(0, 10);
    if (d in byDay) {
      if (tx.delta >= 0) byDay[d].earned += tx.delta;
      else byDay[d].spent += -tx.delta;
    }
  }
  return order.map((d) => byDay[d]);
}

module.exports = { record, recentDays };
