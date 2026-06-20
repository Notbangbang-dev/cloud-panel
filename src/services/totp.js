'use strict';

/**
 * RFC 6238 TOTP (time-based one-time passwords) for authenticator apps
 * (Google Authenticator, Authy, 1Password, …). Pure Node crypto — no deps.
 *
 *   - HMAC-SHA1, 30-second step, 6 digits (the universal default).
 *   - Base32 (RFC 4648) secret encoding for the otpauth:// URI + manual entry.
 *   - A ±1 step verification window absorbs minor clock drift.
 */

const crypto = require('crypto');

const STEP = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Random base32 secret (default 20 bytes → 32 chars, the common length). */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The TOTP code for a given secret + counter (defaults to the current step). */
function codeFor(secret, counter) {
  const key = base32Decode(secret);
  if (!key.length) return null;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Verify a user-entered token within a small drift window. */
function verify(secret, token, window = 1) {
  const t = String(token || '').replace(/\D/g, '');
  if (t.length !== DIGITS || !secret) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let i = -window; i <= window; i++) {
    const expected = codeFor(secret, counter + i);
    // Constant-time compare to avoid leaking timing information.
    if (expected && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return true;
  }
  return false;
}

/** otpauth:// URI an authenticator app turns into a QR code. */
function otpauthUri(secret, label, issuer) {
  const params = new URLSearchParams({
    secret,
    issuer: issuer || 'Cloud Panel',
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP),
  });
  const lbl = encodeURIComponent(`${issuer || 'Cloud Panel'}:${label}`);
  return `otpauth://totp/${lbl}?${params.toString()}`;
}

/** A set of one-time recovery codes (shown once, stored hashed). */
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

const hashCode = (code) =>
  crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

module.exports = {
  STEP, DIGITS,
  generateSecret, generateBackupCodes, hashCode,
  base32Encode, base32Decode, codeFor, verify, otpauthUri,
};
