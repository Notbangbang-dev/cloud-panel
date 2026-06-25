'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const pm = require('../src/services/processManager');

test('reconcile() resets stale statuses to offline and returns the running set', () => {
  const run = 'pm_run_' + Date.now();
  const off = 'pm_off_' + Date.now();
  const crash = 'pm_crash_' + Date.now();
  db.insert('servers', { id: run, name: run, status: 'running', suspended: false, autoStart: true });
  db.insert('servers', { id: off, name: off, status: 'offline', suspended: false, autoStart: true });
  db.insert('servers', { id: crash, name: crash, status: 'crashed', suspended: false, autoStart: true });

  const wasRunning = pm.reconcile();

  assert.equal(db.get('servers', run).status, 'offline', 'running → offline');
  assert.equal(db.get('servers', crash).status, 'offline', 'crashed → offline');
  assert.equal(db.get('servers', off).status, 'offline', 'offline untouched');
  assert.ok(wasRunning.some((s) => s.id === run), 'running server returned for resume');
  assert.ok(!wasRunning.some((s) => s.id === off), 'offline server not in resume set');
  assert.ok(!wasRunning.some((s) => s.id === crash), 'crashed server not in resume set');

  db.remove('servers', run); db.remove('servers', off); db.remove('servers', crash);
});

test('console output is rate-limited so a flooding server cannot lag the panel', () => {
  const id = 'pm_flood_' + Date.now();
  const r = pm.getRuntime(id);
  let emitted = 0;
  const unsub = pm.subscribe(id, (e) => { if (e.event === 'console') emitted++; });

  // Slam 5000 process lines in one window — far above the per-second cap.
  for (let i = 0; i < 5000; i++) r.pushProcessLine('spam line ' + i, 'out');
  unsub();

  // The emit count is capped near the per-second limit (300), NOT 5000 — i.e.
  // the WebSocket stream is protected from the flood.
  assert.ok(emitted >= 1, 'some lines are still shown');
  assert.ok(emitted <= 320, `emitted ${emitted} must be capped near 300, not the full 5000`);

  // Panel/system lines are NEVER throttled (they go through pushLine directly).
  let sysSeen = 0;
  const unsub2 = pm.subscribe(id, (e) => { if (e.event === 'console') sysSeen++; });
  for (let i = 0; i < 50; i++) r.pushLine('[Cloud Panel] system notice ' + i);
  unsub2();
  assert.equal(sysSeen, 50, 'all 50 panel/system lines emitted (never rate-limited)');
});

test('applyMinecraftPort makes the server bind the panel-allocated port', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-props-'));

  // Existing server.properties on the default port → rewritten to the allocation.
  fs.writeFileSync(path.join(dir, 'server.properties'),
    'motd=hi\nserver-port=25565\nserver-ip=10.0.0.5\nmax-players=20\n');
  pm.applyMinecraftPort(dir, 25574, 'java -jar server.jar nogui');
  let props = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
  assert.match(props, /^server-port=25574$/m, 'server-port set to the allocation');
  assert.match(props, /^query\.port=25574$/m, 'query.port set to the allocation');
  assert.match(props, /^server-ip=$/m, 'server-ip blanked so it binds all interfaces');
  assert.match(props, /^motd=hi$/m, 'unrelated keys preserved');

  // No server.properties + a proxy-style startup (no `nogui`) → left untouched.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-proxy-'));
  pm.applyMinecraftPort(dir2, 25500, 'java -jar server.jar');
  assert.equal(fs.existsSync(path.join(dir2, 'server.properties')), false, 'proxy gets no spurious server.properties');
});

test('starting a server opens its allocation port(s) in the firewall', () => {
  const firewall = require('../src/services/firewall');
  const config = require('../src/config');
  const isolation = require('../src/services/isolation');

  // Capture firewall.allowPort calls without touching the real ufw.
  const opened = [];
  const realAllow = firewall.allowPort;
  firewall.allowPort = (p) => { opened.push(Number(p)); return Promise.resolve({ ok: false, skipped: 'test' }); };
  // Let the start proceed past the secure-by-default gate in this unit test.
  const realBlock = isolation.execBlockReason;
  isolation.execBlockReason = () => null;

  try {
    const sid = 'pm_fw_' + Date.now();
    const aid = 'alloc_' + Date.now();
    db.insert('allocations', { id: aid, nodeId: 'n', ip: '0.0.0.0', port: 25599, primary: true, serverId: sid });
    db.insert('servers', {
      id: sid, name: sid, uuid: sid, eggId: 'missing-egg', ownerId: 'u',
      suspended: false, allocationId: aid, limits: { memory: 512 },
      startup: 'node -e "0"', // exits cleanly & instantly — no lingering child
    });

    pm.start(db.get('servers', sid)); // firewall.allowPort runs BEFORE the (instant) spawn
    assert.ok(opened.includes(25599), `expected port 25599 to be opened, got ${opened.join(',')}`);

    db.remove('servers', sid); db.remove('allocations', aid);
  } finally {
    firewall.allowPort = realAllow;
    isolation.execBlockReason = realBlock;
  }
});
