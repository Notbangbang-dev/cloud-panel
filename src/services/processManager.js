'use strict';

/**
 * Real process manager. Each Cloud Panel server maps to a child process.
 * Streams stdout/stderr, accepts console input, tracks status, and samples
 * live CPU / memory usage via pidusage. Subscribers (the WebSocket console)
 * receive console lines, status transitions, and stats ticks.
 */

const { spawn } = require('child_process');
const isolation = require('./isolation');
const oci = require('./oci');
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
    this.oci = false; // true when this server runs inside an OCI container
    this.containerName = null;
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

/** All ports a server should expose (primary + any additional allocations). */
function serverPorts(server) {
  const ports = [];
  const p = primaryPort(server);
  if (p) ports.push(p);
  for (const id of server.additionalAllocationIds || []) {
    const a = db.get('allocations', id);
    if (a && a.port && !ports.includes(a.port)) ports.push(a.port);
  }
  return ports;
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

function buildEnv(server, egg, { host = true } = {}) {
  const env = {};
  // Host child processes inherit a small allow-list of host vars (PATH, etc.).
  // Containers bring their own base environment from the image, so we start
  // clean and pass through only the server's own variables.
  if (host) {
    for (const k of ENV_PASSTHROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  env.SERVER_MEMORY = String(server.limits?.memory ?? 1024);
  env.SERVER_PORT = String(primaryPort(server) ?? '');
  env.SERVER_UUID = server.uuid;
  for (const v of egg?.variables || []) env[v.env] = v.default;
  for (const [k, val] of Object.entries(server.environment || {})) env[k] = String(val);
  return env;
}

let statsLoop = null;
let sampling = false;

/** Apply a {cpu, memory} sample onto a runtime, filling in plan limits + disk. */
function applyStats(r, s) {
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

/** Single shared loop that samples every running process/container every 2s. */
function ensureStatsLoop() {
  if (statsLoop) return;
  statsLoop = setInterval(async () => {
    if (sampling) return;
    const running = [...runtimes.values()].filter((r) => r.proc);
    // Host processes are sampled by PID; containers by name (their real PID is
    // not the panel's child — the engine client is — so pidusage can't see them).
    const hostRts = running.filter((r) => !r.oci && r.proc.pid);
    const ociRts = running.filter((r) => r.oci && r.containerName);
    if (!hostRts.length && !ociRts.length) return;
    sampling = true;
    try {
      let hostResult = new Map();
      let ociResult = new Map();
      await Promise.all([
        hostRts.length
          ? stats.sample(hostRts.map((r) => r.proc.pid)).then((m) => { hostResult = m; })
          : Promise.resolve(),
        ociRts.length
          ? oci.sampleStats(ociRts.map((r) => r.containerName)).then((m) => { ociResult = m; })
          : Promise.resolve(),
      ]);
      for (const r of hostRts) {
        const s = hostResult.get(r.proc.pid);
        if (s) applyStats(r, s);
      }
      for (const r of ociRts) {
        const s = ociResult.get(r.containerName);
        if (s) applyStats(r, s);
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

    // When container isolation is REQUIRED (CP_OCI=1) but the engine is missing,
    // refuse to start rather than silently running unsandboxed (see oci.js).
    if (oci.enabled() && !oci.available()) {
      return {
        ok: false,
        error: `Container sandbox required (CP_OCI=1) but the '${oci.runtimeName()}' engine is unavailable. Install it or unset CP_OCI.`,
      };
    }
    const useOci = oci.active();

    const egg = db.get('eggs', server.eggId);
    const dir = volumeDir(server);
    const cmd = resolveStartup(server, egg);
    const [program, ...args] = tokenize(cmd);
    if (!cmd || (!useOci && !program)) return { ok: false, error: 'Invalid startup command' };

    r.setStatus('starting');
    r.startedAt = Date.now();
    r.pushLine(`\u001b[36m[Cloud Panel]\u001b[0m Starting server '${server.name}'...`);
    r.pushLine(`\u001b[90m$ ${cmd}\u001b[0m`);

    let proc;
    try {
      if (useOci) {
        const env = buildEnv(server, egg, { host: false });
        const { name, image, args: runArgs } = oci.buildRunArgs({
          server, egg, cmd, dir, ports: serverPorts(server), env,
        });
        r.oci = true;
        r.containerName = name;
        r.pushLine(`\u001b[90m[oci] ${oci.runtimeName()} run ${image} — sandboxed container '${name}'\u001b[0m`);
        oci.removeSync(server.id); // clear any container left over from an unclean shutdown
        proc = spawn(oci.runtimeName(), runArgs, { windowsHide: true });
      } else {
        r.oci = false;
        r.containerName = null;
        isolation.chownTree(dir); // make sure the unprivileged server user owns its volume
        proc = spawn(program, args, {
          cwd: dir,
          env: buildEnv(server, egg),
          windowsHide: true,
          ...isolation.spawnCreds(), // drop to the server user when isolation is enabled
        });
      }
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
      // Ensure the container is gone even if `--rm` didn't fire (e.g. the engine
      // client died abnormally). Best-effort; ignores "no such container".
      if (r.oci && r.containerName) { oci.remove(server.id).catch(() => {}); }
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
      // Containers: signal the container's main process; host: signal the child.
      if (r.oci && r.containerName) oci.signal(server.id, 'INT').catch(() => {});
      else r.proc.kill('SIGINT');
    } else if (r.proc.stdin.writable) {
      // Graceful in-game stop ("stop"/"end"/…). Works for both: the container's
      // stdin is attached to the engine client we spawned with `run -i`.
      r.proc.stdin.write(`${stopCmd}\n`);
    } else if (r.oci && r.containerName) {
      oci.stop(server.id).catch(() => {});
    } else {
      r.proc.kill('SIGTERM');
    }
    // Hard timeout fallback.
    const proc = r.proc;
    setTimeout(() => {
      if (r.proc === proc && proc && !proc.killed) {
        r.pushLine(`\u001b[31m[Cloud Panel] Graceful stop timed out — killing.\u001b[0m`, 'err');
        try {
          // Killing the engine client may not stop the container, so kill it by name.
          if (r.oci && r.containerName) oci.kill(server.id).catch(() => {});
          else proc.kill('SIGKILL');
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
      if (r.oci && r.containerName) oci.kill(server.id).catch(() => {});
      else r.proc.kill('SIGKILL');
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
      const result = await installers.run(egg.installer, { dir: volumeDir(server), vars, log: (l) => r.pushLine(l) });
      // Some installers (Forge/NeoForge) generate version-specific run args and
      // return the exact startup command to use.
      if (result && result.startup) {
        db.update('servers', server.id, { startup: result.startup });
        server.startup = result.startup;
      }
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
          if (r.oci && r.containerName) oci.stop(r.serverId, { timeout: 5 }).catch(() => {});
          else r.proc.kill('SIGTERM');
        } catch {}
      }
    }
  },
};

module.exports = manager;
