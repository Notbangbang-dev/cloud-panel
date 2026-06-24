'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const ipguard = require('../src/services/ipguard');

test('canonicalIp normalizes addresses for stable identity', () => {
  assert.equal(ipguard.canonicalIp('::ffff:1.2.3.4'), '1.2.3.4', 'unwraps IPv4-mapped IPv6');
  assert.equal(ipguard.canonicalIp('203.0.113.7'), '203.0.113.7', 'passes IPv4 through');
  assert.equal(ipguard.canonicalIp('fe80::1%eth0').includes('%'), false, 'strips IPv6 zone id');
  assert.match(ipguard.canonicalIp('2001:db8:1:2:3:4:5:6'), /\/64$/, 'collapses IPv6 to /64');
});
