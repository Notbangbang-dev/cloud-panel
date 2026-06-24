'use strict';

/**
 * Console Automations — a feature that (as far as we know) no other game-server
 * panel ships: reactive rules that watch each server's LIVE console output and,
 * when a line matches a pattern, automatically perform an action.
 *
 *   match (contains | regex)  ->  action (command | power | notify)
 *
 * Use cases: auto-restart on "OutOfMemoryError", auto `/save-all` on a keyword,
 * or instant Discord/webhook alerts the moment a crash/error appears.
 *
 * Design notes:
 *  - Subscribes to processManager's per-server console events (no changes to the
 *    process manager, no require cycle).
 *  - Enabled rules are compiled and cached in memory per server, so matching a
 *    console line never hits the database.
 *  - Per-rule cooldowns prevent action storms / feedback loops.
 *  - `notify` webhooks are restricted to https public hosts (SSRF mitigation).
 */

const db = require('../db');
const pm = require('./processManager');
const nettrust = require('./nettrust');

const COLL = 'automations';
const ACTIONS = ['command', 'power', 'notify'];
const MATCH_TYPES = ['contains', 'regex'];
const POWER_ACTIONS = ['start', 'stop', 'restart', 'kill'];
const ANSI_RE = /\u001b\[[0-9;]*m/g;
// Cap the input fed to user-supplied regexes. Catastrophic backtracking (ReDoS)
// scales with input length, so bounding it sharply limits worst-case CPU even
// for a pathological pattern created by someone with the 'automation' grant.
const MAX_MATCH_INPUT = 2000;

const subs = new Map();             // serverId -> unsubscribe()
const compiledByServer = new Map(); // serverId -> [{ rule, test }]
const lastFired = new Map();        // ruleId -> epoch ms

/* ---- queries ------------------------------------------------------------- */
const list = (serverId) =>
  db.filter(COLL, (a) => a.serverId === serverId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const get = (id) => db.get(COLL, id);

/* ---- validation ---------------------------------------------------------- */
// Reject patterns prone to catastrophic backtracking (ReDoS). A user-supplied
// regex is run synchronously against console lines / the test endpoint, so an
// "evil regex" like (a+)+$ would freeze the single-process panel for everyone —
// the 2000-char input cap does NOT help (the cost is exponential, not linear).
// This heuristic blocks a quantifier applied to a group that itself contains an
// unbounded quantifier (the classic nested-quantifier blowup), plus a couple of
// known-bad shapes. It can't catch every pathological regex, but it stops the
// exploitable classes; full safety would need an RE2/worker-timeout engine.
function isDangerousRegex(src) {
  const s = String(src);
  // The exploitable class here is a quantified group whose body ALSO contains an
  // unbounded quantifier — the classic nested-quantifier blowup, e.g. (a+)+ ,
  // (a*)*c , (.*)*x . That is what hangs the engine; we reject those shapes.
  if (/\([^)]*[+*][^)]*\)\s*[*+]/.test(s)) return true;       // (...+...)+  / (...*...)*
  if (/\([^)]*[+*][^)]*\)\s*\{\d+,\}/.test(s)) return true;   // (...+...){n,}
  return false;
}
function validRegex(src) {
  if (isDangerousRegex(src)) return false;
  try { new RegExp(src); return true; } catch { return false; }
}

/**
 * Fast, synchronous sanity check at create/update time: require an https URL
 * that isn't an obviously-internal host or private IP literal. The AUTHORITATIVE
 * SSRF guard (DNS resolution + per-redirect re-validation) runs at delivery time
 * in notify() via nettrust.safeFetch — using the same canonical guard the
 * installers use, so the CGNAT/IPv4-mapped gaps of the old bespoke regex (and
 * DNS-rebind / redirect bypasses) are all covered there.
 */
function safeWebhook(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  return !nettrust.isObviouslyInternal(u);
}

function sanitize(input) {
  const a = input && typeof input === 'object' ? input : {};
  const matchType = MATCH_TYPES.includes(a.matchType) ? a.matchType : 'contains';
  const match = (typeof a.match === 'string' ? a.match : '').slice(0, 500);
  if (!match.trim()) throw new Error('A match pattern is required.');
  if (matchType === 'regex' && !validRegex(match)) throw new Error('That is not a valid regular expression.');

  const action = ACTIONS.includes(a.action) ? a.action : 'command';
  let value = typeof a.value === 'string' ? a.value.trim() : '';
  if (action === 'power') {
    if (!POWER_ACTIONS.includes(value)) value = 'restart';
  } else if (action === 'command') {
    if (!value) throw new Error('A console command is required.');
    value = value.slice(0, 500);
  } else if (action === 'notify') {
    if (!safeWebhook(value)) throw new Error('Enter an https webhook URL to a public host (e.g. a Discord webhook).');
  }

  return {
    name: ((typeof a.name === 'string' && a.name.trim()) || 'Automation').slice(0, 60),
    enabled: a.enabled === undefined ? true : !!a.enabled,
    match,
    matchType,
    caseSensitive: !!a.caseSensitive,
    action,
    value,
    cooldown: Math.min(86400, Math.max(0, Math.floor(Number(a.cooldown) || 0))),
  };
}

/* ---- CRUD ---------------------------------------------------------------- */
function create(serverId, input) {
  const clean = sanitize(input);
  const row = { id: db.uid('auto'), serverId, createdAt: new Date().toISOString(), fireCount: 0, lastFiredAt: null, ...clean };
  db.insert(COLL, row);
  refresh(serverId);
  return row;
}

function update(id, input) {
  const cur = db.get(COLL, id);
  if (!cur) return null;
  const clean = sanitize({ ...cur, ...input });
  const row = db.update(COLL, id, clean);
  refresh(cur.serverId);
  return row;
}

function remove(id) {
  const cur = db.get(COLL, id);
  if (!cur) return false;
  const ok = db.remove(COLL, id);
  lastFired.delete(id);
  refresh(cur.serverId);
  return ok;
}

/* ---- matching ------------------------------------------------------------ */
function buildTest(rule) {
  if (rule.matchType === 'regex') {
    let re;
    try { re = new RegExp(rule.match, rule.caseSensitive ? '' : 'i'); } catch { return () => false; }
    return (line) => re.test(line);
  }
  const needle = rule.caseSensitive ? rule.match : rule.match.toLowerCase();
  return (line) => (rule.caseSensitive ? line : line.toLowerCase()).includes(needle);
}

/** Used by the "test against a sample line" endpoint. Only the match fields
 *  matter here — the action/value aren't required to preview a match. */
function testLine(rule, line) {
  rule = rule && typeof rule === 'object' ? rule : {};
  const match = typeof rule.match === 'string' ? rule.match : '';
  if (!match) return false;
  const matchType = MATCH_TYPES.includes(rule.matchType) ? rule.matchType : 'contains';
  if (matchType === 'regex' && !validRegex(match)) return false;
  const sample = String(line == null ? '' : line).slice(0, MAX_MATCH_INPUT); // ReDoS input cap
  return buildTest({ match, matchType, caseSensitive: !!rule.caseSensitive })(sample);
}

/* ---- engine -------------------------------------------------------------- */
async function runAction(rule, server, line) {
  if (rule.action === 'command') return pm.command(server.id, rule.value);
  if (rule.action === 'power') return pm.power(server, rule.value);
  if (rule.action === 'notify') return notify(rule, server, line);
  return undefined;
}

async function notify(rule, server, line) {
  if (typeof fetch !== 'function') return; // Node < 18 (panel requires 18+)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // safeFetch re-resolves DNS and re-validates EVERY redirect hop, so the
    // webhook can't be (re)pointed at internal hosts after creation.
    await nettrust.safeFetch(rule.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🔔 **${server.name}** · automation **${rule.name}** matched:\n\`\`\`\n${line.slice(0, 1500)}\n\`\`\``,
      }),
      signal: controller.signal,
    });
  } catch {
    /* webhook failures (and blocked-SSRF rejections) are non-fatal */
  } finally {
    clearTimeout(timer);
  }
}

function onConsoleLine(serverId, entry) {
  if (!entry || entry.stream === 'in') return; // ignore our own injected commands
  const compiled = compiledByServer.get(serverId);
  if (!compiled || !compiled.length) return;
  // Cap the length tested by (user-supplied) regexes to bound ReDoS cost.
  const line = String(entry.line || '').replace(ANSI_RE, '').slice(0, MAX_MATCH_INPUT);
  if (!line) return;

  const now = Date.now();
  let server = null;
  for (const { rule, test } of compiled) {
    if (!test(line)) continue;
    const last = lastFired.get(rule.id) || 0;
    if (rule.cooldown && now - last < rule.cooldown * 1000) continue;
    lastFired.set(rule.id, now);
    if (!server) server = db.get('servers', serverId);
    if (!server) return;

    rule.fireCount = (rule.fireCount || 0) + 1;
    db.update(COLL, rule.id, { fireCount: rule.fireCount, lastFiredAt: new Date().toISOString() });
    const detail = rule.action === 'command' ? `: ${rule.value}` : rule.action === 'power' ? `: ${rule.value}` : '';
    db.log({ type: 'automation', serverId, message: `Automation '${rule.name}' fired → ${rule.action}${detail}` });
    Promise.resolve(runAction(rule, server, line)).catch(() => {});
  }
}

/** (Re)build the in-memory cache + console subscription for a server. */
function refresh(serverId) {
  const enabled = list(serverId).filter((r) => r.enabled);
  if (enabled.length) {
    compiledByServer.set(serverId, enabled.map((rule) => ({ rule, test: buildTest(rule) })));
    if (!subs.has(serverId)) {
      const unsub = pm.subscribe(serverId, (msg) => { if (msg.event === 'console') onConsoleLine(serverId, msg); });
      subs.set(serverId, unsub);
    }
  } else {
    compiledByServer.delete(serverId);
    const unsub = subs.get(serverId);
    if (unsub) { unsub(); subs.delete(serverId); }
  }
}

/** Boot-time: start watching every server that already has enabled rules. */
function init() {
  const ids = new Set(db.all(COLL).map((a) => a.serverId));
  for (const id of ids) refresh(id);
  if (ids.size) console.log(`[automations] watching ${ids.size} server(s) with rules`);
  return ids.size;
}

module.exports = {
  list, get, create, update, remove,
  sanitize, testLine, init, refresh, validRegex, isDangerousRegex,
  ACTIONS, MATCH_TYPES, POWER_ACTIONS,
};
