'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const nodeClient = require('../src/services/nodeClient');
const nodeToken = require('../src/services/nodeToken');

const node = { id: 'node_1', name: 'N', fqdn: '127.0.0.1', scheme: 'http', daemonPort: 8090, daemonToken: nodeToken.generateNodeToken() };

test('nodeBaseUrl builds scheme://fqdn:port', () => {
  assert.equal(nodeClient.nodeBaseUrl(node), 'http://127.0.0.1:8090');
  assert.equal(nodeClient.nodeBaseUrl({ ...node, scheme: 'https' }), 'https://127.0.0.1:8090');
});

test('daemonFetch reaches a LOOPBACK node (where safeFetch refuses) with a valid Bearer token', async () => {
  const captured = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    captured.url = url;
    captured.auth = opts.headers.Authorization;
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: 'pong' }) };
  };
  try {
    const r = await nodeClient.daemonFetch(node, 'GET', '/api/daemon/health', { sub: '*' });
    assert.equal(r.data, 'pong');
    assert.equal(captured.url, 'http://127.0.0.1:8090/api/daemon/health');
    assert.match(captured.auth, /^Bearer /);
    // The signed token must verify with this node's own secret.
    const tok = captured.auth.replace(/^Bearer /, '');
    assert.ok(nodeToken.verifyPanelToken(tok, node.daemonToken), 'panel token verifies with the node secret');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('daemonFetch throws a status error on non-2xx', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: 'not found' }) });
  try {
    await assert.rejects(() => nodeClient.daemonFetch(node, 'GET', '/x'), /not found/);
  } finally { globalThis.fetch = realFetch; }
});
