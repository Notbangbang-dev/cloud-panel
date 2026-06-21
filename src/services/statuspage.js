'use strict';

/**
 * Public status pages — a shareable, read-only page per server showing live
 * status, player count and (optionally) uptime/resources, without requiring a
 * login. Each server opts in and gets a stable public slug.
 */

const crypto = require('crypto');
const db = require('../db');
const pm = require('./processManager');
const players = require('./players');
const metrics = require('./metrics');
const files = require('./files');

function slugify(name) {
  return String(name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server';
}

function uniqueSlug(server) {
  const base = slugify(server.name);
  let slug = base;
  for (let i = 0; db.find('servers', (s) => s.id !== server.id && s.statusPage && s.statusPage.slug === slug); i++) {
    slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return slug;
}

const configOf = (server) =>
  server.statusPage || { enabled: false, slug: null, showPlayers: true, showResources: false };

/** Update a server's status-page config; mints a slug on first enable. */
function update(server, patch = {}) {
  const cur = configOf(server);
  const next = {
    enabled: patch.enabled === undefined ? cur.enabled : !!patch.enabled,
    slug: cur.slug,
    showPlayers: patch.showPlayers === undefined ? cur.showPlayers : !!patch.showPlayers,
    showResources: patch.showResources === undefined ? cur.showResources : !!patch.showResources,
  };
  if (next.enabled && !next.slug) next.slug = uniqueSlug(server);
  db.update('servers', server.id, { statusPage: next });
  return next;
}

const findBySlug = (slug) =>
  db.find('servers', (s) => s.statusPage && s.statusPage.enabled && s.statusPage.slug === String(slug || '').toLowerCase());

/** Read-only public view (no secrets, no internal ids). */
function publicView(server) {
  const cfg = configOf(server);
  const state = pm.state(server.id);
  const egg = db.get('eggs', server.eggId);
  const alloc = db.get('allocations', server.allocationId);
  const out = {
    name: server.name,
    description: server.description || '',
    status: state.status,
    egg: egg ? egg.name : null,
    uptime: state.status === 'running' ? state.stats.uptime : 0,
    address: alloc ? `${alloc.alias || alloc.ip}:${alloc.port}` : null,
    updatedAt: new Date().toISOString(),
  };
  if (cfg.showPlayers) {
    const roster = players.list(server.id);
    out.players = { count: roster.count, online: roster.online.map((p) => p.name) };
  }
  if (cfg.showResources) {
    out.resources = {
      cpu: state.stats.cpu || 0,
      memory: state.stats.memory || 0,
      memoryLimit: (server.limits && server.limits.memory ? server.limits.memory : 0) * 1024 * 1024,
    };
    out.uptime24h = metrics.summary(server.id, 86400).uptimePercent;
  }
  return out;
}

/**
 * Panel-wide network status (the public /status overview). Aggregates live
 * usage across every server, grouped per node. Returns null when disabled.
 */
function overview() {
  const cfg = db.settings().statusOverview || {};
  if (!cfg.enabled) return null;

  const servers = db.all('servers');
  const nodes = db.all('nodes');
  const locs = {};
  db.all('locations').forEach((l) => { locs[l.id] = l; });

  let online = 0, crashed = 0, playerCount = 0, totalCpu = 0, totalMem = 0, totalDisk = 0, upSum = 0, upCount = 0;
  const perNode = {};

  for (const s of servers) {
    const st = pm.state(s.id);
    const stats = st.stats || {};
    const running = st.status === 'running';
    let disk = 0; try { disk = files.diskUsage(s); } catch {}
    if (running) { online++; totalCpu += stats.cpu || 0; totalMem += stats.memory || 0; }
    if (st.status === 'crashed') crashed++;
    totalDisk += disk;
    try { playerCount += players.list(s.id).count || 0; } catch {}
    try { const u = metrics.summary(s.id, 86400).uptimePercent; if (u != null) { upSum += u; upCount++; } } catch {}
    const n = (perNode[s.nodeId] = perNode[s.nodeId] || { cpu: 0, mem: 0, disk: 0, servers: 0, online: 0 });
    n.servers++; n.disk += disk;
    if (running) { n.online++; n.cpu += stats.cpu || 0; n.mem += stats.memory || 0; }
  }

  let memTotal = 0, diskTotal = 0;
  const nodeOut = nodes.map((nd) => {
    const a = perNode[nd.id] || { cpu: 0, mem: 0, disk: 0, servers: 0, online: 0 };
    const memMax = (nd.memory || 0) * 1024 * 1024;
    const diskMax = (nd.disk || 0) * 1024 * 1024;
    memTotal += memMax; diskTotal += diskMax;
    const loc = locs[nd.locationId];
    return {
      name: nd.name,
      location: loc ? (loc.short || loc.long) : null,
      online: true, // panel-managed: reachable while the panel is up
      servers: a.servers,
      serversOnline: a.online,
      cpu: Math.round(a.cpu * 10) / 10,
      memUsed: a.mem, memMax,
      diskUsed: a.disk, diskMax,
    };
  });

  return {
    title: cfg.title || 'Network Status',
    status: crashed > 0 ? 'degraded' : 'operational',
    updatedAt: new Date().toISOString(),
    totals: {
      servers: servers.length,
      online,
      players: playerCount,
      cpu: Math.round(totalCpu * 10) / 10,
      memUsed: totalMem, memTotal,
      diskUsed: totalDisk, diskTotal,
      uptime24h: upCount ? Math.round((upSum / upCount) * 10) / 10 : null,
      nodes: nodes.length,
      nodesOnline: nodes.length,
    },
    nodes: nodeOut,
  };
}

module.exports = { update, configOf, findBySlug, publicView, overview, slugify };
