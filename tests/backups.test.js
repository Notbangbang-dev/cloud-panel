'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db'); db.load();
const files = require('../src/services/files');
const backups = require('../src/services/backups');

test('backup create runs off the main thread and produces a real zip', async () => {
  const server = { id: 'bak_test_' + Date.now(), name: 'bak', featureLimits: { backups: 5 } };
  const root = files.rootFor(server);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'hello.txt'), 'world');

  const rec = await backups.create(server, { name: 'unit', createdBy: null });
  assert.ok(rec && rec.id, 'returns a backup record');
  assert.ok(rec.sizeBytes > 0, 'the zip actually contains data');

  db.remove('backups', rec.id);
});

test('restore validates BEFORE writing — a quota-busting backup leaves the volume untouched', async () => {
  const server = { id: 'restore_test_' + Date.now(), name: 'r', limits: {} };
  const root = files.rootFor(server);
  fs.mkdirSync(root, { recursive: true });
  // Back up a sizable file.
  fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(4096, 1));
  const rec = await backups.create(server, { name: 'restore-unit' });

  // Wipe the volume, drop a sentinel, then clamp the quota below the backup size.
  fs.rmSync(path.join(root, 'big.bin'), { force: true });
  fs.writeFileSync(path.join(root, 'sentinel.txt'), 'KEEP');
  server.limits = { disk: 0.0005 }; // ~524 byte budget, < 4096

  await assert.rejects(() => backups.restore(server, rec.id), /quota/i, 'restore is rejected up front');
  assert.equal(fs.existsSync(path.join(root, 'big.bin')), false, 'no partial write — backup file absent');
  assert.equal(fs.readFileSync(path.join(root, 'sentinel.txt'), 'utf8'), 'KEEP', 'existing files untouched');

  db.remove('backups', rec.id);
});

test('restore brings backed-up files back via the staging commit (happy path)', async () => {
  const server = { id: 'restore_ok_' + Date.now(), name: 'r2', limits: {} };
  const root = files.rootFor(server);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'config.yml'), 'motd: hi');

  const rec = await backups.create(server, { name: 'ok' });
  fs.rmSync(path.join(root, 'config.yml'), { force: true });
  assert.equal(fs.existsSync(path.join(root, 'config.yml')), false, 'removed before restore');

  const r = await backups.restore(server, rec.id);
  assert.ok(r.restored >= 1, 'restored at least one file');
  assert.equal(fs.readFileSync(path.join(root, 'config.yml'), 'utf8'), 'motd: hi', 'content restored intact');

  db.remove('backups', rec.id);
});
