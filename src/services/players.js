'use strict';

/**
 * Live player list — parses each server's console for join/leave events (and
 * `/list` output) to keep a real-time roster of who's online, and exposes
 * kick/ban actions. Works for Minecraft: Java, and best-effort for Bedrock /
 * PocketMine ("Player connected/disconnected").
 *
 * Subscribes to processManager console events (no changes to the process
 * manager, no require cycle), exactly like the automations engine.
 */

const db = require('../db');
const pm = require('./processManager');

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const rosters = new Map(); // serverId -> Map(lowerName -> { name, since })
const subs = new Map();    // serverId -> unsubscribe()

const JOIN = [
  /:\s*([A-Za-z0-9_]{1,16}) joined the game/,
  /\bPlayer connected:\s*([^,\r\n]{1,40})/i,
];
const LEAVE = [
  /:\s*([A-Za-z0-9_]{1,16}) left the game/,
  /\bPlayer disconnected:\s*([^,\r\n]{1,40})/i,
];
// "There are 2 of a max of 20 players online: Steve, Alex"
const LIST_RE = /players online:?\s*(.*)$/i;

const SAFE_NAME = /^[A-Za-z0-9_]{1,16}$/;

function roster(serverId) {
  if (!rosters.has(serverId)) rosters.set(serverId, new Map());
  return rosters.get(serverId);
}

function add(serverId, name) {
  const n = String(name || '').trim();
  if (!n) return;
  const map = roster(serverId);
  if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), { name: n, since: Date.now() });
}
function drop(serverId, name) {
  roster(serverId).delete(String(name || '').trim().toLowerCase());
}
function clear(serverId) {
  rosters.set(serverId, new Map());
}

function onLine(serverId, raw) {
  const line = String(raw || '').replace(ANSI_RE, '');
  if (!line) return;
  for (const re of JOIN) { const m = line.match(re); if (m) { add(serverId, m[1]); return; } }
  for (const re of LEAVE) { const m = line.match(re); if (m) { drop(serverId, m[1]); return; } }
  const lm = line.match(LIST_RE);
  if (lm) {
    const names = lm[1].split(',').map((s) => s.trim()).filter(Boolean);
    // Replace the roster wholesale from an authoritative /list response.
    const map = new Map();
    for (const name of names) map.set(name.toLowerCase(), { name, since: Date.now() });
    rosters.set(serverId, map);
  }
}

function watch(serverId) {
  if (subs.has(serverId)) return;
  const unsub = pm.subscribe(serverId, (msg) => {
    if (msg.event === 'console') onLine(serverId, msg.line);
    else if (msg.event === 'status' && msg.status !== 'running' && msg.status !== 'stopping') clear(serverId);
  });
  subs.set(serverId, unsub);
}

/** Current roster for a server. */
function list(serverId) {
  const map = roster(serverId);
  const online = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { online, count: online.length };
}

/** Ask the server to print `/list` (refreshes the roster from the source). */
function refresh(server) {
  if (pm.state(server.id).status !== 'running') return { ok: false, error: 'Server is not running' };
  return pm.command(server.id, 'list');
}

function sanitizeName(name) {
  const n = String(name || '').trim();
  if (SAFE_NAME.test(n)) return n;
  // Bedrock names may contain spaces; strip anything that could break the command.
  const cleaned = n.replace(/["\r\n]/g, '').slice(0, 40);
  return cleaned || null;
}

function kick(server, name, reason) {
  const n = sanitizeName(name);
  if (!n) return { ok: false, error: 'Invalid player name' };
  const r = (reason || '').replace(/["\r\n]/g, '').slice(0, 100);
  return pm.command(server.id, `kick ${n}${r ? ' ' + r : ''}`);
}

function ban(server, name, reason) {
  const n = sanitizeName(name);
  if (!n) return { ok: false, error: 'Invalid player name' };
  const r = (reason || '').replace(/["\r\n]/g, '').slice(0, 100);
  drop(server.id, n);
  return pm.command(server.id, `ban ${n}${r ? ' ' + r : ''}`);
}

/** Boot-time: watch every existing server's console. */
function init() {
  for (const s of db.all('servers')) watch(s.id);
  return rosters.size;
}

module.exports = { init, watch, list, refresh, kick, ban, clear, onLine };
