'use strict';
require('./_env');
const { test } = require('node:test');
const assert = require('node:assert');
const j = require('../src/services/java');
const oci = require('../src/services/oci');

const javaEgg = { docker: 'eclipse-temurin:21-jre' };
const nodeEgg = { docker: 'node:lts' };

test('normalizeVersion enforces the allowlist (no arbitrary input escapes)', () => {
  assert.equal(j.normalizeVersion(21), 21);
  assert.equal(j.normalizeVersion('17'), 17);
  assert.equal(j.normalizeVersion(99), null);
  assert.equal(j.normalizeVersion('latest'), null);
  assert.equal(j.normalizeVersion('21; rm -rf /'), null);
  assert.equal(j.normalizeVersion(null), null);
});

test('imageForVersion only ever builds a temurin tag for an allowed version', () => {
  assert.equal(j.imageForVersion(21), 'eclipse-temurin:21-jre');
  assert.equal(j.imageForVersion(8), 'eclipse-temurin:8-jre');
  assert.equal(j.imageForVersion(99), null);
  assert.equal(j.imageForVersion('evil:latest'), null);
});

test('resolveImage swaps the tag for Java eggs and never re-tags others', () => {
  assert.equal(j.resolveImage(javaEgg, { javaVersion: 17 }), 'eclipse-temurin:17-jre');
  assert.equal(j.resolveImage(javaEgg, {}), 'eclipse-temurin:21-jre');           // egg default
  assert.equal(j.resolveImage(javaEgg, { javaVersion: 99 }), 'eclipse-temurin:21-jre'); // invalid ignored
  assert.equal(j.resolveImage(nodeEgg, { javaVersion: 21 }), 'node:lts');        // non-java untouched
});

test('isJavaEgg / defaultVersion detect Java eggs and their implied version', () => {
  assert.equal(j.isJavaEgg(javaEgg), true);
  assert.equal(j.isJavaEgg(nodeEgg), false);
  assert.equal(j.defaultVersion(javaEgg), 21);
  assert.equal(j.defaultVersion({ docker: 'eclipse-temurin:8-jre' }), 8);
});

test('applyHostBinary only rewrites a leading java token, never injects arbitrary paths', () => {
  // No CP_JAVA_<v> configured -> command unchanged, with an explanatory note.
  const r1 = j.applyHostBinary('java -jar server.jar', { javaVersion: 17 }, javaEgg);
  assert.equal(r1.cmd, 'java -jar server.jar');
  assert.match(r1.note, /Java 17/);

  // Configured binary -> the leading `java` is replaced with the exact path.
  process.env.CP_JAVA_17 = '/opt/java17/bin/java';
  const r2 = j.applyHostBinary('java -Xmx1024M -jar server.jar', { javaVersion: 17 }, javaEgg);
  assert.equal(r2.cmd, '/opt/java17/bin/java -Xmx1024M -jar server.jar');
  delete process.env.CP_JAVA_17;

  // Non-java egg, non-java command, and no version: all untouched.
  assert.equal(j.applyHostBinary('node index.js', { javaVersion: 21 }, nodeEgg).cmd, 'node index.js');
  assert.equal(j.applyHostBinary('./run.sh', { javaVersion: 21 }, javaEgg).cmd, './run.sh');
  assert.equal(j.applyHostBinary('java -jar s.jar', {}, javaEgg).cmd, 'java -jar s.jar');
});

test('oci.buildRunArgs uses the selected Java image', () => {
  const server = { id: 'jv1', name: 'mc', javaVersion: 17, limits: { memory: 1024 } };
  const { image, args } = oci.buildRunArgs({
    server, egg: javaEgg, argv: ['java', '-jar', 'server.jar'], dir: '/tmp/jv1', ports: [25565], env: {},
  });
  assert.equal(image, 'eclipse-temurin:17-jre');
  assert.ok(args.includes('eclipse-temurin:17-jre'), 'image appears in the run argv');
});
