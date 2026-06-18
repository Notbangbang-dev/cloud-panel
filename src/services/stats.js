'use strict';

/**
 * Cross-platform process stats sampler that does NOT depend on `wmic`
 * (removed from recent Windows builds). Returns CPU% (summed across cores,
 * so 200% == 2 full cores, matching allocation semantics) and RSS bytes.
 *
 *  - Windows : batched PowerShell Get-CimInstance Win32_Process query,
 *              CPU% derived from Kernel+User time deltas.
 *  - Other   : pidusage if available, else /proc fallback is skipped.
 */

const os = require('os');
const { execFile } = require('child_process');

const isWin = process.platform === 'win32';
const last = new Map(); // pid -> { t, cpuTime(ns) }
let pidusage = null;
if (!isWin) {
  try { pidusage = require('pidusage'); } catch { pidusage = null; }
}

function winSample(pids) {
  return new Promise((resolve) => {
    if (!pids.length) return resolve(new Map());
    const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
    const cmd =
      `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
      `Select-Object ProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, timeout: 4000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        const out = new Map();
        if (err || !stdout || !stdout.trim()) return resolve(out);
        let rows;
        try {
          const parsed = JSON.parse(stdout);
          rows = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return resolve(out);
        }
        const now = Date.now();
        const cores = os.cpus().length || 1;
        for (const row of rows) {
          const pid = Number(row.ProcessId);
          // Kernel/User time are in 100-ns units → nanoseconds.
          const cpuTimeNs = (Number(row.KernelModeTime || 0) + Number(row.UserModeTime || 0)) * 100;
          const prev = last.get(pid);
          let cpu = 0;
          if (prev) {
            const dtMs = now - prev.t;
            if (dtMs > 0) {
              const cpuMsUsed = (cpuTimeNs - prev.cpuTime) / 1e6;
              cpu = Math.max(0, Math.min(cores * 100, (cpuMsUsed / dtMs) * 100));
            }
          }
          last.set(pid, { t: now, cpuTime: cpuTimeNs });
          out.set(pid, { cpu: Math.round(cpu * 10) / 10, memory: Number(row.WorkingSetSize || 0) });
        }
        resolve(out);
      }
    );
  });
}

function nixSample(pids) {
  return new Promise((resolve) => {
    if (!pidusage || !pids.length) return resolve(new Map());
    pidusage(pids, (err, res) => {
      const out = new Map();
      if (err || !res) return resolve(out);
      for (const pid of pids) {
        const s = res[pid];
        if (s) out.set(Number(pid), { cpu: Math.round(s.cpu * 10) / 10, memory: s.memory });
      }
      resolve(out);
    });
  });
}

function sample(pids) {
  return isWin ? winSample(pids) : nixSample(pids);
}

function forget(pid) {
  last.delete(pid);
}

module.exports = { sample, forget };
