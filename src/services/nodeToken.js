'use strict';

/**
 * Panel ↔ Daemon authentication tokens.
 *
 * Each node has its OWN 48-byte secret (`node.daemonToken`), separate from the
 * panel's CP_JWT_SECRET. The panel signs short-lived JWTs with a node's token to
 * call that node's daemon; the daemon verifies with the same token (configured as
 * CP_DAEMON_TOKEN). A leaked node token therefore compromises only that one node.
 *
 * Two directions, one shared per-node secret:
 *   - panel → daemon : { iss:'panel', nodeId, sub }   (sub = serverId or '*')
 *   - daemon → panel : { iss:'daemon', nodeId }        (heartbeat)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ALG = 'HS256';
const TTL_SECONDS = 60; // requests are short-lived; clocks within a minute

/** Generate a fresh per-node secret. */
function generateNodeToken() {
  return crypto.randomBytes(48).toString('hex');
}

/** Panel-side: sign a request token for a node (sub = serverId or '*'). */
function signPanelToken(node, sub = '*') {
  if (!node || !node.daemonToken) throw new Error('Node has no daemonToken');
  return jwt.sign({ iss: 'panel', nodeId: node.id, sub: String(sub) }, node.daemonToken, {
    algorithm: ALG,
    expiresIn: TTL_SECONDS,
  });
}

/** Daemon-side: verify an inbound panel token using the daemon's own secret. */
function verifyPanelToken(token, secret) {
  if (!secret) return null;
  try {
    const p = jwt.verify(String(token || ''), secret, { algorithms: [ALG] });
    return p && p.iss === 'panel' ? p : null;
  } catch {
    return null;
  }
}

/** Daemon-side: sign a heartbeat token for the panel. */
function signDaemonToken(nodeId, secret) {
  if (!secret) throw new Error('Daemon has no token configured');
  return jwt.sign({ iss: 'daemon', nodeId }, secret, { algorithm: ALG, expiresIn: TTL_SECONDS });
}

/** Panel-side: verify a daemon's heartbeat token using that node's secret. */
function verifyDaemonToken(token, secret) {
  if (!secret) return null;
  try {
    const p = jwt.verify(String(token || ''), secret, { algorithms: [ALG] });
    return p && p.iss === 'daemon' ? p : null;
  } catch {
    return null;
  }
}

/** Extract a bearer token from an Authorization header. */
function bearer(req) {
  const h = (req && req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

module.exports = {
  TTL_SECONDS,
  generateNodeToken,
  signPanelToken,
  verifyPanelToken,
  signDaemonToken,
  verifyDaemonToken,
  bearer,
};
