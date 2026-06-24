'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const { log } = require('../src/log');

test('log respects the configured level (debug suppressed at info)', () => {
  log.setLevel('info');
  const origLog = console.log, origErr = console.error;
  let out = 0, err = 0;
  console.log = () => { out++; };
  console.error = () => { err++; };
  try {
    log.debug('suppressed');
    log.info('hello');   // -> stdout
    log.warn('warn');    // -> stderr
    log.error('boom');   // -> stderr
  } finally { console.log = origLog; console.error = origErr; }
  assert.equal(out, 1, 'only info reached stdout (debug filtered)');
  assert.equal(err, 2, 'warn + error reached stderr');
});

test('raising the level suppresses lower messages', () => {
  log.setLevel('error');
  const origLog = console.log, origErr = console.error;
  let out = 0, err = 0;
  console.log = () => { out++; };
  console.error = () => { err++; };
  try { log.info('no'); log.warn('no'); log.error('yes'); } finally { console.log = origLog; console.error = origErr; }
  assert.equal(out, 0, 'info/warn suppressed at error level');
  assert.equal(err, 1, 'error still emitted');
  log.setLevel('info');
});
