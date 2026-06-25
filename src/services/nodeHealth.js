'use strict';

/**
 * Active node health probing (panel role).
 *
 * Daemons push a heartbeat every ~15s, but the panel also pulls each tokened
 * node's /api/daemon/health on an interval so status is fresh + accurate even
 * when a heartbeat is missed, and a node shows ONLINE immediately after it's
 * added (without waiting for the first heartbeat). Marks a node offline only
 * when both the probe fails AND no recent heartbeat was seen.
 */

const db = require('../db');
const config = require('../config');
const nodeClient = require('./nodeClient');

let timer = null;

async function probeNode(node) {
  try {
    const h = await nodeClient.health(node);
    db.update('nodes', node.id, {
      status: 'online',
      lastSeen: new Date().toISOString(),
      daemonVersion: (h && h.version) || node.daemonVersion || null,
      daemonRunning: (h && Array.isArray(h.servers)) ? h.servers.length : (node.daemonRunning || 0),
    });
    return true;
  } catch {
    const recentHeartbeat = node.lastSeen && Date.now() - new Date(node.lastSeen).getTime() < 45000;
    if (!recentHeartbeat && node.status !== 'offline') db.update('nodes', node.id, { status: 'offline' });
    return false;
  }
}

async function probeAll() {
  const nodes = db.all('nodes').filter((n) => n.daemonToken && !n.isLocal);
  await Promise.all(nodes.map((n) => probeNode(n)));
}

function start() {
  if (config.role !== 'panel') return;
  probeAll().catch(() => {});
  timer = setInterval(() => probeAll().catch(() => {}), 20000);
  if (timer.unref) timer.unref();
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, probeNode, probeAll };
