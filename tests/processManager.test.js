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
