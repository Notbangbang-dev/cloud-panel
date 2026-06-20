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

module.exports = { update, configOf, findBySlug, publicView, slugify };
