'use strict';

const db = require('../db');
const pm = require('../services/processManager');
const files = require('../services/files');

function canAccessServer(user, server) {
  if (!server) return false;
  if (user.admin) return true;
  return server.ownerId === user.id;
}

function serializeAllocation(a) {
  if (!a) return null;
  return {
    id: a.id,
    ip: a.ip,
    alias: a.alias,
    port: a.port,
    primary: a.primary,
    notation: `${a.alias || a.ip}:${a.port}`,
  };
}

function serializeServer(server, { detail = false } = {}) {
  const node = db.get('nodes', server.nodeId);
  const egg = db.get('eggs', server.eggId);
  const owner = db.get('users', server.ownerId);
  const primary = db.get('allocations', server.allocationId);
  const state = pm.state(server.id);
  const resources = {
    ...state.stats,
    disk: files.diskUsage(server),
    diskLimit: (server.limits?.disk || 0) * 1024 * 1024,
  };

  const base = {
    id: server.id,
    uuid: server.uuid,
    identifier: server.identifier,
    name: server.name,
    description: server.description,
    status: state.status,
    suspended: server.suspended,
    limits: server.limits,
    featureLimits: server.featureLimits,
    node: node ? { id: node.id, name: node.name } : null,
    egg: egg ? { id: egg.id, name: egg.name, category: egg.category } : null,
    owner: owner
      ? { id: owner.id, username: owner.username, email: owner.email }
      : null,
    allocation: serializeAllocation(primary),
    resources,
    createdAt: server.createdAt,
  };

  if (!detail) return base;

  const additional = (server.additionalAllocationIds || [])
    .map((id) => serializeAllocation(db.get('allocations', id)))
    .filter(Boolean);

  return {
    ...base,
    startup: server.startup,
    environment: server.environment,
    additionalAllocations: additional,
    eggDetail: egg
      ? { id: egg.id, name: egg.name, docker: egg.docker, variables: egg.variables, stopCommand: egg.stopCommand, installer: egg.installer || 'none' }
      : null,
  };
}

function serializeNode(node) {
  const loc = db.get('locations', node.locationId);
  const servers = db.filter('servers', (s) => s.nodeId === node.id);
  const usedMemory = servers.reduce((sum, s) => sum + (s.limits?.memory || 0), 0);
  const usedDisk = servers.reduce((sum, s) => sum + (s.limits?.disk || 0), 0);
  const allocations = db.filter('allocations', (a) => a.nodeId === node.id);
  return {
    ...node,
    location: loc ? { id: loc.id, short: loc.short, long: loc.long } : null,
    serverCount: servers.length,
    allocationCount: allocations.length,
    allocationsUsed: allocations.filter((a) => a.serverId).length,
    usage: {
      memory: usedMemory,
      memoryMax: node.memory,
      disk: usedDisk,
      diskMax: node.disk,
    },
  };
}

module.exports = { canAccessServer, serializeServer, serializeAllocation, serializeNode };
