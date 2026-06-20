'use strict';

/**
 * Cloud Panel data layer.
 *
 * Primary backend: SQLite (better-sqlite3) — a real, durable, ACID database.
 * Fallback backend: atomic JSON file — used only when better-sqlite3 cannot be
 * loaded (e.g. a platform without prebuilt binaries and no compiler), so the
 * panel always runs.
 *
 * Both backends expose the same document-style API used across the codebase.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const COLLECTIONS = ['users', 'locations', 'nodes', 'eggs', 'servers', 'allocations', 'activity', 'settings', 'backups', 'automations'];

/** Global, admin-editable settings (economy, registration, defaults, shop). */
const SETTINGS_DEFAULTS = {
  economy: { enabled: true },
  registration: { enabled: true, requireApproval: true },
  defaults: { coins: 500, memory: 2048, cpu: 150, disk: 10240, servers: 2, backups: 1 },
  limits: { minMemory: 256, minCpu: 25, minDisk: 1024 },
  afk: { enabled: true, coins: 1, intervalSeconds: 30 },
  shop: {
    memory: { price: 100, amount: 1024 },
    cpu: { price: 150, amount: 50 },
    disk: { price: 60, amount: 5120 },
    servers: { price: 400, amount: 1 },
    backups: { price: 250, amount: 1 },
  },
  // Look & feel — fully admin-customizable theming (see services/appearance.js).
  // NOTE: keep this default in sync with DEFAULT_APPEARANCE in services/appearance.js.
  appearance: {
    preset: 'nebula',
    colors: {}, // optional overrides: { bg, surface, text, primary, secondary, accent }
    background: { type: 'preset', value: '', fit: 'cover', blur: 0, dim: 35, fixed: true },
    effects: { animations: true, glass: true, radius: 16 },
    brand: { name: '', tagline: '' },
    customCss: '',
  },
  // Discord OAuth2 login — the operator supplies their own Discord app
  // credentials in Admin → Login. Disabled until configured.
  oauth: {
    discord: { enabled: false, clientId: '', clientSecret: '', redirectUri: '', createAccounts: true },
  },
};

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
function uuid() {
  return crypto.randomUUID();
}
function ensureDirs() {
  for (const dir of [config.dataDir, config.volumesDir]) fs.mkdirSync(dir, { recursive: true });
}

/* ============================================================
   SQLite backend (better-sqlite3)
   ============================================================ */
function makeSqliteBackend() {
  const Database = require('better-sqlite3');
  ensureDirs();
  const sqlite = new Database(config.sqliteFile);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000'); // tolerate CLI + server writing concurrently

  for (const name of COLLECTIONS) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, doc TEXT NOT NULL)`);
  }

  const stmts = {};
  for (const name of COLLECTIONS) {
    stmts[name] = {
      all: sqlite.prepare(`SELECT doc FROM ${name} ORDER BY rowid ASC`),
      allDesc: sqlite.prepare(`SELECT doc FROM ${name} ORDER BY rowid DESC`),
      get: sqlite.prepare(`SELECT doc FROM ${name} WHERE id = ?`),
      insert: sqlite.prepare(`INSERT OR REPLACE INTO ${name} (id, doc) VALUES (?, ?)`),
      del: sqlite.prepare(`DELETE FROM ${name} WHERE id = ?`),
      count: sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`),
    };
  }
  const trimActivity = sqlite.prepare(
    `DELETE FROM activity WHERE rowid NOT IN (SELECT rowid FROM activity ORDER BY rowid DESC LIMIT 500)`
  );

  return {
    kind: 'sqlite',
    all(name) {
      const stmt = name === 'activity' ? stmts[name].allDesc : stmts[name].all;
      return stmt.all().map((r) => JSON.parse(r.doc));
    },
    get(name, id) {
      const row = stmts[name].get.get(id);
      return row ? JSON.parse(row.doc) : undefined;
    },
    insert(name, row) {
      stmts[name].insert.run(row.id, JSON.stringify(row));
      return row;
    },
    update(name, id, patch) {
      const row = this.get(name, id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      stmts[name].insert.run(id, JSON.stringify(row));
      return row;
    },
    remove(name, id) {
      return stmts[name].del.run(id).changes > 0;
    },
    count(name) {
      return stmts[name].count.get().n;
    },
    afterLog() {
      trimActivity.run();
    },
    persistNow() {},
    persist() {},
    raw: () => sqlite,
  };
}

/* ============================================================
   JSON fallback backend
   ============================================================ */
function makeJsonBackend() {
  let state = null;
  let writeQueued = false;

  function emptyState() {
    const base = { meta: { createdAt: new Date().toISOString(), version: 1 } };
    for (const c of COLLECTIONS) base[c] = [];
    return base;
  }
  function persistNow() {
    const tmp = `${config.dbFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, config.dbFile);
  }
  function persist() {
    if (writeQueued) return;
    writeQueued = true;
    setImmediate(() => {
      writeQueued = false;
      try { persistNow(); } catch (err) { console.error('[db] persist failed:', err.message); }
    });
  }
  function ensureLoaded() {
    if (state) return;
    ensureDirs();
    if (fs.existsSync(config.dbFile)) {
      try {
        state = JSON.parse(fs.readFileSync(config.dbFile, 'utf8'));
        for (const c of COLLECTIONS) if (!state[c]) state[c] = [];
        return;
      } catch (err) {
        const backup = `${config.dbFile}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(config.dbFile, backup); } catch {}
        console.warn(`[db] corrupt JSON store backed up to ${backup}: ${err.message}`);
      }
    }
    state = emptyState();
  }

  return {
    kind: 'json',
    all(name) { ensureLoaded(); return name === 'activity' ? state[name].slice() : state[name].slice(); },
    get(name, id) { ensureLoaded(); return state[name].find((r) => r.id === id); },
    insert(name, row) {
      ensureLoaded();
      if (name === 'activity') state[name].unshift(row);
      else state[name].push(row);
      persist();
      return row;
    },
    update(name, id, patch) {
      ensureLoaded();
      const row = state[name].find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      persist();
      return row;
    },
    remove(name, id) {
      ensureLoaded();
      const idx = state[name].findIndex((r) => r.id === id);
      if (idx === -1) return false;
      state[name].splice(idx, 1);
      persist();
      return true;
    },
    count(name) { ensureLoaded(); return state[name].length; },
    afterLog() {
      if (state.activity.length > 500) state.activity.length = 500;
    },
    persistNow() { ensureLoaded(); persistNow(); },
    persist,
    raw: () => state,
  };
}

/* ============================================================
   Facade
   ============================================================ */
let backend = null;

function selectBackend() {
  if (config.forceJsonStore) return makeJsonBackend();
  try {
    const b = makeSqliteBackend();
    console.log('[db] using SQLite backend ->', config.sqliteFile);
    return b;
  } catch (err) {
    console.warn(`[db] SQLite unavailable (${err.message}); falling back to JSON store.`);
    return makeJsonBackend();
  }
}

const db = {
  uid,
  uuid,
  get backend() { return backend; },
  raw: () => backend && backend.raw(),

  load() {
    if (!backend) backend = selectBackend();
    ensureDirs();
    if (backend.count('nodes') === 0) {
      seedInfra(); // infrastructure only — no default users/servers
      console.log('[db] seeded infrastructure (no default users)');
    }
    ensureEggs(); // idempotently add any newly-shipped egg templates
    ensureSettings(); // economy / registration / defaults / shop
    migrateUsers(); // backfill status/coins/resources on existing users
    return db;
  },

  /** The global settings document (always present after load). */
  settings() {
    return backend.get('settings', 'global') || { id: 'global', ...SETTINGS_DEFAULTS };
  },

  /** True when no users exist yet → the panel needs first-run setup. */
  needsSetup() {
    if (!backend) backend = selectBackend();
    return backend.count('users') === 0;
  },

  all(name) { return backend.all(name); },
  find(name, predicate) { return backend.all(name).find(predicate); },
  filter(name, predicate) { return backend.all(name).filter(predicate); },
  get(name, id) { return backend.get(name, id); },
  insert(name, row) { return backend.insert(name, row); },
  update(name, id, patch) { return backend.update(name, id, patch); },
  remove(name, id) { return backend.remove(name, id); },

  log(entry) {
    backend.insert('activity', { id: uid('act'), createdAt: new Date().toISOString(), ...entry });
    backend.afterLog();
  },

  persist() { backend.persist(); },
  persistNow() { backend.persistNow(); },
};

/* ============================================================
   Egg catalog — pre-installed server templates ("eggs")
   ============================================================ */
const MC_DOCKER = 'eclipse-temurin:21-jre';
const MC_START = 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui';
const PROXY_START = 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar';

function eggCatalog() {
  return [
    {
      name: 'Cloud Demo Server', category: 'Demo', installer: 'none',
      description:
        'A built-in simulated game server. Boots instantly, streams live logs and accepts console commands. Zero setup — no Java required.',
      docker: 'node:lts', startup: 'node "{{DEMO_PATH}}"', stopCommand: 'stop',
      variables: [
        { name: 'Max Players', env: 'MAX_PLAYERS', default: '20', userEditable: true },
        { name: 'MOTD', env: 'MOTD', default: 'A Cloud Panel server', userEditable: true },
      ],
    },
    {
      name: 'Minecraft: Paper', category: 'Minecraft: Java', installer: 'paper',
      description:
        'High-performance PaperMC server. Downloads the real Paper jar for the chosen version/build and accepts the EULA.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [
        { name: 'Minecraft Version', env: 'MINECRAFT_VERSION', default: 'latest', userEditable: true },
        { name: 'Build', env: 'BUILD_NUMBER', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Minecraft: Purpur', category: 'Minecraft: Java', installer: 'purpur',
      description:
        'Purpur — a drop-in Paper fork with extra configuration and gameplay options. Downloads the real Purpur jar and accepts the EULA.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [
        { name: 'Minecraft Version', env: 'MINECRAFT_VERSION', default: 'latest', userEditable: true },
        { name: 'Build', env: 'BUILD_NUMBER', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Minecraft: Folia', category: 'Minecraft: Java', installer: 'folia',
      description:
        'Folia — Paper\'s regionised multithreaded server for very large player counts. Downloads the real Folia jar and accepts the EULA.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [
        { name: 'Minecraft Version', env: 'MINECRAFT_VERSION', default: 'latest', userEditable: true },
        { name: 'Build', env: 'BUILD_NUMBER', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Minecraft: Fabric', category: 'Minecraft: Java', installer: 'fabric',
      description:
        'Fabric modded server. Resolves the latest stable game/loader/installer from the Fabric meta API and downloads a ready-to-run server launcher.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [
        { name: 'Minecraft Version', env: 'MINECRAFT_VERSION', default: 'latest', userEditable: true },
        { name: 'Loader Version', env: 'LOADER_VERSION', default: 'latest', userEditable: true },
        { name: 'Installer Version', env: 'INSTALLER_VERSION', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Minecraft: Java (Vanilla)', category: 'Minecraft: Java', installer: 'vanilla',
      description:
        'Official Mojang vanilla server. Resolves the chosen version from the Mojang manifest, downloads the real server jar and accepts the EULA.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [{ name: 'Version', env: 'MINECRAFT_VERSION', default: 'latest', userEditable: true }],
    },
    {
      name: 'Velocity Proxy', category: 'Minecraft: Proxy', installer: 'velocity',
      description:
        'Modern, high-performance Minecraft proxy (network of servers). Downloads the real Velocity jar; velocity.toml is generated on first start.',
      docker: MC_DOCKER, startup: PROXY_START, stopCommand: 'shutdown',
      variables: [
        { name: 'Version', env: 'VERSION', default: 'latest', userEditable: true },
        { name: 'Build', env: 'BUILD', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Waterfall Proxy', category: 'Minecraft: Proxy', installer: 'waterfall',
      description:
        'BungeeCord-based proxy fork. Downloads the real Waterfall jar; config.yml is generated on first start.',
      docker: MC_DOCKER, startup: PROXY_START, stopCommand: 'end',
      variables: [
        { name: 'Version', env: 'VERSION', default: 'latest', userEditable: true },
        { name: 'Build', env: 'BUILD', default: 'latest', userEditable: true },
      ],
    },
    {
      name: 'Generic Java (jar)', category: 'Generic', installer: 'none',
      description: 'Run any Java jar you upload via SFTP. Set the jar filename and start.',
      docker: MC_DOCKER, startup: 'java -Xmx{{SERVER_MEMORY}}M -jar {{JARFILE}}', stopCommand: '^C',
      variables: [{ name: 'Jar file', env: 'JARFILE', default: 'server.jar', userEditable: true }],
    },
    {
      name: 'Node.js Application', category: 'Generic', installer: 'none',
      description: 'Run any Node.js app from its entrypoint. Upload your code via SFTP, set the entrypoint, and start.',
      docker: 'node:lts', startup: 'node {{ENTRYPOINT}}', stopCommand: '^C',
      variables: [{ name: 'Entrypoint', env: 'ENTRYPOINT', default: 'index.js', userEditable: true }],
    },
    {
      name: 'Python Application', category: 'Generic', installer: 'none',
      description: 'Run any Python app/bot. Upload your code via SFTP, set the entry file, and start.',
      docker: 'python:3', startup: 'python {{PY_FILE}}', stopCommand: '^C',
      variables: [{ name: 'Entry file', env: 'PY_FILE', default: 'bot.py', userEditable: true }],
    },
    {
      name: 'BungeeCord', category: 'Minecraft: Proxy', installer: 'bungeecord',
      description: 'Classic Minecraft proxy that links multiple servers into one network. Downloads the latest BungeeCord build; config.yml is generated on first start.',
      docker: MC_DOCKER, startup: PROXY_START, stopCommand: 'end',
      variables: [],
    },
    {
      name: 'Geyser (Bedrock Bridge)', category: 'Minecraft: Proxy', installer: 'geyser',
      description: 'Standalone Geyser proxy — lets Minecraft: Bedrock players join a Java server. Downloads the latest Geyser; edit config.yml to point it at your Java server.',
      docker: MC_DOCKER, startup: PROXY_START, stopCommand: 'stop',
      variables: [],
    },
    {
      name: 'Minecraft: Forge', category: 'Minecraft: Java', installer: 'none',
      description: 'Modded Minecraft (Forge). Upload your Forge server files via SFTP, set the run jar (or edit the startup for modern Forge run args), and start. Accept the EULA in eula.txt.',
      docker: MC_DOCKER, startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui', stopCommand: 'stop',
      variables: [{ name: 'Server jar', env: 'SERVER_JARFILE', default: 'server.jar', userEditable: true }],
    },
    {
      name: 'Minecraft: NeoForge', category: 'Minecraft: Java', installer: 'none',
      description: 'Modded Minecraft (NeoForge). Upload your NeoForge server files via SFTP, set the run jar (or edit the startup for run args), and start. Accept the EULA in eula.txt.',
      docker: MC_DOCKER, startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui', stopCommand: 'stop',
      variables: [{ name: 'Server jar', env: 'SERVER_JARFILE', default: 'server.jar', userEditable: true }],
    },
    {
      name: 'Minecraft: Spigot', category: 'Minecraft: Java', installer: 'none',
      description: 'Spigot / CraftBukkit (plugins). Build with BuildTools and upload the result as server.jar via SFTP, then start. Accept the EULA in eula.txt.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [],
    },
    {
      name: 'Sponge (SpongeVanilla)', category: 'Minecraft: Java', installer: 'none',
      description: 'SpongeVanilla modding platform. Download SpongeVanilla, upload it as server.jar via SFTP, and start. Accept the EULA in eula.txt.',
      docker: MC_DOCKER, startup: MC_START, stopCommand: 'stop',
      variables: [],
    },
    {
      name: 'Minecraft: Bedrock Edition', category: 'Minecraft: Bedrock', installer: 'none',
      description: 'Official Bedrock Dedicated Server. Download it from minecraft.net, upload the files via SFTP, and start. (Linux host.)',
      docker: 'ubuntu:22.04', startup: './bedrock_server', stopCommand: 'stop',
      variables: [{ name: 'Library path', env: 'LD_LIBRARY_PATH', default: '.', userEditable: false }],
    },
    {
      name: 'Terraria', category: 'Terraria', installer: 'none',
      description: 'Terraria dedicated server. Download the server from terraria.org, upload the files via SFTP, set the binary name, and start.',
      docker: 'ubuntu:22.04', startup: './{{SERVER_BINARY}}', stopCommand: 'exit',
      variables: [{ name: 'Server binary', env: 'SERVER_BINARY', default: 'TerrariaServer.bin.x86_64', userEditable: true }],
    },
  ];
}

/** Idempotently insert any catalog egg whose name is not already present. */
function ensureEggs() {
  const existing = new Set(backend.all('eggs').map((e) => e.name));
  const now = new Date().toISOString();
  let added = 0;
  for (const e of eggCatalog()) {
    if (!existing.has(e.name)) {
      backend.insert('eggs', { id: uid('egg'), uuid: uuid(), createdAt: now, ...e });
      added++;
    }
  }
  if (added) console.log(`[db] added ${added} egg template(s) to the catalog`);
}

/** Recursively fill missing keys in target from defaults (no overwrite). */
function fillDefaults(target, defaults) {
  for (const k of Object.keys(defaults)) {
    const dv = defaults[k];
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      fillDefaults(target[k], dv);
    } else if (target[k] === undefined) {
      target[k] = dv;
    }
  }
}

/** Ensure the global settings document exists and has all keys. */
function ensureSettings() {
  const cur = backend.get('settings', 'global');
  if (!cur) {
    backend.insert('settings', { id: 'global', ...JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)) });
    return;
  }
  const before = JSON.stringify(cur);
  fillDefaults(cur, SETTINGS_DEFAULTS);
  if (JSON.stringify(cur) !== before) backend.update('settings', 'global', cur);
}

/** Backfill economy fields (status/coins/resources) on pre-existing users. */
function migrateUsers() {
  const s = backend.get('settings', 'global');
  const d = (s && s.defaults) || SETTINGS_DEFAULTS.defaults;
  for (const u of backend.all('users')) {
    const patch = {};
    if (u.status === undefined) patch.status = 'active';
    if (u.tokenVersion === undefined) patch.tokenVersion = 0; // for token revocation
    if (u.discordId === undefined) patch.discordId = null; // Discord OAuth link
    if (u.coins === undefined) patch.coins = d.coins;
    if (!u.resources || typeof u.resources !== 'object')
      patch.resources = { memory: d.memory, cpu: d.cpu, disk: d.disk, servers: d.servers, backups: d.backups };
    else if (u.resources.backups === undefined)
      patch.resources = { ...u.resources, backups: d.backups }; // backfill new backups quota
    if (Object.keys(patch).length) backend.update('users', u.id, patch);
  }
}

/* ============================================================
   Seed — infrastructure only (NO default users, NO default servers).
   The first administrator is created by the setup wizard / CLI.
   ============================================================ */
function seedInfra() {
  const now = new Date().toISOString();

  const locUS = { id: uid('loc'), short: 'us-east', long: 'New York DC1', createdAt: now };
  const locEU = { id: uid('loc'), short: 'eu-west', long: 'Amsterdam DC2', createdAt: now };

  const node = {
    id: uid('node'), uuid: uuid(), name: 'Comet-01', description: 'Primary high-frequency node',
    locationId: locUS.id, fqdn: config.publicHost, scheme: 'http', memory: 65536, memoryOverallocate: 0,
    disk: 1048576, diskOverallocate: 0, cpu: 3200, daemonPort: config.webPort, sftpPort: config.sftpPort,
    maintenance: false, createdAt: now,
  };
  const node2 = {
    id: uid('node'), uuid: uuid(), name: 'Nebula-02', description: 'EU overflow node',
    locationId: locEU.id, fqdn: config.publicHost, scheme: 'http', memory: 32768, memoryOverallocate: 25,
    disk: 524288, diskOverallocate: 0, cpu: 1600, daemonPort: config.webPort, sftpPort: config.sftpPort,
    maintenance: false, createdAt: now,
  };

  // Free allocations across the configured game-server port range.
  const allocs = [];
  for (let p = config.allocationRange.start; p <= config.allocationRange.end; p++) {
    allocs.push({
      id: uid('alloc'), nodeId: node.id, ip: config.publicHost, alias: null, port: p,
      serverId: null, primary: false, createdAt: now,
    });
  }

  backend.insert('locations', locUS);
  backend.insert('locations', locEU);
  backend.insert('nodes', node);
  backend.insert('nodes', node2);
  for (const a of allocs) backend.insert('allocations', a);
  backend.insert('activity', { id: uid('act'), createdAt: now, type: 'system', message: 'Cloud Panel installed — awaiting first-run setup.' });
}

module.exports = db;
