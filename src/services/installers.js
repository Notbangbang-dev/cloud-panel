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
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

/** Run a `java` command inside the server volume, streaming output to the console. */
function runJava(args, cwd, log) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = spawn('java', args, { cwd, windowsHide: true }); }
    catch (e) { return reject(new Error('Java is required to install this server. ' + e.message)); }
    const pipe = (buf) => String(buf).split(/\r?\n/).forEach((l) => l.trim() && log('  ' + l.trim()));
    proc.stdout.on('data', pipe);
    proc.stderr.on('data', pipe);
    proc.on('error', (e) => reject(new Error('Could not run Java (is it installed?): ' + e.message)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Installer exited with code ' + code))));
  });
}

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

/* ---- BungeeCord (direct jar) -------------------------------------------- */
async function bungeecord({ dir, log }) {
  log('Downloading the latest BungeeCord build…');
  await download('https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar', path.join(dir, 'server.jar'), log);
  log('BungeeCord installed. config.yml is generated on first start.');
}

/* ---- Geyser (standalone, direct download) ------------------------------- */
async function geyser({ dir, log }) {
  log('Downloading the latest Geyser standalone…');
  await download('https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/standalone', path.join(dir, 'server.jar'), log);
  log('Geyser installed. Edit config.yml after first start to point it at your Java server.');
}

/* ---- Forge (downloads + RUNS the official installer) -------------------- */
async function forge({ dir, vars, log }) {
  log('Resolving Forge version…');
  const promos = await fetchJson('https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  let mc = vars.MINECRAFT_VERSION;
  let forgeVer = vars.FORGE_VERSION;
  if (!forgeVer || forgeVer === 'latest') {
    if (!mc || mc === 'latest') {
      const mcs = Object.keys(promos.promos).filter((k) => k.endsWith('-latest')).map((k) => k.replace('-latest', ''));
      mc = mcs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    }
    forgeVer = promos.promos[`${mc}-recommended`] || promos.promos[`${mc}-latest`];
    if (!forgeVer) throw new Error(`No Forge build found for Minecraft ${mc}`);
  }
  const full = `${mc}-${forgeVer}`;
  log(`Downloading Forge ${full} installer…`);
  await download(`https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`, path.join(dir, 'forge-installer.jar'), log);
  log('Running the Forge installer (this can take a minute)…');
  await runJava(['-jar', 'forge-installer.jar', '--installServer'], dir, log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Forge Server');
  try { fs.rmSync(path.join(dir, 'forge-installer.jar'), { force: true }); } catch {}
  log(`Forge ${full} installation complete.`);
  return { startup: `java -Xms128M -Xmx{{SERVER_MEMORY}}M @libraries/net/minecraftforge/forge/${full}/unix_args.txt nogui` };
}

/* ---- NeoForge (downloads + RUNS the official installer) ----------------- */
async function neoforge({ dir, vars, log }) {
  log('Resolving NeoForge version…');
  const meta = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  let ver = vars.NEOFORGE_VERSION;
  if (!ver || ver === 'latest') {
    const all = meta.versions || [];
    const stable = all.filter((v) => !/(beta|alpha|rc|snapshot)/i.test(v));
    ver = (stable.length ? stable : all).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    if (!ver) throw new Error('No NeoForge versions found');
  }
  log(`Downloading NeoForge ${ver} installer…`);
  await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`, path.join(dir, 'neoforge-installer.jar'), log);
  log('Running the NeoForge installer…');
  await runJava(['-jar', 'neoforge-installer.jar', '--installServer'], dir, log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel NeoForge Server');
  try { fs.rmSync(path.join(dir, 'neoforge-installer.jar'), { force: true }); } catch {}
  log(`NeoForge ${ver} installation complete.`);
  return { startup: `java -Xms128M -Xmx{{SERVER_MEMORY}}M @libraries/net/neoforged/neoforge/${ver}/unix_args.txt nogui` };
}

/* ---- Sponge (SpongeVanilla) via the v2 downloads API -------------------- */
async function sponge({ dir, vars, log }) {
  const API = 'https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/spongevanilla';
  log('Resolving SpongeVanilla version…');
  let version = vars.SPONGE_VERSION;
  if (!version || version === 'latest') {
    const list = await fetchJson(`${API}/versions?offset=0&limit=1&recommended=true`);
    version = Object.keys(list.artifacts || {})[0];
    if (!version) {
      const any = await fetchJson(`${API}/versions?offset=0&limit=1`);
      version = Object.keys(any.artifacts || {})[0];
    }
    if (!version) throw new Error('Could not resolve a SpongeVanilla version');
  }
  const meta = await fetchJson(`${API}/versions/${encodeURIComponent(version)}`);
  const assets = meta.assets || [];
  const jar = assets.find((a) => a.extension === 'jar' && a.classifier === 'universal')
    || assets.find((a) => a.extension === 'jar' && (!a.classifier || a.classifier === ''))
    || assets.find((a) => a.extension === 'jar');
  if (!jar || !jar.downloadUrl) throw new Error('No SpongeVanilla server jar found for ' + version);
  log(`Downloading SpongeVanilla ${version}…`);
  await download(jar.downloadUrl, path.join(dir, 'server.jar'), log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Sponge Server');
  log(`SpongeVanilla ${version} installation complete.`);
}

const INSTALLERS = { paper, folia, purpur, vanilla, fabric, velocity, waterfall, bungeecord, geyser, forge, neoforge, sponge };

module.exports = {
  has: (name) => Boolean(INSTALLERS[name]),
  list: () => Object.keys(INSTALLERS),
  run: (name, ctx) => INSTALLERS[name](ctx),
};
