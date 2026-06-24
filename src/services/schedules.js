'use strict';

/**
 * Scheduled tasks (cron) — the time-based sibling of console Automations.
 * Run a console command, power action, or create a backup on a schedule:
 * a nightly restart, a 3am backup, timed announcements, and so on.
 *
 *   cron:  "minute hour day-of-month month day-of-week"  (standard 5-field)
 *   action: command | power | backup
 *
 * A single shared 30-second tick evaluates every enabled schedule; each is run
 * at most once per matching minute (tracked in-memory + persisted lastRunAt).
 */

const db = require('../db');
const pm = require('./processManager');

const COLL = 'schedules';
const ACTIONS = ['command', 'power', 'backup'];
const POWER_ACTIONS = ['start', 'stop', 'restart', 'kill'];
const FIELD_BOUNDS = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6],  // day of week (0 = Sunday)
];

let timer = null;
const lastRunKey = new Map(); // scheduleId -> "YYYY-MM-DDTHH:MM" of last fire

/* ---- cron parsing -------------------------------------------------------- */

/** Parse one cron field into a sorted array of allowed integers. */
function parseField(field, [min, max]) {
  const out = new Set();
  for (const part of String(field).split(',')) {
    const piece = part.trim();
    if (!piece) throw new Error('Empty cron field');
    let range = piece;
    let step = 1;
    const slash = piece.indexOf('/');
    if (slash !== -1) {
      range = piece.slice(0, slash);
      step = parseInt(piece.slice(slash + 1), 10);
      if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${piece}"`);
    }
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const dash = range.indexOf('-');
      if (dash !== -1) {
        lo = parseInt(range.slice(0, dash), 10);
        hi = parseInt(range.slice(dash + 1), 10);
      } else {
        lo = hi = parseInt(range, 10);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi)
        throw new Error(`Cron value out of range in "${piece}" (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Parse a full 5-field cron expression. Throws on anything invalid. */
function parseCron(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron must have 5 fields: minute hour day-of-month month day-of-week');
  return {
    minute: parseField(fields[0], FIELD_BOUNDS[0]),
    hour: parseField(fields[1], FIELD_BOUNDS[1]),
    dom: parseField(fields[2], FIELD_BOUNDS[2]),
    month: parseField(fields[3], FIELD_BOUNDS[3]),
    dow: parseField(fields[4], FIELD_BOUNDS[4]),
    raw: { dom: fields[2].trim(), dow: fields[4].trim() },
  };
}

/** Does a Date match the parsed cron expression? */
function matches(parsed, date) {
  if (!parsed.minute.includes(date.getMinutes())) return false;
  if (!parsed.hour.includes(date.getHours())) return false;
  if (!parsed.month.includes(date.getMonth() + 1)) return false;
  const domMatch = parsed.dom.includes(date.getDate());
  const dowMatch = parsed.dow.includes(date.getDay());
  // Vixie-cron rule: if BOTH day fields are restricted, match on EITHER.
  const domRestricted = parsed.raw.dom !== '*';
  const dowRestricted = parsed.raw.dow !== '*';
  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

/** Next fire time at/after `from` (minute resolution); null if none within a year. */
function nextRun(expr, from = new Date()) {
  let parsed;
  try { parsed = parseCron(expr); } catch { return null; }
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(parsed, d)) return d.toISOString();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/* ---- validation + CRUD --------------------------------------------------- */

function sanitize(input) {
  const a = input && typeof input === 'object' ? input : {};
  const cron = (typeof a.cron === 'string' ? a.cron : '').trim();
  parseCron(cron); // throws if invalid

  const action = ACTIONS.includes(a.action) ? a.action : 'command';
  let value = typeof a.value === 'string' ? a.value.trim() : '';
  if (action === 'command') {
    if (!value) throw new Error('A console command is required.');
    value = value.slice(0, 500);
  } else if (action === 'power') {
    if (!POWER_ACTIONS.includes(value)) value = 'restart';
  } else if (action === 'backup') {
    value = (value || 'Scheduled backup').slice(0, 60);
  }

  return {
    name: ((typeof a.name === 'string' && a.name.trim()) || 'Schedule').slice(0, 60),
    enabled: a.enabled === undefined ? true : !!a.enabled,
    cron,
    action,
    value,
    onlyWhenOnline: !!a.onlyWhenOnline,
  };
}

const list = (serverId) =>
  db.filter(COLL, (s) => s.serverId === serverId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((s) => ({ ...s, nextRunAt: s.enabled ? nextRun(s.cron) : null }));

const get = (id) => db.get(COLL, id);

function create(serverId, input) {
  const clean = sanitize(input);
  const row = db.insert(COLL, {
    id: db.uid('sched'), serverId, createdAt: new Date().toISOString(),
    fireCount: 0, lastRunAt: null, ...clean,
  });
  return { ...row, nextRunAt: row.enabled ? nextRun(row.cron) : null };
}

function update(id, input) {
  const cur = db.get(COLL, id);
  if (!cur) return null;
  const clean = sanitize({ ...cur, ...input });
  const row = db.update(COLL, id, clean);
  return { ...row, nextRunAt: row.enabled ? nextRun(row.cron) : null };
}

function remove(id) {
  lastRunKey.delete(id);
  return db.remove(COLL, id);
}

function removeAllForServer(serverId) {
  for (const s of db.filter(COLL, (x) => x.serverId === serverId)) remove(s.id);
}

/* ---- engine -------------------------------------------------------------- */

async function runOne(schedule) {
  const server = db.get('servers', schedule.serverId);
  if (!server) return;
  const status = pm.state(server.id).status;
  if (schedule.onlyWhenOnline && status !== 'running') return;

  try {
    if (schedule.action === 'command') {
      pm.command(server.id, schedule.value);
    } else if (schedule.action === 'power') {
      await pm.power(server, schedule.value);
    } else if (schedule.action === 'backup') {
      const backups = require('./backups'); // lazy require to avoid load-order cost
      await backups.create(server, { name: schedule.value || 'Scheduled backup', createdBy: null });
    }
    db.update(COLL, schedule.id, { fireCount: (schedule.fireCount || 0) + 1, lastRunAt: new Date().toISOString() });
    db.log({ type: 'schedule', serverId: server.id, message: `Schedule '${schedule.name}' ran → ${schedule.action}${schedule.action === 'command' ? ': ' + schedule.value : schedule.action === 'power' ? ': ' + schedule.value : ''}` });
  } catch (err) {
    db.log({ type: 'schedule', serverId: server.id, message: `Schedule '${schedule.name}' failed: ${err.message}` });
  }
}

function tick() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16); // minute resolution
  for (const s of db.all(COLL)) {
    if (!s.enabled) continue;
    if (lastRunKey.get(s.id) === stamp) continue; // already fired this minute
    let parsed;
    try { parsed = parseCron(s.cron); } catch { continue; }
    if (!matches(parsed, now)) continue;
    lastRunKey.set(s.id, stamp);
    runOne(s).catch(() => {});
  }
}

function init() {
  if (timer) return;
  timer = setInterval(tick, 30000);
  if (timer.unref) timer.unref();
  const count = db.all(COLL).filter((s) => s.enabled).length;
  if (count) console.log(`[schedules] ${count} active schedule(s)`);
  return count;
}

module.exports = {
  list, get, create, update, remove, removeAllForServer,
  parseCron, nextRun, sanitize, init, tick,
  ACTIONS, POWER_ACTIONS,
};
