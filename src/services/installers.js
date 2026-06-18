'use strict';

/**
 * Real egg installers. These provision actual game-server files into a
 * server's volume directory using Node's built-in fetch + streams — no shell
 * required, so they work identically on Linux VPS and Windows dev machines.
 *
 * Implemented (auto-downloading) installers:
 *   paper, folia, purpur, vanilla, fabric   (Minecraft: Java)
 *   velocity, waterfall                      (Minecraft: proxies)
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudPanel/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function download(url, dest, log) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudPanel/1.0' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;
  let lastPct = -1;
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    received += chunk.length;
    if (total) {
      const pct = Math.floor((received / total) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; log(`  …downloaded ${pct}% (${(received / 1048576).toFixed(1)} MiB)`); }
    }
  });
  await pipeline(src, fs.createWriteStream(dest));
  log(`  saved ${(received / 1048576).toFixed(1)} MiB -> ${path.basename(dest)}`);
}

function acceptEula(dir, log) {
  fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted via Cloud Panel\neula=true\n`);
  log('Accepted the Minecraft EULA (eula.txt).');
}

function defaultProperties(dir, motd) {
  const p = path.join(dir, 'server.properties');
  if (!fs.existsSync(p)) fs.writeFileSync(p, `motd=${motd}\nmax-players=20\nonline-mode=true\n`);
}

/* ---- PaperMC family (paper / folia / velocity / waterfall) -------------- */
async function paperProject(project, { dir, vars, log }) {
  const API = `https://api.papermc.io/v2/projects/${project}`;
  log(`Resolving ${project} version…`);
  const proj = await fetchJson(API);
  let version = vars.MINECRAFT_VERSION || vars.VERSION;
  if (!version || version === 'latest') version = proj.versions[proj.versions.length - 1];
  if (!proj.versions.includes(version)) throw new Error(`Unknown ${project} version: ${version}`);

  const builds = await fetchJson(`${API}/versions/${version}`);
  let build = vars.BUILD_NUMBER || vars.BUILD;
  if (!build || build === 'latest') build = builds.builds[builds.builds.length - 1];

  const meta = await fetchJson(`${API}/versions/${version}/builds/${build}`);
  const jar = meta.downloads.application.name;
  const url = `${API}/versions/${version}/builds/${build}/downloads/${jar}`;
  log(`Downloading ${project} ${version} build ${build}…`);
  await download(url, path.join(dir, 'server.jar'), log);
  return version;
}

async function paper(ctx) {
  const v = await paperProject('paper', ctx);
  acceptEula(ctx.dir, ctx.log);
  defaultProperties(ctx.dir, 'A Cloud Panel Paper Server');
  ctx.log(`Paper ${v} installation complete.`);
}
async function folia(ctx) {
  const v = await paperProject('folia', ctx);
  acceptEula(ctx.dir, ctx.log);
  defaultProperties(ctx.dir, 'A Cloud Panel Folia Server');
  ctx.log(`Folia ${v} installation complete.`);
}
async function velocity(ctx) {
  const v = await paperProject('velocity', ctx);
  ctx.log(`Velocity ${v} installed. A velocity.toml will be generated on first start.`);
}
async function waterfall(ctx) {
  const v = await paperProject('waterfall', ctx);
  ctx.log(`Waterfall ${v} installed. A config.yml will be generated on first start.`);
}

/* ---- Purpur ------------------------------------------------------------- */
async function purpur({ dir, vars, log }) {
  const API = 'https://api.purpurmc.org/v2/purpur';
  log('Resolving Purpur version…');
  const proj = await fetchJson(API);
  let version = vars.MINECRAFT_VERSION;
  if (!version || version === 'latest') version = proj.versions[proj.versions.length - 1];
  const vmeta = await fetchJson(`${API}/${version}`);
  let build = vars.BUILD_NUMBER;
  if (!build || build === 'latest') build = vmeta.builds.latest;
  log(`Downloading Purpur ${version} build ${build}…`);
  await download(`${API}/${version}/${build}/download`, path.join(dir, 'server.jar'), log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Purpur Server');
  log('Purpur installation complete.');
}

/* ---- Vanilla (Mojang) --------------------------------------------------- */
async function vanilla({ dir, vars, log }) {
  log('Resolving Mojang version manifest…');
  const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  let version = vars.MINECRAFT_VERSION;
  if (!version || version === 'latest') version = manifest.latest.release;
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Unknown Minecraft version: ${version}`);
  const vmeta = await fetchJson(entry.url);
  if (!vmeta.downloads || !vmeta.downloads.server) throw new Error(`No server jar for version ${version}`);
  log(`Downloading Minecraft server ${version}…`);
  await download(vmeta.downloads.server.url, path.join(dir, 'server.jar'), log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Vanilla Server');
  log('Vanilla installation complete.');
}

/* ---- Fabric ------------------------------------------------------------- */
async function fabric({ dir, vars, log }) {
  const META = 'https://meta.fabricmc.net/v2';
  log('Resolving Fabric versions…');
  let game = vars.MINECRAFT_VERSION;
  if (!game || game === 'latest') {
    const games = await fetchJson(`${META}/versions/game`);
    game = (games.find((g) => g.stable) || games[0]).version;
  }
  let loader = vars.LOADER_VERSION;
  if (!loader || loader === 'latest') {
    const loaders = await fetchJson(`${META}/versions/loader`);
    loader = (loaders.find((l) => l.stable) || loaders[0]).version;
  }
  let installer = vars.INSTALLER_VERSION;
  if (!installer || installer === 'latest') {
    const inst = await fetchJson(`${META}/versions/installer`);
    installer = (inst.find((i) => i.stable) || inst[0]).version;
  }
  const url = `${META}/versions/loader/${game}/${loader}/${installer}/server/jar`;
  log(`Downloading Fabric server ${game} (loader ${loader}, installer ${installer})…`);
  await download(url, path.join(dir, 'server.jar'), log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Fabric Server');
  log('Fabric installation complete (libraries download on first start).');
}

const INSTALLERS = { paper, folia, purpur, vanilla, fabric, velocity, waterfall };

module.exports = {
  has: (name) => Boolean(INSTALLERS[name]),
  list: () => Object.keys(INSTALLERS),
  run: (name, ctx) => INSTALLERS[name](ctx),
};
