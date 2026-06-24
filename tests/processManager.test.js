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
