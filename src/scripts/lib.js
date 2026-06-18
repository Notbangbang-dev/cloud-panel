'use strict';

/** Shared helpers for the Cloud Panel CLI scripts. */

const readline = require('readline');

const C = {
  reset: '\x1b[0m', dim: '\x1b[90m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', violet: '\x1b[35m',
};
const paint = (code, s) => `${code}${s}${C.reset}`;
const ok = (s) => console.log(`${paint(C.green, '✓')} ${s}`);
const err = (s) => console.error(`${paint(C.red, '✗')} ${s}`);
const info = (s) => console.log(`${paint(C.cyan, '›')} ${s}`);
const isTTY = Boolean(process.stdin.isTTY);

function banner(title) {
  const line = '─'.repeat(46);
  console.log(`\n${paint(C.cyan, '☁  Cloud Panel')} ${paint(C.dim, '·')} ${paint(C.bold, title)}\n${paint(C.dim, line)}`);
}

/** Parse argv into { _: [positionals], flags: {} } supporting --k v, --k=v, --flag, -x. */
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) out.flags[a.slice(2)] = argv[++i];
      else out.flags[a.slice(2)] = true;
    } else if (a.startsWith('-') && a.length === 2) {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) out.flags[a.slice(1)] = argv[++i];
      else out.flags[a.slice(1)] = true;
    } else out._.push(a);
  }
  return out;
}

function ask(query, { def = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const q = def ? `${query} ${C.dim}(${def})${C.reset}: ` : `${query}: `;
    rl.question(q, (val) => { rl.close(); resolve((val || '').trim() || def); });
  });
}

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted || /[\r\n]/.test(s)) rl.output.write(s); };
    rl.question(`${query}: `, (val) => { rl.close(); process.stdout.write('\n'); resolve((val || '').trim()); });
    muted = true;
  });
}

async function confirm(query, def = false) {
  if (!isTTY) return def;
  const a = (await ask(`${query} ${C.dim}[${def ? 'Y/n' : 'y/N'}]${C.reset}`)).toLowerCase();
  if (!a) return def;
  return a === 'y' || a === 'yes';
}

function printUsers(list) {
  if (!list.length) { info('No users yet.'); return; }
  console.log(`${C.dim}${'USERNAME'.padEnd(18)}${'EMAIL'.padEnd(30)}${'ROLE'.padEnd(8)}CREATED${C.reset}`);
  for (const u of list) {
    const role = u.admin ? paint(C.violet, 'admin') : 'user';
    const created = new Date(u.createdAt).toISOString().slice(0, 10);
    console.log(`${u.username.padEnd(18)}${(u.email || '').padEnd(30)}${role.padEnd(u.admin ? 16 : 8)}${C.dim}${created}${C.reset}`);
  }
}

module.exports = { C, paint, ok, err, info, banner, parseArgs, ask, askHidden, confirm, printUsers, isTTY };
