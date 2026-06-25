'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const dispatch = require('../src/services/nodeDispatch');
const pm = require('../src/services/processManager');
const nodeClient = require('../src/services/nodeClient');

test('isLocalServer: local node = local; remote node with a token = remote', () => {
  const local = db.insert('nodes', { id: 'nd_local_' + Date.now(), name: 'L', fqdn: '127.0.0.1', scheme: 'http', daemonPort: 8080, isLocal: true });
  const remote = db.insert('nodes', { id: 'nd_remote_' + Date.now(), name: 'R', fqdn: '10.0.0.9', scheme: 'http', daemonPort: 8090, isLocal: false, daemonToken: 'ab'.repeat(48) });
  assert.equal(dispatch.isLocalServer({ id: 's1', nodeId: local.id }), true);
  assert.equal(dispatch.isLocalServer({ id: 's2', nodeId: remote.id }), false);
  assert.equal(dispatch.isLocalServer({ id: 's3', nodeId: null }), true, 'no node → local');
  db.remove('nodes', local.id); db.remove('nodes', remote.id);
});

test('a node without a daemon token is treated as local (backward compat)', () => {
  const legacy = db.insert('nodes', { id: 'nd_legacy_' + Date.now(), name: 'legacy', fqdn: '1.2.3.4', daemonPort: 8080 });
  assert.equal(dispatch.isLocalServer({ id: 's', nodeId: legacy.id }), true);
  db.remove('nodes', legacy.id);
});

test('power() dispatches local→pm and remote→nodeClient', async () => {
  const local = db.insert('nodes', { id: 'nd_l2_' + Date.now(), name: 'L', fqdn: '127.0.0.1', daemonPort: 8080, isLocal: true });
  const remote = db.insert('nodes', { id: 'nd_r2_' + Date.now(), name: 'R', fqdn: '10.0.0.9', daemonPort: 8090, isLocal: false, daemonToken: 'cd'.repeat(48) });
  const localSrv = { id: 'srvL', nodeId: local.id };
  const remoteSrv = { id: 'srvR', nodeId: remote.id };

  const realPower = pm.power;
  const realFetch = nodeClient.daemonFetch;
  const seen = [];
  pm.power = (s, a) => { seen.push(['local', s.id, a]); return { ok: true, via: 'local' }; };
  nodeClient.daemonFetch = async (node, m, p) => { seen.push(['remote', node.id, p]); return { ok: true, via: 'remote' }; };
  try {
    assert.equal((await dispatch.power(localSrv, 'start')).via, 'local');
    assert.equal((await dispatch.power(remoteSrv, 'start')).via, 'remote');
    assert.ok(seen.some((c) => c[0] === 'local' && c[1] === 'srvL'));
    assert.ok(seen.some((c) => c[0] === 'remote' && c[1] === remote.id && /\/power$/.test(c[2])));
  } finally {
    pm.power = realPower; nodeClient.daemonFetch = realFetch;
    db.remove('nodes', local.id); db.remove('nodes', remote.id);
  }
});

test('an unreachable remote node returns a friendly error, never throws', async () => {
  const remote = db.insert('nodes', { id: 'nd_down_' + Date.now(), name: 'Down', fqdn: '10.0.0.250', daemonPort: 8099, isLocal: false, daemonToken: 'ef'.repeat(48) });
  const realFetch = nodeClient.daemonFetch;
  nodeClient.daemonFetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await dispatch.power({ id: 'sx', nodeId: remote.id }, 'start');
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable|Down/);
  } finally { nodeClient.daemonFetch = realFetch; db.remove('nodes', remote.id); }
});
