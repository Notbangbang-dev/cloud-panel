'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const settings = require('../src/services/settings');
const billing = require('../src/services/billing');

const future = () => new Date(Date.now() + 1e6).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

test('isTrialExpired reflects the clock', () => {
  assert.equal(billing.isTrialExpired({ planStatus: 'trialing', trialEndsAt: past() }), true);
  assert.equal(billing.isTrialExpired({ planStatus: 'trialing', trialEndsAt: future() }), false);
  assert.equal(billing.isTrialExpired({ planStatus: 'active' }), false);
});

test('requiresPlan honors mode, admin exemption, and trial expiry', () => {
  settings.update({ billing: { mode: 'free' } });
  assert.equal(billing.requiresPlan({ admin: false, planStatus: 'none' }), false, 'free mode never gates');

  settings.update({ billing: { mode: 'paid' } });
  assert.equal(billing.requiresPlan({ admin: false, planStatus: 'none' }), true, 'paid gates no-plan users');
  assert.equal(billing.requiresPlan({ admin: true, planStatus: 'none' }), false, 'admins exempt');
  assert.equal(billing.requiresPlan({ admin: false, planStatus: 'active' }), false, 'active is entitled');
  assert.equal(billing.requiresPlan({ admin: false, planStatus: 'trialing', trialEndsAt: future() }), false, 'live trial entitled');
  assert.equal(billing.requiresPlan({ admin: false, planStatus: 'trialing', trialEndsAt: past() }), true, 'expired trial gated');
  settings.update({ billing: { mode: 'free' } });
});

test('reconcile downgrades an expired trial (status + quota)', () => {
  const id = 'test_recon_' + Date.now();
  db.insert('users', { id, username: 'r', planStatus: 'trialing', plan: 'p', trialEndsAt: past(), resources: { memory: 99999 } });
  const u = billing.reconcile(db.get('users', id));
  assert.equal(u.planStatus, 'expired');
  assert.equal(u.plan, null);
  db.remove('users', id);
});

test('reconcile is a no-op for a live trial', () => {
  const u = { id: 'x', username: 'x', planStatus: 'trialing', trialEndsAt: future() };
  assert.equal(billing.reconcile(u).planStatus, 'trialing');
});
