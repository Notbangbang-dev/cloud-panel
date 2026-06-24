'use strict';

/**
 * Tiny zero-dependency structured logger.
 *
 *   CP_LOG_LEVEL = debug | info | warn | error   (default: info)
 *   CP_LOG_JSON  = 1                              (emit one JSON object per line)
 *
 * Replaces ad-hoc console.* on the hot paths and adds per-request logging
 * (method, path, status, latency) so operators can see what the panel is doing
 * without bolting on a heavy logging dependency.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS[(process.env.CP_LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const JSON_MODE = process.env.CP_LOG_JSON === '1';

function fmt(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ t: ts, level, msg: args.map(fmt).join(' ') }) + '\n');
  } else {
    const sink = level === 'error' || level === 'warn' ? console.error : console.log;
    sink(`${ts} ${level.toUpperCase().padEnd(5)}`, ...args);
  }
}

const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
  /** Override the level at runtime (used by tests). */
  setLevel(name) { threshold = LEVELS[String(name).toLowerCase()] || threshold; },
  get level() { return Object.keys(LEVELS).find((k) => LEVELS[k] === threshold); },
};

/** Express middleware: log each request once it finishes (status + latency). */
function requestLogger() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const lvl = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[lvl](`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  };
}

module.exports = { log, requestLogger, LEVELS };
