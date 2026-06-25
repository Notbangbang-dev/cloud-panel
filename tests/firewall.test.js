'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const fw = require('../src/services/firewall');
const config = require('../src/config');
const { port, buildArgs } = fw._internals;

test('port() validates strictly — no injection or out-of-range value survives', () => {
  assert.equal(port(25565), 25565);
  assert.equal(port('25565'), 25565);
  assert.equal(port(0), null);
  assert.equal(port(70000), null);
  assert.equal(port(-5), null);
  assert.equal(port('25565; rm -rf /'), null); // Number() -> NaN
  assert.equal(port('80 || curl evil'), null);
  assert.equal(port('latest'), null);
  assert.equal(port(null), null);
});

test('buildArgs never uses a shell string and respects the mode', () => {
  config.manageFirewall = 'auto';
  const a = buildArgs('25565');
  assert.ok(Array.isArray(a.args), 'args is an argv array, not a shell string');
  assert.equal(a.args[0], 'allow');
  assert.ok(a.args.includes('25565'));

  config.manageFirewall = 'sudo';
  const s = buildArgs('25565:25600/tcp');
  assert.equal(s.cmd, 'sudo');
  assert.equal(s.args[0], '-n'); // non-interactive sudo, then the ufw binary
  assert.ok(s.args.includes('allow'));
  assert.ok(s.args.includes('25565:25600/tcp'));

  config.manageFirewall = 'auto'; // restore
});

test('allowPort rejects an invalid port without executing anything', async () => {
  const r = await fw.allowPort('not-a-port');
  assert.equal(r.skipped, 'invalid-port');
});

test('allowRange rejects nonsense ranges', async () => {
  assert.equal((await fw.allowRange(25600, 25565)).skipped, 'invalid-range'); // end < start
  assert.equal((await fw.allowRange(1, 60000)).skipped, 'range-too-large');
  assert.equal((await fw.allowRange('x', 10)).skipped, 'invalid-range');
});

test('mode "off" disables automation entirely', () => {
  config.manageFirewall = 'off';
  assert.equal(fw.mode(), 'off');
  assert.equal(fw.available(), false);
  config.manageFirewall = 'auto'; // restore
});
