'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const settings = require('../src/services/settings');
const iso = require('../src/services/isolation');

test('secure-by-default: unsandboxed execution is blocked unless opted in', () => {
  settings.update({ security: { allowUnsandboxed: false } });
  // On CI/dev there is no OCI and we are not root, so no sandbox is active.
  if (!iso.sandboxActive()) {
    assert.ok(iso.execBlockReason(), 'should block when unsandboxed and not allowed');
    assert.equal(iso.unsandboxedAllowed(), false);
  }
});

test('opting in (security.allowUnsandboxed) lifts the block', () => {
  settings.update({ security: { allowUnsandboxed: true } });
  assert.equal(iso.unsandboxedAllowed(), true);
  assert.equal(iso.execBlockReason(), null);
  settings.update({ security: { allowUnsandboxed: false } });
});
