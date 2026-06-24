'use strict';

/**
 * Per-server Java version selection.
 *
 * Many eggs (Minecraft + proxies) run on Java, and different server/game versions
 * need different Java majors — old Minecraft needs Java 8, modern needs 17/21.
 * This module lets each server pick a Java major from a fixed ALLOWLIST and
 * applies it two ways:
 *
 *   - OCI sandbox (the default): swap the container image tag to
 *     `eclipse-temurin:<version>-jre`, so the chosen JRE is what runs the server.
 *   - Host-process mode: rewrite the leading `java` token of the startup command
 *     to a configured binary (env `CP_JAVA_<version>=/path/to/java`), falling
 *     back to the system `java` when none is configured.
 *
 * SECURITY: the version is ALWAYS validated against ALLOWED_VERSIONS before it is
 * interpolated into an image tag or used to look up a binary. A user can never
 * push an arbitrary container image or filesystem path through this field — the
 * only strings we ever emit are `eclipse-temurin:<allowed>-jre` or an operator-
 * configured `CP_JAVA_<allowed>` path.
 */

const IMAGE_RE = /eclipse-temurin:(\d+)/i;

// LTS majors that reliably ship an official `eclipse-temurin:<v>-jre` image.
const ALLOWED_VERSIONS = [8, 11, 17, 21, 25];

/** Coerce arbitrary input to an allowed Java major, or null if not allowed. */
function normalizeVersion(v) {
  const n = Math.trunc(Number(v));
  return Number.isInteger(n) && ALLOWED_VERSIONS.includes(n) ? n : null;
}

/** True when an image is a Temurin image we know how to re-tag. */
function isJavaImage(image) {
  return typeof image === 'string' && IMAGE_RE.test(image);
}

/** True when an egg runs on Java (so a version selector applies). */
function isJavaEgg(egg) {
  return !!egg && isJavaImage(egg.docker);
}

/** The Java major implied by an egg's own image (e.g. ...:21-jre -> 21). */
function defaultVersion(egg) {
  const m = egg && typeof egg.docker === 'string' && egg.docker.match(IMAGE_RE);
  return m ? Number(m[1]) : 21;
}

/** Build the official Temurin JRE image tag for an allowed version (else null). */
function imageForVersion(v) {
  const n = normalizeVersion(v);
  return n ? `eclipse-temurin:${n}-jre` : null;
}

/**
 * Resolve the container image for a server: the chosen Java version's image for a
 * Java egg, otherwise the egg's own image. Never returns user-controlled text —
 * an out-of-allowlist `javaVersion` is ignored and falls back to the egg default.
 */
function resolveImage(egg, server) {
  if (isJavaEgg(egg)) {
    const v = normalizeVersion(server && server.javaVersion);
    if (v) return imageForVersion(v);
  }
  return (egg && egg.docker) || '';
}

/** Host-mode java binary for a version, configured via `CP_JAVA_<major>`. */
function hostBinary(v) {
  const n = normalizeVersion(v);
  if (!n) return null;
  const p = (process.env[`CP_JAVA_${n}`] || '').trim();
  return p || null;
}

/**
 * Rewrite the leading `java` token of a startup command to the host binary for
 * the server's chosen version, when one is configured. Host-process mode only —
 * in OCI mode the image already provides the right `java`.
 *
 * Returns { cmd, note }: `cmd` is the (possibly rewritten) command, `note` is an
 * operator-facing console line (or null). We only ever touch a command that
 * literally starts with the bare `java` program, and we only ever substitute an
 * operator-configured path, so this can't inject anything a user controls.
 */
function applyHostBinary(cmd, server, egg) {
  if (!isJavaEgg(egg)) return { cmd, note: null };
  const v = normalizeVersion(server && server.javaVersion);
  if (!v) return { cmd, note: null };
  if (!/^\s*java(\s|$)/.test(cmd)) return { cmd, note: null }; // not a `java ...` startup
  const bin = hostBinary(v);
  if (!bin) {
    return {
      cmd,
      note:
        `Java ${v} requested, but no CP_JAVA_${v} binary is configured on the host — ` +
        `using the system 'java'. Tip: run with the container sandbox (CP_OCI=1) to ` +
        `switch Java versions automatically, or set CP_JAVA_${v}=/path/to/java.`,
    };
  }
  const prog = /\s/.test(bin) ? `"${bin}"` : bin; // tokenizer honors double quotes
  return { cmd: cmd.replace(/^\s*java/, prog), note: `Using Java ${v} (${bin}).` };
}

module.exports = {
  ALLOWED_VERSIONS,
  normalizeVersion,
  isJavaImage,
  isJavaEgg,
  defaultVersion,
  imageForVersion,
  resolveImage,
  hostBinary,
  applyHostBinary,
};
