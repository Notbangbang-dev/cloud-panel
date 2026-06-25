'use strict';

/**
 * Transport to a remote node daemon (panel side).
 *
 * NOTE: this deliberately does NOT go through nettrust.safeFetch. That guard
 * blocks loopback/RFC1918/CGNAT — exactly where node daemons live — to stop SSRF
 * via *user-influenced* URLs (modpacks, webhooks). Node daemon URLs are
 * operator-registered admin config, not user content, so the SSRF rationale
 * doesn't apply here. This client is used ONLY for panel↔daemon traffic.
 */

const WebSocket = require('ws');
const nodeToken = require('./nodeToken');

/** Base URL of a node's daemon, e.g. https://1.2.3.4:8080 */
function nodeBaseUrl(node) {
  const scheme = node.scheme === 'https' ? 'https' : 'http';
  return `${scheme}://${node.fqdn}:${node.daemonPort}`;
}

/** Authenticated JSON request to a node daemon. Throws on non-2xx. */
async function daemonFetch(node, method, pathName, { body, sub = '*', timeoutMs = 20000, headers = {} } = {}) {
  const url = nodeBaseUrl(node) + pathName;
  const token = nodeToken.signPanelToken(node, sub);
  const opts = {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: 'Bearer ' + token, ...headers },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `daemon responded ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Stream a request body (e.g. a file upload) to a node daemon. */
async function daemonUpload(node, sub, pathName, readable, { timeoutMs = 0 } = {}) {
  const url = nodeBaseUrl(node) + pathName;
  const token = nodeToken.signPanelToken(node, sub);
  const opts = {
    method: 'POST',
    redirect: 'error',
    duplex: 'half', // required by undici when body is a stream
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
    body: readable,
  };
  if (timeoutMs) opts.signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) { const e = new Error((data && data.error) || `daemon responded ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/** Open a WebSocket to a node daemon's console proxy for a server. */
function openDaemonWs(node, serverId) {
  const wsBase = nodeBaseUrl(node).replace(/^http/, 'ws');
  const token = nodeToken.signPanelToken(node, serverId);
  const url = `${wsBase}/api/daemon/servers/${encodeURIComponent(serverId)}/ws?token=${encodeURIComponent(token)}`;
  return new WebSocket(url);
}

/** Lightweight reachability/health probe (used by the heartbeat-less status check). */
async function health(node) {
  return daemonFetch(node, 'GET', '/api/daemon/health', { timeoutMs: 8000 });
}

module.exports = { nodeBaseUrl, daemonFetch, daemonUpload, openDaemonWs, health };
