'use strict';

/**
 * Outbound-request safety guard (SSRF mitigation).
 *
 * Several features fetch URLs on the server's behalf that are influenced by user
 * input — most notably the Modrinth modpack installer, whose `.mrpack` index can
 * list arbitrary download URLs, and the plugin/mod downloader. Without a guard
 * those could be pointed at internal services (e.g. the cloud metadata endpoint
 * 169.254.169.254, localhost, or RFC1918 hosts).
 *
 * `assertPublicUrl()` requires an https URL whose host is NOT loopback,
 * link-local, private (RFC1918 / CGNAT / ULA) or otherwise internal. For
 * hostnames it also resolves DNS and rejects the request if ANY resolved
 * address is private (best-effort anti DNS-rebind).
 *
 * `safeFetch()` builds on that: it follows redirects MANUALLY and re-validates
 * every hop's `Location` against `assertPublicUrl`, closing the redirect-based
 * SSRF bypass (a public URL that 30x-redirects to 169.254.169.254 / RFC1918).
 * Use it for every outbound request whose URL is influenced by user input.
 */

const net = require('net');
const dns = require('dns').promises;

/** True if an IPv4/IPv6 literal is loopback/private/link-local/reserved. */
function isPrivateIp(addr) {
  const ip = String(addr || '').split('%')[0]; // drop IPv6 zone id
  const kind = net.isIP(ip);
  if (kind === 4) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n))) return true;
    if (o[0] === 0) return true;                                  // 0.0.0.0/8
    if (o[0] === 10) return true;                                 // 10/8
    if (o[0] === 127) return true;                                // loopback
    if (o[0] === 169 && o[1] === 254) return true;               // link-local + cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;   // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true;               // 192.168/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;  // CGNAT 100.64/10
    if (o[0] >= 224) return true;                                 // multicast/reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;           // loopback / unspecified
    if (lower.startsWith('fe80')) return true;                    // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length)); // v4-mapped
    return false;
  }
  return false; // not an IP literal
}

/** True for hostnames that should never be reachable as an egress target. */
function isInternalHostname(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  return false;
}

/**
 * Validate that `urlStr` is a safe public http(s) URL.
 * @param {string} urlStr
 * @param {{ protocols?: string[] }} [opts]
 * @returns {Promise<URL>} the parsed URL (throws if blocked)
 */
async function assertPublicUrl(urlStr, { protocols = ['https:'] } = {}) {
  let url;
  try { url = new URL(String(urlStr)); }
  catch { throw Object.assign(new Error('Invalid URL'), { code: 'EBLOCKEDURL' }); }

  if (!protocols.includes(url.protocol))
    throw Object.assign(new Error(`Blocked URL scheme: ${url.protocol}`), { code: 'EBLOCKEDURL' });

  const host = url.hostname;
  if (isInternalHostname(host))
    throw Object.assign(new Error('Blocked request to an internal host'), { code: 'EBLOCKEDURL' });

  // IP literal → check directly (no DNS).
  if (net.isIP(host)) {
    if (isPrivateIp(host))
      throw Object.assign(new Error('Blocked request to a private address'), { code: 'EBLOCKEDURL' });
    return url;
  }

  // Hostname → resolve and ensure no address is private (anti DNS-rebind).
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw Object.assign(new Error('Could not resolve download host'), { code: 'EBLOCKEDURL' }); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
    throw Object.assign(new Error('Blocked request to a private address'), { code: 'EBLOCKEDURL' });

  return url;
}

/**
 * SSRF-safe `fetch`: validates the initial URL AND every redirect hop against
 * `assertPublicUrl`. Native `fetch` follows 3xx automatically WITHOUT
 * re-checking the target, so we disable that (`redirect: 'manual'`) and follow
 * the chain ourselves, re-validating each `Location`.
 *
 * @param {string} urlStr initial URL
 * @param {object} [options] fetch options (method/headers/body/signal…)
 * @param {{ protocols?: string[], maxRedirects?: number }} [guard]
 * @returns {Promise<Response>} the final (non-redirect) response
 */
async function safeFetch(urlStr, options = {}, { protocols = ['https:'], maxRedirects = 5 } = {}) {
  if (typeof fetch !== 'function') throw new Error('global fetch is unavailable (Node 18+ required)');
  let current = (await assertPublicUrl(urlStr, { protocols })).toString();
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, { ...options, redirect: 'manual' });
    // undici exposes 3xx + Location when redirect:'manual' (not an opaque redirect).
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res; // a 3xx with no Location — hand back as-is
      if (hop >= maxRedirects)
        throw Object.assign(new Error('Too many redirects'), { code: 'EBLOCKEDURL' });
      const next = new URL(loc, current).toString(); // resolve relative redirects
      await assertPublicUrl(next, { protocols }); // re-validate the hop (anti-SSRF)
      // Release the redirect response body before following the next hop.
      try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch { /* ignore */ }
      current = next;
      continue;
    }
    return res;
  }
}

/** Sync best-effort check (no DNS) — used where async isn't available. */
function isObviouslyInternal(urlStr) {
  let url;
  try { url = new URL(String(urlStr)); } catch { return true; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return true;
  if (isInternalHostname(url.hostname)) return true;
  if (net.isIP(url.hostname) && isPrivateIp(url.hostname)) return true;
  return false;
}

module.exports = { assertPublicUrl, safeFetch, isPrivateIp, isInternalHostname, isObviouslyInternal };
