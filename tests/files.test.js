'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const files = require('../src/services/files');

// The single most important file-manager guarantee: a resolved path can never
// escape the server's own volume, no matter what traversal the client sends.
test('resolve() keeps path traversal contained within the server root', () => {
  const server = { id: 'files_test_srv' };
  const root = files.rootFor(server);
  const within = (p) => p === root || p.startsWith(root + path.sep);

  assert.ok(within(files.resolve(server, '/../../etc/passwd')), 'absolute traversal contained');
  assert.ok(within(files.resolve(server, '/a/b/../../../../../../etc/shadow')), 'deep traversal contained');
  assert.ok(within(files.resolve(server, '/world/level.dat')), 'normal path stays in root');
});

// Disk usage is computed off the event loop; the sync accessor must never block —
// it serves the cached value and refreshes in the background.
test('diskUsageAsync reports real volume size; diskUsage serves it without blocking', async () => {
  const server = { id: 'disk_test_' + Date.now() };
  const root = files.rootFor(server);
  fs.writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(1000, 7));

  const bytes = await files.diskUsageAsync(server);
  assert.ok(bytes >= 1000, 'async walk counts the file bytes');
  assert.equal(files.diskUsage(server), bytes, 'sync read returns the freshly cached value');
});
