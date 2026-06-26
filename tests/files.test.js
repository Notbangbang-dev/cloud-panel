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

// Bulk delete: removes every selected file/folder in one call.
test('removeMany deletes multiple files and folders', async () => {
  const server = { id: 'bulk_del_' + Date.now() };
  const root = files.rootFor(server);
  fs.writeFileSync(path.join(root, 'one.txt'), 'a');
  fs.writeFileSync(path.join(root, 'two.txt'), 'b');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'nested.txt'), 'c');

  const res = await files.removeMany(server, ['/one.txt', '/two.txt', '/sub']);
  assert.equal(res.removed, 3, 'all three targets removed');
  assert.equal(res.failed.length, 0, 'nothing failed');
  assert.ok(!fs.existsSync(path.join(root, 'one.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'two.txt')));
  assert.ok(!fs.existsSync(path.join(root, 'sub')), 'folder removed recursively');
});

// One bad path must not abort the rest, and is reported back to the caller. The
// root-delete guard is a path that genuinely throws (a sanitized traversal would
// just be a contained no-op), so it doubles as the "fail one, keep going" case.
test('removeMany reports per-item failures without aborting the batch', async () => {
  const server = { id: 'bulk_del_fail_' + Date.now() };
  const root = files.rootFor(server);
  fs.writeFileSync(path.join(root, 'keep-not.txt'), 'a');

  const res = await files.removeMany(server, ['/', '/keep-not.txt']);
  assert.equal(res.removed, 1, 'the valid delete still happened');
  assert.equal(res.failed.length, 1, 'the root entry is reported as failed');
  assert.equal(res.failed[0].path, '/');
  assert.ok(!fs.existsSync(path.join(root, 'keep-not.txt')), 'valid file gone');
});

// The volume root itself must never be deletable — guards bulk delete from
// wiping a whole server via a stray '/' entry.
test('remove refuses to delete the server root', async () => {
  const server = { id: 'root_guard_' + Date.now() };
  const root = files.rootFor(server);
  fs.writeFileSync(path.join(root, 'survivor.txt'), 'x');

  await assert.rejects(() => files.remove(server, '/'), /server root/i, 'deleting root is refused');
  assert.ok(fs.existsSync(path.join(root, 'survivor.txt')), 'volume contents untouched');
});
