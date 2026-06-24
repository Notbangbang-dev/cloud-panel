'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db'); db.load();
const settings = require('../src/services/settings');
const billing = require('../src/services/billing');

test('cross-account trial anti-abuse: same identity blocked, fresh allowed', async () => {
  settings.update({ billing: { mode: 'trial', trialDays: 1, trialPlanId: null }, security: { antiVpn: false } });
  const plan = billing.createPlan({ name: 'T', price: 1000, interval: 'month', resources: { memory: 1024 } });
  const ids = [];
  const mk = (id, email, discordId) => {
    db.insert('users', { id, username: id, admin: false, planStatus: 'none', resources: {}, email, discordId: discordId || null });
    ids.push(id);
  };
  const A = 'ta_' + Date.now(), B = 'tb_' + Date.now(), C = 'tc_' + Date.now();
  mk(A, 'Test.User+promo@gmail.com');     // normalizes to testuser@gmail.com
  mk(B, 'testuser@gmail.com');            // same normalized identity as A
  mk(C, 'fresh-' + Date.now() + '@proton.me');

  const r1 = await billing.startTrial(db.get('users', A), plan.id, { ip: '1.2.3.9' });
  assert.equal(r1.ok, true, 'first trial is allowed');

  await assert.rejects(
    () => billing.startTrial(db.get('users', B), plan.id, { ip: '9.9.9.9' }),
    /already been claimed|already used/i,
    'a second account with the same gmail (dots/+tag collapsed) is blocked'
  );

  const r3 = await billing.startTrial(db.get('users', C), plan.id, { ip: '2.2.2.2' });
  assert.equal(r3.ok, true, 'a genuinely fresh identity is allowed');

  // cleanup
  for (const id of ids) db.remove('users', id);
  for (const r of db.all('trialClaims')) if (ids.includes(r.userId)) db.remove('trialClaims', r.id);
  billing.removePlan(plan.id);
  settings.update({ billing: { mode: 'free' } });
});
