'use strict';

/** Server creation + per-user resource accounting (used by client + admin). */

const crypto = require('crypto');
const db = require('../db');
const pm = require('./processManager');

function usedResources(userId) {
  const servers = db.filter('servers', (s) => s.ownerId === userId);
  return {
    memory: servers.reduce((a, s) => a + (s.limits?.memory || 0), 0),
    cpu: servers.reduce((a, s) => a + (s.limits?.cpu || 0), 0),
    disk: servers.reduce((a, s) => a + (s.limits?.disk || 0), 0),
    servers: servers.length,
    // v2: backups & databases are allocated per-server (featureLimits) and
    // drawn from the account quota — so "used" is the sum of those allocations.
    backups: servers.reduce((a, s) => a + (s.featureLimits?.backups || 0), 0),
    databases: servers.reduce((a, s) => a + (s.featureLimits?.databases || 0), 0),
  };
}

function quotaFor(user) {
  const q = user.resources || {};
  return {
    memory: q.memory || 0, cpu: q.cpu || 0, disk: q.disk || 0,
    servers: q.servers || 0, backups: q.backups || 0, databases: q.databases || 0,
  };
}

function availableResources(user) {
  const q = quotaFor(user);
  const used = usedResources(user.id);
  return {
    memory: q.memory - used.memory,
    cpu: q.cpu - used.cpu,
    disk: q.disk - used.disk,
    servers: q.servers - used.servers,
    backups: q.backups - used.backups,
    databases: q.databases - used.databases,
  };
}

function pickAllocation(nodeId) {
  if (nodeId) return db.find('allocations', (a) => a.nodeId === nodeId && !a.serverId);
  return db.find('allocations', (a) => !a.serverId);
}

function createServer({ name, ownerId, eggId, nodeId, allocationId, memory, cpu, disk, environment }) {
  const owner = db.get('users', ownerId);
  if (!owner) throw new Error('Owner not found');
  const egg = db.get('eggs', eggId);
  if (!egg) throw new Error('Invalid egg selected');

  // Reject control characters (incl. CR/LF) in environment values (R2).
  if (environment && typeof environment === 'object') {
    for (const v of Object.values(environment)) {
      if (typeof v === 'string' && /[\u0000-\u001f\u007f]/.test(v))
        throw new Error('Environment values cannot contain control characters.');
    }
  }

  const alloc = allocationId ? db.get('allocations', allocationId) : pickAllocation(nodeId);
  if (!alloc) throw new Error('No free allocation available — ask an admin to add more ports.');
  if (alloc.serverId) throw new Error('That allocation is already in use');
  const node = db.get('nodes', alloc.nodeId);

  // Allocate backup/database feature limits from whatever quota the owner has
  // left (default 1 each), so creation never pushes the account over quota.
  const avail = availableResources(owner);
  const server = db.insert('servers', {
    id: db.uid('srv'),
    uuid: db.uuid(),
    identifier: crypto.randomBytes(4).toString('hex'),
    name: (name && String(name).trim()) || 'New Server',
    description: '',
    ownerId: owner.id,
    nodeId: node.id,
    eggId: egg.id,
    allocationId: alloc.id,
    additionalAllocationIds: [],
    status: 'offline',
    suspended: false,
    autoStart: true,   // resume on panel boot if it was running before shutdown
    autoRestart: true, // auto-restart on crash (rate-capped)
    limits: {
      memory: Math.floor(Number(memory) || 1024),
      swap: 0,
      disk: Math.floor(Number(disk) || 5120),
      cpu: Math.floor(Number(cpu) || 100),
      io: 500,
    },
    featureLimits: {
      databases: Math.max(0, Math.min(1, avail.databases)),
      backups: Math.max(0, Math.min(1, avail.backups)),
      allocations: 5,
    },
    environment: {
      ...(egg.variables || []).reduce((a, v) => { a[v.env] = v.default; return a; }, {}),
      ...(environment || {}),
    },
    startup: egg.startup,
    createdAt: new Date().toISOString(),
  });

  db.update('allocations', alloc.id, { serverId: server.id, primary: true });
  // Provisioning marks the server 'install_failed' on error (see processManager);
  // log any unexpected rejection too instead of swallowing it.
  pm.provision(server, { trigger: 'install' }).catch((e) => {
    db.log({ type: 'install', serverId: server.id, message: `Install error: ${(e && e.message) || e}` });
  });
  try { require('./players').watch(server.id); } catch {}
  return server;
}

module.exports = { createServer, usedResources, availableResources, quotaFor, pickAllocation };
