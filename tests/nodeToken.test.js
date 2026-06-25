'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const nt = require('../src/services/nodeToken');

const node = { id: 'node_abc', daemonToken: nt.generateNodeToken() };

test('generateNodeToken produces a long unique hex secret', () => {
  const a = nt.generateNodeToken();
  const b = nt.generateNodeToken();
  assert.match(a, /^[0-9a-f]{96}$/);
  assert.notEqual(a, b);
});

test('panel→daemon token round-trips with the node secret', () => {
  const tok = nt.signPanelToken(node, 'srv_1');
  const p = nt.verifyPanelToken(tok, node.daemonToken);
  assert.ok(p, 'verifies with the right secret');
  assert.equal(p.iss, 'panel');
  assert.equal(p.nodeId, 'node_abc');
  assert.equal(p.sub, 'srv_1');
});

test('a wrong secret rejects the token', () => {
  const tok = nt.signPanelToken(node, '*');
  assert.equal(nt.verifyPanelToken(tok, nt.generateNodeToken()), null);
  assert.equal(nt.verifyPanelToken(tok, ''), null);
  assert.equal(nt.verifyPanelToken('garbage', node.daemonToken), null);
});

test('issuer direction is enforced (panel vs daemon are not interchangeable)', () => {
  const panelTok = nt.signPanelToken(node, '*');
  const daemonTok = nt.signDaemonToken(node.id, node.daemonToken);
  // A daemon token must not pass panel verification, and vice-versa.
  assert.equal(nt.verifyPanelToken(daemonTok, node.daemonToken), null);
  assert.equal(nt.verifyDaemonToken(panelTok, node.daemonToken), null);
  // Each verifies in its own direction.
  assert.ok(nt.verifyDaemonToken(daemonTok, node.daemonToken));
  assert.ok(nt.verifyPanelToken(panelTok, node.daemonToken));
});

test('bearer() extracts the Authorization token', () => {
  assert.equal(nt.bearer({ headers: { authorization: 'Bearer abc.def' } }), 'abc.def');
  assert.equal(nt.bearer({ headers: {} }), null);
});
