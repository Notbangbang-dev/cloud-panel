'use strict';

const db = require('../db');
const pm = require('../services/processManager');
const files = require('../services/files');
const dispatch = require('../services/nodeDispatch');

/**
 * Granular per-server permissions for subusers. Owners and admins implicitly
 * hold every permission; invited subusers hold a subset chosen by the owner.
 */
const PERMISSIONS = [
  'control.console',  // view the live console + resource stats
  'control.command',  // send console commands
  'control.power',    // start / stop / restart / kill
  'file',             // browse, edit, upload & delete files
  'backup',           // create / restore / download / delete backups
  'automation',       // manage console automations
  'schedule',         // manage scheduled (cron) tasks
  'database',         // manage per-server databases
  'player',           // view the live player list, kick & ban
  'startup',          // edit startup variables
  'allocation',       // view network / SFTP details
  'settings',         // rename / status page
  'activity',         // view the server activity log
];

function subuserFor(user, server) {
  if (!user || !server) return null;
  return db.find('subusers', (s) => s.serverId === server.id && s.userId === user.id) || null;
}

/** True for the server owner or any administrator. */
function isOwner(user, server) {
  return !!(user && server && (user.admin || server.ownerId === user.id));
}

function canAccessServer(user, server) {
  if (!server || !user) return false;
  if (user.admin) return true;
  if (server.ownerId === user.id) return true;
  return !!subuserFor(user, server);
}

/** The set of permissions `user` holds on `server`. */
function serverPermissions(user, server) {
  if (isOwner(user, server)) return new Set(PERMISSIONS);
  const su = subuserFor(user, server);
  if (!su) return new Set();
  return new Set(Array.isArray(su.permissions) ? su.permissions.filter((p) => PERMISSIONS.includes(p)) : []);
}

function hasPermission(user, server, perm) {
  if (isOwner(user, server)) return true;
  return serverPermissions(user, server).has(perm);
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

function serializeServer(server, { detail = false, user = null } = {}) {
  const node = db.get('nodes', server.nodeId);
  const egg = db.get('eggs', server.eggId);
  const owner = db.get('users', server.ownerId);
  const primary = db.get('allocations', server.allocationId);
  // Dispatch shim: local → pm.state (today's path); remote → cached daemon state.
  const state = dispatch.state(server);
  const resources = {
    ...state.stats,
    // Local disk is measured live; remote disk comes from the daemon's stats.
    disk: dispatch.isLocalServer(server) ? files.diskUsage(server) : (state.stats.disk || 0),
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
    autoStart: server.autoStart !== false,
    autoRestart: server.autoRestart !== false,
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

  // When a viewer is supplied, tell the UI whether they're the owner/admin and
  // exactly which permissions they hold (so it can hide tabs/actions).
  if (user) {
    base.access = {
      owner: isOwner(user, server),
      permissions: [...serverPermissions(user, server)],
    };
  }

  if (!detail) return base;

  const additional = (server.additionalAllocationIds || [])
    .map((id) => serializeAllocation(db.get('allocations', id)))
    .filter(Boolean);

  return {
    ...base,
    startup: server.startup,
    environment: server.environment,
    javaVersion: server.javaVersion ?? null,
    console: server.console || null,
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
  // Never leak the node's daemon secret in normal serialization.
  const { daemonToken, ...safe } = node;
  // A node with no daemon token is the local/unconfigured node (servers run on
  // the panel host). A tokened node is remote: online while we hear heartbeats,
  // else stale → offline.
  let status;
  if (node.isLocal || !node.daemonToken) status = 'local';
  else if (node.lastSeen && Date.now() - new Date(node.lastSeen).getTime() > 45000) status = 'offline';
  else status = node.status || 'unknown';
  return {
    ...safe,
    hasToken: !!daemonToken,
    status,
    daemonUrl: `${node.scheme === 'https' ? 'https' : 'http'}://${node.fqdn}:${node.daemonPort}`,
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

module.exports = {
  canAccessServer, serializeServer, serializeAllocation, serializeNode,
  serverPermissions, hasPermission, isOwner, subuserFor, PERMISSIONS,
};
