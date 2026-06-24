'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const settings = require('../src/services/settings');

test('coerces types and clamps values', () => {
  settings.update({ afk: { enabled: 'yes', coins: '5', intervalSeconds: 1 } });
  const s = settings.get();
  assert.equal(typeof s.afk.enabled, 'boolean');
  assert.ok(s.afk.intervalSeconds >= 5, 'interval clamped to >= 5s');
});

test('billing mode falls back to a valid enum', () => {
  settings.update({ billing: { mode: 'bogus' } });
  assert.equal(settings.get().billing.mode, 'free');
  settings.update({ billing: { mode: 'trial' } });
  assert.equal(settings.get().billing.mode, 'trial');
  settings.update({ billing: { mode: 'free' } });
});

test('security.allowUnsandboxed is a normalized boolean', () => {
  settings.update({ security: { allowUnsandboxed: 'truthy' } });
  assert.equal(settings.get().security.allowUnsandboxed, true);
  settings.update({ security: { allowUnsandboxed: false } });
  assert.equal(settings.get().security.allowUnsandboxed, false);
});
