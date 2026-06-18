'use strict';

/**
 * Cloud Panel demo game server.
 *
 * A self-contained, dependency-free simulated game server so the panel's
 * console, power controls and live stats work out-of-the-box with zero setup.
 * Reads MAX_PLAYERS / MOTD / SERVER_PORT from the environment (injected by the
 * panel from the server's allocation + variables).
 */

const net = require('net');
const readline = require('readline');

const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '20', 10);
const MOTD = process.env.MOTD || 'A Cloud Panel server';
const PORT = parseInt(process.env.SERVER_PORT || '0', 10);

const NAMES = ['Steve', 'Alex', 'Notch', 'Herobrine', 'Creeper_King', 'xX_Dragon_Xx', 'PixelPaladin', 'VoidWalker', 'LavaLord', 'EnderQueen'];
const players = new Set();
let listener = null;
let ticking = true;

function ts() {
  return new Date().toTimeString().slice(0, 8);
}
function log(level, msg) {
  process.stdout.write(`[${ts()}] [Server thread/${level}]: ${msg}\n`);
}

async function boot() {
  log('INFO', 'Starting Cloud Panel demo server version 1.0.0');
  await sleep(250);
  log('INFO', `Loading properties (max-players=${MAX_PLAYERS})`);
  await sleep(250);
  log('INFO', `Default game type: SURVIVAL`);
  log('INFO', `MOTD: ${MOTD}`);
  await sleep(300);
  log('INFO', 'Preparing level "world"');
  for (const region of ['spawn', '-1,0', '0,-1', '1,1']) {
    await sleep(220);
    log('INFO', `Preparing spawn area: region ${region}`);
  }
  await sleep(300);

  if (PORT > 0) {
    listener = net
      .createServer((sock) => sock.end('Cloud Panel demo server\n'))
      .listen(PORT, () => log('INFO', `Listening on 0.0.0.0:${PORT}`))
      .on('error', (err) => log('WARN', `Could not bind port ${PORT}: ${err.code}`));
  }

  await sleep(400);
  log('INFO', 'Done (2.137s)! For help, type "help"');
  startAmbient();
}

function startAmbient() {
  // Random join/leave/chatter so the console feels alive.
  setInterval(() => {
    if (!ticking) return;
    const roll = Math.random();
    if (roll < 0.35 && players.size < MAX_PLAYERS) {
      const name = NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10);
      if (!players.has(name)) {
        players.add(name);
        log('INFO', `${name} joined the game`);
        log('INFO', `${name} has made the advancement [Getting Started]`);
      }
    } else if (roll < 0.5 && players.size > 0) {
      const name = [...players][Math.floor(Math.random() * players.size)];
      players.delete(name);
      log('INFO', `${name} left the game`);
    } else if (roll < 0.7 && players.size > 0) {
      const name = [...players][Math.floor(Math.random() * players.size)];
      const lines = ['gg', 'anyone got diamonds?', 'nice base!', 'creeper near spawn', 'lag?', 'wts netherite'];
      log('INFO', `<${name}> ${lines[Math.floor(Math.random() * lines.length)]}`);
    }
  }, 3500);

  // Keep a little CPU + memory activity so stats graphs move.
  const churn = [];
  setInterval(() => {
    let x = 0;
    for (let i = 0; i < 2e5; i++) x += Math.sqrt(i) * Math.random();
    churn.push(Buffer.alloc(64 * 1024).fill(x % 255));
    if (churn.length > 16) churn.splice(0, 8);
  }, 2000);
}

function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;
  const [name, ...args] = cmd.split(/\s+/);

  switch (name.toLowerCase()) {
    case 'help':
      log('INFO', 'Commands: help, list, players, say <msg>, tps, kick <p>, time, version, stop');
      break;
    case 'list':
    case 'players':
      log('INFO', `There are ${players.size}/${MAX_PLAYERS} players online:`);
      log('INFO', [...players].join(', ') || '(none)');
      break;
    case 'say':
      log('INFO', `[Server] ${args.join(' ') || '...'}`);
      break;
    case 'tps':
      log('INFO', 'TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.9');
      break;
    case 'time':
      log('INFO', `World time: ${Math.floor(Math.random() * 24000)} ticks`);
      break;
    case 'version':
      log('INFO', 'Cloud Panel demo server 1.0.0 (protocol 763)');
      break;
    case 'kick': {
      const target = args[0];
      if (target && players.has(target)) {
        players.delete(target);
        log('INFO', `Kicked ${target}: Kicked by an operator`);
      } else {
        log('WARN', `That player is not online`);
      }
      break;
    }
    case 'stop':
      return shutdown();
    default:
      log('WARN', `Unknown command "${name}". Type "help" for commands.`);
  }
}

function shutdown() {
  ticking = false;
  log('INFO', 'Stopping the server');
  log('INFO', 'Saving players');
  log('INFO', 'Saving worlds');
  setTimeout(() => {
    log('INFO', 'Saving chunks for level "world"');
    if (listener) listener.close();
    setTimeout(() => {
      log('INFO', 'ThreadedAnvilChunkStorage: All dimensions are saved');
      process.exit(0);
    }, 300);
  }, 400);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', handleCommand);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

boot();
