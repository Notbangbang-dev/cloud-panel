'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const nettrust = require('../src/services/nettrust');
const automations = require('../src/services/automations');

test('SSRF guard: IPv4-mapped IPv6 (dotted AND hex forms) classified as private', () => {
  // Hex-encoded v4-mapped forms used to bypass the guard → reach loopback/metadata.
  assert.equal(nettrust.isPrivateIp('::ffff:7f00:1'), true, '127.0.0.1 (hex)');
  assert.equal(nettrust.isPrivateIp('::ffff:a9fe:a9fe'), true, '169.254.169.254 cloud metadata (hex)');
  assert.equal(nettrust.isPrivateIp('::ffff:0a00:0001'), true, '10.0.0.1 (hex)');
  assert.equal(nettrust.isPrivateIp('::ffff:c0a8:0001'), true, '192.168.0.1 (hex)');
  assert.equal(nettrust.isPrivateIp('0:0:0:0:0:ffff:7f00:1'), true, '127.0.0.1 (expanded hex)');
  // Public addresses must still be allowed (not flagged private).
  assert.equal(nettrust.isPrivateIp('::ffff:1.2.3.4'), false, '1.2.3.4 is public');
  assert.equal(nettrust.isPrivateIp('8.8.8.8'), false);
  assert.equal(nettrust.isPrivateIp('2606:4700:4700::1111'), false);
  // Real private/loopback still caught.
  assert.equal(nettrust.isPrivateIp('127.0.0.1'), true);
  assert.equal(nettrust.isPrivateIp('169.254.169.254'), true);
});

test('Automation ReDoS prelinter rejects catastrophic-backtracking patterns', () => {
  assert.equal(automations.validRegex('(a+)+$'), false, 'nested quantifier');
  assert.equal(automations.validRegex('(a*)*c'), false, 'nested star');
  assert.equal(automations.validRegex('(.*)*x'), false, 'quantified group of star');
  assert.equal(automations.validRegex('(\\d+,){5,}'), false, 'quantified group with {n,}');
  // Ordinary, safe patterns still allowed.
  assert.equal(automations.validRegex('Done \\((\\d+)s\\)!'), true);
  assert.equal(automations.validRegex('player (\\w+) joined'), true);
  assert.equal(automations.validRegex('\\[ERROR\\]'), true);
});
