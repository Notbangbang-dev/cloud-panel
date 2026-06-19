'use strict';

/**
 * Real process manager. Each Cloud Panel server maps to a child process.
 * Streams stdout/stderr, accepts console input, tracks status, and samples
 * live CPU / memory usage via pidusage. Subscribers (the WebSocket console)
 * receive console lines, status transitions, and stats ticks.
 */

const { spawn } = require('child_process');
const isolation = require('./isolation');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const config = require('../config');
const db = require('../db');
const stats = require('./stats');
const files = require('./files');
const installers = require('./installers');

const DEMO_PATH = path.join(config.root, 'demo', 'demo-server.js');
const LOG_LIMIT = 250;
const DONE_RE = /(\bdone\b|server started|listening on|ready!|ready in|joinable)/i;

const runtimes = new Map(); // serverId -> runtime

class Runtime extends EventEmitter {
  constructor(serverId) {
    super();
    this.setMaxListeners(0);
    this.serverId = serverId;
    this.proc = null;
    this.status = 'offline';
    this.logs = [];
    this.stats = { cpu: 0, memory: 0, memoryLimit: 0, disk: 0, diskLimit: 0, uptime: 0 };
    this.startedAt = 0;
    this.statsTimer = null;
  }

  pushLine(line, stream = 'out') {
    const entry = { t: Date.now(), stream, line };
    this.logs.push(entry);
    if (this.logs.length > LOG_LIMIT) this.logs.shift();
    this.emit('console', entry);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    db.update('servers', this.serverId, { status });
    this.emit('status', status);
  }
}

function rt(serverId) {
  if (!runtimes.has(serverId)) runtimes.set(serverId, new Runtime(serverId));
  return runtimes.get(serverId);
}

function volumeDir(server) {
  const dir = path.join(config.volumesDir, server.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Tokenize a command line, honoring double quotes. */
function tokenize(cmd) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function resolveStartup(server, egg) {
  const dir = volumeDir(server);
  const vars = {
    SERVER_MEMORY: String(server.limits?.memory ?? 1024),
    SERVER_DIR: dir,
    SERVER_PORT: String(primaryPort(server) ?? ''),
    DEMO_PATH,
    ...(egg?.variables || []).reduce((acc, v) => {
      acc[v.env] = v.default;
      return acc;
    }, {}),
    ...(server.environment || {}),
  };
  let cmd = server.startup || egg?.startup || `node "${DEMO_PATH}"`;
  cmd = cmd.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, k) =>
    vars[k] !== undefined ? vars[k] : ''
  );
  return cmd.trim();
}

function primaryPort(server) {
  const a = db.get('allocations', server.allocationId);
  return a ? a.port : null;
}

// SECURITY: a server process must NEVER inherit the panel's own environment —
// that could contain CP_JWT_SECRET (→ forge admin tokens), DB paths and other
// secrets. We start from an empty env and pass through only the handful of
// host vars a child genuinely needs, then add the egg/server's own variables.
const ENV_PASSTHROUGH = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ',
  'NUMBER_OF_PROCESSORS', 'HOSTNAME',
];

function buildEnv(server, egg) {
  const env = {};
  for (const k of ENV_PASSTHROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.SERVER_MEMORY = String(server.limits?.memory ?? 1024);
  env.SERVER_PORT = String(primaryPort(server) ?? '');
  env.SERVER_UUID = server.uuid;
  for (const v of egg?.variables || []) env[v.env] = v.default;
  for (const [k, val] of Object.entries(server.environment || {})) env[k] = String(val);
  return env;
}

let statsLoop = null;
let sampling = false;

/** Single shared loop that samples every running process every 2s. */
function ensureStatsLoop() {
  if (statsLoop) return;
  statsLoop = setInterval(async () => {
    if (sampling) return;
    const active = [...runtimes.values()].filter((r) => r.proc && r.proc.pid);
    if (!active.length) return;
    sampling = true;
    try {
      const result = await stats.sample(active.map((r) => r.proc.pid));
      for (const r of active) {
        const s = result.get(r.proc.pid);
        if (!s) continue;
        const server = db.get('servers', r.serverId);
        r.stats = {
          cpu: s.cpu,
          memory: s.memory,
          memoryLimit: (server?.limits?.memory ?? 0) * 1024 * 1024,
          disk: server ? files.diskUsage(server) : r.stats.disk,
          diskLimit: (server?.limits?.disk ?? 0) * 1024 * 1024,
          uptime: Date.now() - r.startedAt,
        };
        r.emit('stats', r.stats);
      }
    } catch {
      /* ignore sampling errors */
    } finally {
      sampling = false;
    }
  }, 2000);
  if (statsLoop.unref) statsLoop.unref();
}

const manager = {
  DEMO_PATH,
  buildEnv, // exported for tests / inspection

  getRuntime: rt,

  state(serverId) {
    const r = rt(serverId);
    const server = db.get('servers', serverId);
    const disk = server ? files.diskUsage(server) : r.stats.disk || 0;
    const diskLimit = server ? (server.limits?.disk || 0) * 1024 * 1024 : r.stats.diskLimit || 0;
    return { status: r.status, stats: { ...r.stats, disk, diskLimit }, startedAt: r.startedAt };
  },

  recentLogs(serverId) {
    return rt(serverId).logs.slice();
  },

  subscribe(serverId, handler) {
    const r = rt(serverId);
    const onConsole = (e) => handler({ event: 'console', ...e });
    const onStatus = (s) => handler({ event: 'status', status: s });
    const onStats = (s) => handler({ event: 'stats', stats: s });
    r.on('console', onConsole);
    r.on('status', onStatus);
    r.on('stats', onStats);
    return () => {
      r.off('console', onConsole);
      r.off('status', onStatus);
      r.off('stats', onStats);
    };
  },

  start(server) {
    const r = rt(server.id);
    if (r.proc) return { ok: false, error: 'Server already running' };
    if (r.status === 'installing') return { ok: false, error: 'Server is currently installing' };
    if (server.suspended) return { ok: false, error: 'Server is suspended' };

    const egg = db.get('eggs', server.eggId);
    const dir = volumeDir(server);
    const cmd = resolveStartup(server, egg);
    const [program, ...args] = tokenize(cmd);
    if (!program) return { ok: false, error: 'Invalid startup command' };

    r.setStatus('starting');
    r.startedAt = Date.now();
    r.pushLine(`\u001b[36m[Cloud Panel]\u001b[0m Starting server '${server.name}'...`);
    r.pushLine(`\u001b[90m$ ${cmd}\u001b[0m`);

    let proc;
    try {
      isolation.chownTree(dir); // make sure the unprivileged server user owns its volume
      proc = spawn(program, args, {
        cwd: dir,
        env: buildEnv(server, egg),
        windowsHide: true,
        ...isolation.spawnCreds(), // drop to the server user when isolation is enabled
      });
    } catch (err) {
      r.setStatus('crashed');
      r.pushLine(`\u001b[31m[Cloud Panel] Failed to spawn: ${err.message}\u001b[0m`, 'err');
      return { ok: false, error: err.message };
    }

    r.proc = proc;
    let markedRunning = false;
    const markRunning = () => {
      if (markedRunning || !r.proc) return;
      markedRunning = true;
      r.setStatus('running');
    };
    const runningTimer = setTimeout(markRunning, 4000);

    const onData = (buf, stream) => {
      const text = buf.toString('utf8');
      for (const raw of text.split(/\r?\n/)) {
        if (raw === '') continue;
        r.pushLine(raw, stream);
        if (!markedRunning && DONE_RE.test(raw)) markRunning();
      }
    };
    proc.stdout.on('data', (b) => onData(b, 'out'));
    proc.stderr.on('data', (b) => onData(b, 'err'));

    proc.on('error', (err) => {
      r.pushLine(`\u001b[31m[Cloud Panel] Process error: ${err.message}\u001b[0m`, 'err');
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(runningTimer);
      if (proc.pid) stats.forget(proc.pid);
      r.proc = null;
      const wasStopping = r.status === 'stopping';
      const clean = code === 0 || signal === 'SIGTERM' || signal === 'SIGINT';
      r.pushLine(
        `\u001b[33m[Cloud Panel] Process exited (code=${code}, signal=${signal || 'none'})\u001b[0m`
      );
      r.setStatus(wasStopping || clean ? 'offline' : 'crashed');
      r.stats = { cpu: 0, memory: 0, memoryLimit: 0, disk: r.stats.disk || 0, diskLimit: r.stats.diskLimit || 0, uptime: 0 };
      r.emit('stats', r.stats);
    });

    ensureStatsLoop();
    db.log({ type: 'power', serverId: server.id, message: `Server '${server.name}' started` });
    return { ok: true };
  },

  command(serverId, input) {
    const r = rt(serverId);
    if (!r.proc || !r.proc.stdin.writable)
      return { ok: false, error: 'Server is not running' };
    r.pushLine(`\u001b[32m> ${input}\u001b[0m`, 'in');
    r.proc.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
    return { ok: true };
  },

  stop(server) {
    const r = rt(server.id);
    if (!r.proc) return { ok: false, error: 'Server is not running' };
    const egg = db.get('eggs', server.eggId);
    const stopCmd = egg?.stopCommand || 'stop';
    r.setStatus('stopping');
    r.pushLine(`\u001b[36m[Cloud Panel]\u001b[0m Stopping server...`);
    if (stopCmd === '^C' || stopCmd === 'SIGINT') {
      r.proc.kill('SIGINT');
    } else if (r.proc.stdin.writable) {
      r.proc.stdin.write(`${stopCmd}\n`);
    } else {
      r.proc.kill('SIGTERM');
    }
    // Hard timeout fallback.
    const proc = r.proc;
    setTimeout(() => {
      if (r.proc === proc && proc && !proc.killed) {
        r.pushLine(`\u001b[31m[Cloud Panel] Graceful stop timed out — killing.\u001b[0m`, 'err');
        try {
          proc.kill('SIGKILL');
        } catch {}
      }
    }, 12000);
    db.log({ type: 'power', serverId: server.id, message: `Server '${server.name}' stopping` });
    return { ok: true };
  },

  kill(server) {
    const r = rt(server.id);
    if (!r.proc) return { ok: false, error: 'Server is not running' };
    r.setStatus('stopping');
    r.pushLine(`\u001b[31m[Cloud Panel] Killing process...\u001b[0m`, 'err');
    try {
      r.proc.kill('SIGKILL');
    } catch (err) {
      return { ok: false, error: err.message };
    }
    db.log({ type: 'power', serverId: server.id, message: `Server '${server.name}' killed` });
    return { ok: true };
  },

  async restart(server) {
    const r = rt(server.id);
    if (r.proc) {
      this.stop(server);
      await new Promise((resolve) => {
        const t = setInterval(() => {
          if (!r.proc) {
            clearInterval(t);
            resolve();
          }
        }, 200);
        setTimeout(() => {
          clearInterval(t);
          resolve();
        }, 13000);
      });
    }
    return this.start(server);
  },

  power(server, action) {
    switch (action) {
      case 'start':
        return this.start(server);
      case 'stop':
        return this.stop(server);
      case 'restart':
        return this.restart(server);
      case 'kill':
        return this.kill(server);
      default:
        return { ok: false, error: `Unknown power action: ${action}` };
    }
  },

  /** Provision real server files from the egg's installer. */
  async provision(server, { trigger = 'install' } = {}) {
    const r = rt(server.id);
    if (r.proc) return { ok: false, error: 'Stop the server before (re)installing' };
    const egg = db.get('eggs', server.eggId);
    if (!egg || !installers.has(egg.installer)) return { ok: true, skipped: true };

    r.setStatus('installing');
    r.pushLine(
      `\u001b[36m[Cloud Panel]\u001b[0m ${trigger === 'reinstall' ? 'Reinstalling' : 'Installing'} '${egg.name}'…`
    );
    const vars = {
      ...(egg.variables || []).reduce((acc, v) => { acc[v.env] = v.default; return acc; }, {}),
      ...(server.environment || {}),
    };
    try {
      await installers.run(egg.installer, { dir: volumeDir(server), vars, log: (l) => r.pushLine(l) });
      r.pushLine('\u001b[32m[Cloud Panel] Installation finished — server is ready to start.\u001b[0m');
      r.setStatus('offline');
      db.log({ type: 'install', serverId: server.id, message: `Installed ${egg.name} on '${server.name}'` });
      return { ok: true };
    } catch (err) {
      r.pushLine(`\u001b[31m[Cloud Panel] Install failed: ${err.message}\u001b[0m`, 'err');
      r.setStatus('offline');
      return { ok: false, error: err.message };
    }
  },

  isInstalling(serverId) {
    return rt(serverId).status === 'installing';
  },

  shutdownAll() {
    for (const r of runtimes.values()) {
      if (r.proc) {
        try {
          r.proc.kill('SIGTERM');
        } catch {}
      }
    }
  },
};

module.exports = manager;
