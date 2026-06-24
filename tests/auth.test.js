'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');

test('sign → verifyToken roundtrip preserves claims', () => {
  const token = auth.sign({ id: 'u1', username: 'alice', admin: true, tokenVersion: 3 });
  const p = auth.verifyToken(token);
  assert.ok(p, 'token should verify');
  assert.equal(p.sub, 'u1');
  assert.equal(p.tv, 3);
  assert.equal(p.admin, true);
});

test('verifyToken rejects garbage and tampered tokens', () => {
  assert.equal(auth.verifyToken('not.a.jwt'), null);
  const t = auth.sign({ id: 'u1', username: 'a' });
  assert.equal(auth.verifyToken(t + 'tampered'), null);
});

test('hashPassword / checkPassword', () => {
  const hash = auth.hashPassword('s3cret!');
  assert.ok(auth.checkPassword({ password: hash }, 's3cret!'));
  assert.equal(auth.checkPassword({ password: hash }, 'wrong'), false);
  assert.equal(auth.checkPassword(null, 's3cret!'), false);
});
