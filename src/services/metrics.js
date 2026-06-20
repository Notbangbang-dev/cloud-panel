'use strict';

/**
 * Historical metrics — records each server's CPU / memory / disk and online
 * state on a steady 60-second cadence, so the panel can draw real time-series
 * graphs (not just the live sparklines) and compute uptime for status pages.
 *
 * Storage: a compact, capped ring buffer per server, persisted to
 * data/metrics/<serverId>.json. No extra database tables, no heavy writes.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('./../db');
const pm = require('./processManager');

const DIR = path.join(config.dataDir, 'metrics');
const INTERVAL_MS = 60 * 1000;
const RETAIN = 4320;            // 3 days at 1-minute resolution
const PERSIST_EVERY = 5;        // flush to disk every N ticks (~5 min)

const series = new Map();       // serverId -> [{ t, cpu, mem, disk, up }]
const dirty = new Set();
let timer = null;
let ticks = 0;

function fileFor(serverId) {
  return path.join(DIR, serverId + '.json');
}

function loadServer(serverId) {
  if (series.has(serverId)) return series.get(serverId);
  let points = [];
  try {
    const raw = fs.readFileSync(fileFor(serverId), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) points = parsed;
  } catch { /* no history yet */ }
  series.set(serverId, points);
  return points;
}

function persist(serverId) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = fileFor(serverId) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(series.get(serverId) || []));
    fs.renameSync(tmp, fileFor(serverId));
  } catch (err) {
    console.error('[metrics] persist failed:', err.message);
  }
}

function record() {
  const now = Date.now();
  for (const s of db.all('servers')) {
    const st = pm.state(s.id);
    const points = loadServer(s.id);
    points.push({
      t: now,
      cpu: Math.round((st.stats.cpu || 0) * 10) / 10,
      mem: st.stats.memory || 0,
      disk: st.stats.disk || 0,
      up: st.status === 'running' ? 1 : 0,
    });
    if (points.length > RETAIN) points.splice(0, points.length - RETAIN);
    dirty.add(s.id);
  }
}

function tick() {
  try { record(); } catch (err) { console.error('[metrics] sample failed:', err.message); }
  if (++ticks % PERSIST_EVERY === 0) flush();
}

function flush() {
  for (const id of dirty) persist(id);
  dirty.clear();
}

/** Average a series down to at most `max` buckets for charting. */
function downsample(points, max) {
  if (points.length <= max) return points;
  const bucket = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += bucket) {
    const slice = points.slice(i, i + bucket);
    const avg = (k) => slice.reduce((a, p) => a + (p[k] || 0), 0) / slice.length;
    out.push({
      t: slice[slice.length - 1].t,
      cpu: Math.round(avg('cpu') * 10) / 10,
      mem: Math.round(avg('mem')),
      disk: Math.round(avg('disk')),
      up: avg('up'),
    });
  }
  return out;
}

/** Time-series for a server over the last `rangeSeconds` (default 24h). */
function get(serverId, { rangeSeconds = 86400, points = 180 } = {}) {
  const all = loadServer(serverId);
  const cutoff = Date.now() - rangeSeconds * 1000;
  const filtered = all.filter((p) => p.t >= cutoff);
  return downsample(filtered, points);
}

/** Quick aggregate (uptime %, peaks) for a server over the last `rangeSeconds`. */
function summary(serverId, rangeSeconds = 86400) {
  const all = loadServer(serverId);
  const cutoff = Date.now() - rangeSeconds * 1000;
  const pts = all.filter((p) => p.t >= cutoff);
  if (!pts.length) return { uptimePercent: null, samples: 0, peakCpu: 0, peakMem: 0 };
  const upCount = pts.reduce((a, p) => a + (p.up ? 1 : 0), 0);
  return {
    uptimePercent: Math.round((upCount / pts.length) * 1000) / 10,
    samples: pts.length,
    peakCpu: Math.max(...pts.map((p) => p.cpu || 0)),
    peakMem: Math.max(...pts.map((p) => p.mem || 0)),
  };
}

function removeForServer(serverId) {
  series.delete(serverId);
  dirty.delete(serverId);
  try { fs.rmSync(fileFor(serverId), { force: true }); } catch {}
}

function init() {
  if (timer) return;
  fs.mkdirSync(DIR, { recursive: true });
  timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log('[metrics] recording server history every 60s →', DIR);
}

module.exports = { init, get, summary, flush, removeForServer, tick };
