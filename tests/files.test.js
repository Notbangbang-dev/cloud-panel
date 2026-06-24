'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
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
