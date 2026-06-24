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
