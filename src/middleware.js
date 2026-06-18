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

/** Conservative security headers (no CSP to avoid breaking the SPA assets). */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

module.exports = { rateLimit, securityHeaders };
