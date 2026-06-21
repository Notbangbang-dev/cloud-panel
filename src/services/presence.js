'use strict';

/**
 * Lightweight in-memory presence. Updated on every authenticated client request
 * (and an explicit ping), so we never write to the DB just to track "online".
 * A user counts as online if seen within TTL. Resets on restart (fine — it's
 * ephemeral status, not durable data).
 */

const TTL = 90 * 1000; // 90s
const seen = new Map(); // userId -> last-seen timestamp

function touch(userId) {
  if (userId) seen.set(userId, Date.now());
}
function isOnline(userId) {
  const t = seen.get(userId);
  return !!t && Date.now() - t < TTL;
}
function onlineCount() {
  const now = Date.now();
  let n = 0;
  for (const t of seen.values()) if (now - t < TTL) n++;
  return n;
}

module.exports = { touch, isOnline, onlineCount, TTL };
