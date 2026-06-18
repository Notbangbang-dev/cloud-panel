'use strict';

/** Server creation + per-user resource accounting (used by client + admin). */

const crypto = require('crypto');
const db = require('../db');
const pm = require('./processManager');

function usedResources(userId) {
  const servers = db.filter('servers', (s) => s.ownerId === userId);
  const ids = new Set(servers.map((s) => s.id));
  return {
    memory: servers.reduce((a, s) => a + (s.limits?.memory || 0), 0),
    cpu: servers.reduce((a, s) => a + (s.limits?.cpu || 0), 0),
    disk: servers.reduce((a, s) => a + (s.limits?.disk || 0), 0),
    servers: servers.length,
    backups: db.filter('backups', (b) => ids.has(b.serverId)).length,
  };
}

function quotaFor(user) {
  const q = user.resources || {};
  return { memory: q.memory || 0, cpu: q.cpu || 0, disk: q.disk || 0, servers: q.servers || 0, backups: q.backups || 0 };
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

  const alloc = allocationId ? db.get('allocations', allocationId) : pickAllocation(nodeId);
  if (!alloc) throw new Error('No free allocation available — ask an admin to add more ports.');
  if (alloc.serverId) throw new Error('That allocation is already in use');
  const node = db.get('nodes', alloc.nodeId);

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
    limits: {
      memory: Math.floor(Number(memory) || 1024),
      swap: 0,
      disk: Math.floor(Number(disk) || 5120),
      cpu: Math.floor(Number(cpu) || 100),
      io: 500,
    },
    featureLimits: { databases: 5, backups: 5, allocations: 5 },
    environment: {
      ...(egg.variables || []).reduce((a, v) => { a[v.env] = v.default; return a; }, {}),
      ...(environment || {}),
    },
    startup: egg.startup,
    createdAt: new Date().toISOString(),
  });

  db.update('allocations', alloc.id, { serverId: server.id, primary: true });
  pm.provision(server, { trigger: 'install' }).catch(() => {});
  return server;
}

module.exports = { createServer, usedResources, availableResources, quotaFor, pickAllocation };
