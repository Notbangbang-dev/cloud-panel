'use strict';

/** Lightweight, dependency-free middleware: rate limiting + security headers. */

/**
 * In-memory fixed-window rate limiter, keyed by client IP.
 * Good enough for a single-process panel; pair with a reverse proxy for scale.
 */
function rateLimit({ windowMs = 60000, max = 10, message = 'Too many attempts — please slow down and try again shortly.' } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return function rateLimiter(req, res, next) {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now > rec.reset) {
      rec = { count: 0, reset: now + windowMs };
      hits.set(key, rec);
    }
    rec.count++;
    if (rec.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/**
 * Content-Security-Policy tuned for the SPA:
 *  - script-src 'self'     -> blocks injected/inline JS (the main XSS goal).
 *    The frontend loads only external /js/*.js and binds events via
 *    addEventListener (no inline <script> / on*= handlers), so this is safe.
 *  - style-src adds 'unsafe-inline' because the UI uses inline styles and an
 *    injected <style> for live theme preview.
 *  - img/media allow https: + data: so admin theme backgrounds (remote image /
 *    gif / video URLs) keep working.
 *  - connect-src allows same-origin XHR + the console WebSocket.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
].join('; ');

/** Conservative security headers + a strict-but-SPA-compatible CSP. */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', CSP);
  // Enforce HTTPS for a year (ignored by browsers over plain http, so harmless
  // for local/dev but protective once served over TLS / behind a proxy).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { rateLimit, securityHeaders };
