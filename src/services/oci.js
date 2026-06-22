'use strict';

/**
 * OCI container sandbox.
 *
 * The panel's default model spawns each game/app server as a host child
 * process (see processManager.js). For eggs that run user-supplied code
 * (Node/Python/Generic Java/.jar) that means server code executes as the panel
 * user and can read the panel's database, JWT secret and other servers' files
 * (SECURITY.md, finding C1) — i.e. "anyone can run a rootkit and we're fucked".
 *
 * This module adds the strongest isolation: running every server inside its own
 * OCI container via an OCI-compatible engine (Docker or Podman, both of which
 * drive an OCI runtime such as runc/crun). The container *is* the sandbox —
 * filesystem, PID, network and capability isolation, plus hard CPU/RAM/PID
 * caps — so server code can't reach the panel, the host, or its neighbours.
 *
 * Design (mirrors isolation.js):
 *   - Entirely OPT-IN. Everything is a no-op unless `CP_OCI=1`, so the default
 *     deployment is unchanged.
 *   - LOUD on misconfiguration. When containers are required but the engine is
 *     unavailable, `active()` is false and processManager refuses to start a
 *     server rather than silently running it unsandboxed.
 *
 * Each built-in egg already declares its image in `egg.docker`
 * (e.g. eclipse-temurin:21-jre, node:lts, python:3, cm2network/steamcmd) — we
 * reuse it directly; `CP_OCI_IMAGE` is only a fallback for custom eggs.
 */

const { spawn, execFileSync } = require('child_process');
const config = require('../config');

const OCI = config.oci || {};

/** Whether the operator asked for container isolation (CP_OCI=1). */
function enabled() {
  return !!OCI.enabled;
}

/** The configured engine CLI ("docker" | "podman"). */
function runtimeName() {
  return OCI.runtime || 'docker';
}

// Cache the (cheap) binary-presence probe so we don't exec on every call.
let _available = null;
let _version = '';

/** True when the engine CLI is present on PATH (probed once, then cached). */
function available() {
  if (_available !== null) return _available;
  try {
    const out = execFileSync(runtimeName(), ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    _version = String(out).trim().split(/\r?\n/)[0] || '';
    _available = true;
  } catch {
    _available = false;
    _version = '';
  }
  return _available;
}

/** Container isolation is requested AND the engine is usable. */
function active() {
  return enabled() && available();
}

/** Diagnostic snapshot for boot logs and /api/health. */
function status() {
  const on = enabled();
  const have = on && available();
  return {
    enabled: on,
    runtime: runtimeName(),
    available: on ? have : available(),
    version: _version || null,
    active: on && have,
  };
}

/** Container name for a server (stable, DNS/engine-safe). */
function containerName(serverId) {
  const safe = String(serverId).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 200);
  return `cloudpanel-${safe}`;
}

/** Resolve the image for an egg, falling back to CP_OCI_IMAGE. */
function imageFor(egg) {
  return (egg && egg.docker) || OCI.image || '';
}

/** Split a shell-ish string into argv, honoring double quotes (for extraArgs). */
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Format a CPU limit (panel units: 100 = 1 core) as a `--cpus` value. */
function cpusValue(cpu) {
  const n = Number(cpu);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Trim trailing zeros: 150 -> "1.5", 100 -> "1", 25 -> "0.25".
  return String(Math.round((n / 100) * 100) / 100);
}

/** Build `-e KEY=VALUE` pairs from an env object. */
function envArgs(env) {
  const args = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue; // skip illegal env names
    args.push('-e', `${k}=${v}`);
  }
  return args;
}

/** Build `-p [bind:]port:port/proto` pairs for the given ports (tcp + udp). */
function portArgs(ports) {
  const args = [];
  const bind = OCI.bind ? `${OCI.bind}:` : '';
  for (const p of ports) {
    const port = Number(p);
    if (!Number.isInteger(port) || port <= 0) continue;
    args.push('-p', `${bind}${port}:${port}/tcp`);
    args.push('-p', `${bind}${port}:${port}/udp`);
  }
  return args;
}

/**
 * Build the full argv for `run` (excluding the engine binary itself).
 *
 * @param {object} p
 * @param {string[]} p.argv tokenized startup command (program + args), NOT a
 *   shell string — passed to the container verbatim so shell metacharacters in
 *   the (owner-editable) startup line can't be interpreted (LOW-1).
 * @returns {{ name:string, image:string, args:string[] }}
 * @throws when no image can be resolved for the egg, or argv is empty.
 */
function buildRunArgs({ server, egg, argv, dir, ports, env }) {
  const name = containerName(server.id);
  const image = imageFor(egg);
  if (!image) {
    throw new Error(
      `No container image is set for this egg and CP_OCI_IMAGE is empty — ` +
      `cannot run '${server.name}' under the OCI sandbox.`
    );
  }
  if (!Array.isArray(argv) || !argv.length || !argv[0]) {
    throw new Error('Invalid startup command');
  }
  const workdir = OCI.workdir || '/home/container';
  const limits = server.limits || {};

  const args = ['run', '--rm', '-i', '--init', '--name', name];

  // Image pull policy (auto-pulls on first start by default).
  if (OCI.pull && OCI.pull !== '') args.push(`--pull=${OCI.pull}`);

  // The server volume is the container's working directory; nothing else from
  // the host is visible inside the sandbox.
  args.push('-v', `${dir}:${workdir}`, '-w', workdir);

  // ---- Sandbox hardening --------------------------------------------------
  args.push('--cap-drop=ALL');               // no Linux capabilities
  args.push('--security-opt=no-new-privileges'); // can't gain privileges via setuid
  if (OCI.readOnly) {
    args.push('--read-only');                // immutable rootfs…
    args.push('--tmpfs', '/tmp:rw,nosuid,nodev'); // …with a scratch /tmp
  }
  if (Number(OCI.pidsLimit) > 0) args.push('--pids-limit', String(OCI.pidsLimit));

  // ---- Resource limits (from the server's plan) ---------------------------
  const mem = Math.floor(Number(limits.memory) || 0); // MB
  if (mem > 0) {
    args.push('--memory', `${mem}m`);
    // memory-swap == memory disables extra swap (swap limit defaults to 0).
    const swap = Math.max(0, Math.floor(Number(limits.swap) || 0));
    args.push('--memory-swap', `${mem + swap}m`);
  }
  if (OCI.cpuLimit) {
    const cpus = cpusValue(limits.cpu);
    if (cpus) args.push('--cpus', cpus);
  }

  // ---- Identity / network -------------------------------------------------
  if (OCI.user) args.push('--user', OCI.user);
  if (OCI.network) {
    args.push('--network', OCI.network); // host net etc. publishes nothing
  } else {
    args.push(...portArgs(ports));        // default bridge: publish game ports
  }

  // ---- Environment --------------------------------------------------------
  args.push(...envArgs(env));

  // ---- Advanced escape hatch ----------------------------------------------
  if (OCI.extraArgs) args.push(...splitArgs(OCI.extraArgs));

  // ---- Image + command ----------------------------------------------------
  // Pass the startup command as a TOKENIZED argv (exactly like host mode) — NOT
  // through `sh -c`. The image positional marks the end of `run` options, so
  // everything after it is the container's command/args, handed to execve()
  // verbatim. This makes shell metacharacters (;, &&, $(), backticks, …) in the
  // startup line inert: there is no shell to interpret them (LOW-1). `--init`
  // (tini) is PID 1 and forwards signals to the server process.
  args.push(image, ...argv);

  return { name, image, args };
}

/* ============================================================
   Engine control helpers (stop / kill / signal / remove / stats)
   ============================================================ */

/** Run an engine subcommand, resolving with {code, stdout, stderr}. Never rejects. */
function exec(args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(runtimeName(), args, { windowsHide: true });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: String(err && err.message || err) });
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr || String(err.message) }));
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeout);
    if (t.unref) t.unref();
    proc.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

/** Gracefully stop a server's container (SIGTERM, then SIGKILL after `timeout`s). */
function stop(serverId, { timeout = 10 } = {}) {
  return exec(['stop', '-t', String(timeout), containerName(serverId)], { timeout: (timeout + 5) * 1000 });
}

/** Send a specific signal to the container's main process (e.g. INT for ^C eggs). */
function signal(serverId, sig = 'TERM') {
  return exec(['kill', '--signal', String(sig).replace(/^SIG/, ''), containerName(serverId)]);
}

/** Force-kill a server's container (SIGKILL). */
function kill(serverId) {
  return exec(['kill', containerName(serverId)]);
}

/** Best-effort remove a (possibly leftover) container by name. */
function remove(serverId) {
  return exec(['rm', '-f', containerName(serverId)]);
}

/**
 * Synchronously remove a leftover container before (re)starting one with the
 * same name — `run --name` fails if a stale container survived an unclean
 * shutdown. Quick and best-effort; ignores "no such container".
 */
function removeSync(serverId) {
  try {
    execFileSync(runtimeName(), ['rm', '-f', containerName(serverId)], {
      stdio: 'ignore',
      timeout: 8000,
    });
  } catch {
    /* no such container / engine busy — best effort */
  }
}

const MEM_UNITS = {
  b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

/** Parse docker's "256MiB / 2GiB" memory-usage string to bytes (usage part). */
function parseMem(s) {
  const used = String(s || '').split('/')[0].trim();
  const m = used.match(/([\d.]+)\s*([A-Za-z]+)/);
  if (!m) return 0;
  const mult = MEM_UNITS[m[2].toLowerCase()];
  return mult ? Math.round(parseFloat(m[1]) * mult) : 0;
}

/**
 * Sample CPU% and memory for the given container names via `stats --no-stream`.
 * Container PIDs aren't the panel's children (the child is the engine client),
 * so the per-PID sampler in stats.js can't see them — this is the OCI path.
 *
 * @param {string[]} names container names
 * @returns {Promise<Map<string,{cpu:number, memory:number}>>}
 */
async function sampleStats(names) {
  const out = new Map();
  if (!names || !names.length) return out;
  const { code, stdout } = await exec(
    ['stats', '--no-stream', '--no-trunc', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}', ...names],
    { timeout: 8000 }
  );
  if (code !== 0 || !stdout) return out;
  for (const line of stdout.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const [name, cpuStr, memStr] = row.split('|');
    if (!name) continue;
    const cpu = Math.max(0, parseFloat(String(cpuStr).replace('%', '')) || 0);
    out.set(name, { cpu: Math.round(cpu * 10) / 10, memory: parseMem(memStr) });
  }
  return out;
}

/** Boot-time: log the sandbox state and warn loudly when required-but-missing. */
function init() {
  if (!enabled()) return; // host-process mode (default) — nothing to say here.
  if (available()) {
    console.log(
      `[oci] container sandbox ACTIVE — servers run in ${runtimeName()} containers` +
      (_version ? ` (${_version})` : '')
    );
  } else {
    console.warn(
      `[oci] CP_OCI=1 but the '${runtimeName()}' engine was not found on PATH — ` +
      `servers will REFUSE TO START until it is installed (we never run them ` +
      `unsandboxed when isolation is required). Install Docker/Podman or set ` +
      `CP_OCI_RUNTIME, or unset CP_OCI to use host processes. See SECURITY.md.`
    );
  }
}

module.exports = {
  enabled,
  available,
  active,
  status,
  runtimeName,
  containerName,
  imageFor,
  buildRunArgs,
  stop,
  signal,
  kill,
  remove,
  removeSync,
  sampleStats,
  init,
  // exported for tests / inspection
  _internals: { cpusValue, parseMem, portArgs, envArgs, splitArgs },
};
