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
const nettrust = require('./nettrust');

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

/** Run SteamCMD (tries `steamcmd`, then `steamcmd.sh`) for SteamCMD-based games. */
function runSteam(args, cwd, log) {
  const candidates = process.platform === 'win32' ? ['steamcmd.exe', 'steamcmd'] : ['steamcmd', 'steamcmd.sh'];
  return new Promise((resolve, reject) => {
    let idx = 0;
    const attempt = () => {
      const bin = candidates[idx];
      let proc;
      try { proc = spawn(bin, args, { cwd, windowsHide: true }); }
      catch (e) { return next(e); }
      let spawnFailed = false;
      const pipe = (buf) => String(buf).split(/\r?\n/).forEach((l) => l.trim() && log('  ' + l.trim()));
      proc.stdout.on('data', pipe);
      proc.stderr.on('data', pipe);
      proc.on('error', (e) => { spawnFailed = true; next(e); });
      proc.on('close', (code) => { if (spawnFailed) return; code === 0 ? resolve() : reject(new Error('SteamCMD exited with code ' + code)); });
    };
    const next = (e) => {
      if (++idx < candidates.length) return attempt();
      reject(new Error('SteamCMD is required for this game and was not found on the host. Install steamcmd and try again. (' + e.message + ')'));
    };
    attempt();
  });
}

async function fetchJson(url) {
  // SSRF guard: https + public host, and EVERY redirect hop re-validated.
  const res = await nettrust.safeFetch(url, { headers: { 'User-Agent': 'CloudPanel/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024; // hard ceiling per downloaded file (anti disk-fill DoS)

async function download(url, dest, log) {
  // SSRF guard: only https to public hosts, re-validated on each redirect hop.
  // Closes the modpack-index vector where `.mrpack` files[] (or a 30x redirect)
  // could point at internal services.
  const res = await nettrust.safeFetch(url, { headers: { 'User-Agent': 'CloudPanel/1.0' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  // Early-out on an honest content-length; the running counter below is the real
  // guard since the header is attacker-controlled/optional.
  if (total && total > MAX_DOWNLOAD_BYTES) throw new Error(`Refusing to download ${(total / 1073741824).toFixed(1)} GiB — exceeds the size limit.`);
  let received = 0;
  let lastPct = -1;
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_DOWNLOAD_BYTES) { src.destroy(new Error('Download exceeded the size limit')); return; }
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
async function paperProject(project, { dir, vars, log }, baseUrl = 'https://api.papermc.io/v2/projects') {
  const API = `${baseUrl}/${project}`;
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

/* ---- Quilt (downloads + RUNS the official installer) -------------------- */
async function quilt({ dir, vars, log }) {
  const META = 'https://meta.quiltmc.org/v3';
  log('Resolving Quilt versions…');
  let game = vars.MINECRAFT_VERSION;
  if (!game || game === 'latest') {
    const games = await fetchJson(`${META}/versions/game`);
    game = (games.find((g) => g.stable) || games[0]).version;
  }
  const installers = await fetchJson(`${META}/versions/installer`);
  const installer = installers[0] && installers[0].version;
  if (!installer) throw new Error('Could not resolve a Quilt installer version.');
  log(`Downloading Quilt installer ${installer}…`);
  await download(`https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installer}/quilt-installer-${installer}.jar`, path.join(dir, 'quilt-installer.jar'), log);
  const args = ['-jar', 'quilt-installer.jar', 'install', 'server', game, '--download-server', '--install-dir=.'];
  if (vars.LOADER_VERSION && vars.LOADER_VERSION !== 'latest') args.push(vars.LOADER_VERSION);
  log(`Installing Quilt server for Minecraft ${game}…`);
  await runJava(args, dir, log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Quilt Server');
  try { fs.rmSync(path.join(dir, 'quilt-installer.jar'), { force: true }); } catch {}
  log(`Quilt installation complete (Minecraft ${game}).`);
  return { startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar quilt-server-launch.jar nogui' };
}

/* ---- Pufferfish (Jenkins CI) -------------------------------------------- */
async function pufferfish({ dir, vars, log }) {
  const CI = 'https://ci.pufferfish.host';
  log('Resolving Pufferfish build…');
  const root = await fetchJson(`${CI}/api/json?tree=jobs[name]`);
  const jobs = (root.jobs || []).map((j) => j.name).filter((n) => /^Pufferfish-\d+\.\d+$/.test(n));
  if (!jobs.length) throw new Error('Could not list Pufferfish builds.');
  let job;
  const mc = vars.MINECRAFT_VERSION;
  if (mc && mc !== 'latest') {
    const mm = mc.split('.').slice(0, 2).join('.');
    job = jobs.find((n) => n === `Pufferfish-${mm}`);
    if (!job) throw new Error(`No Pufferfish build for Minecraft ${mc}.`);
  } else {
    job = jobs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  }
  const build = await fetchJson(`${CI}/job/${job}/lastSuccessfulBuild/api/json?tree=artifacts[fileName,relativePath]`);
  const art = (build.artifacts || []).find((a) => /\.jar$/i.test(a.fileName));
  if (!art) throw new Error('No Pufferfish jar artifact found.');
  log(`Downloading ${job} (${art.fileName})…`);
  await download(`${CI}/job/${job}/lastSuccessfulBuild/artifact/${art.relativePath}`, path.join(dir, 'server.jar'), log);
  acceptEula(dir, log);
  defaultProperties(dir, 'A Cloud Panel Pufferfish Server');
  log('Pufferfish installation complete.');
}

/* ---- Leaf (PaperMC-style API) ------------------------------------------- */
async function leaf(ctx) {
  const v = await paperProject('leaf', ctx, 'https://api.leafmc.one/v2/projects');
  acceptEula(ctx.dir, ctx.log);
  defaultProperties(ctx.dir, 'A Cloud Panel Leaf Server');
  ctx.log(`Leaf ${v} installation complete.`);
}

/* ---- PocketMine-MP (Bedrock; direct phar) ------------------------------- */
async function pocketmine({ dir, log }) {
  log('Downloading the latest PocketMine-MP.phar…');
  await download('https://github.com/pmmp/PocketMine-MP/releases/latest/download/PocketMine-MP.phar', path.join(dir, 'PocketMine-MP.phar'), log);
  log('PocketMine-MP installed. It generates its config on first start (PHP must be available on the host).');
}

/* ---- SteamCMD games (Rust / Valheim / CS2 / …) -------------------------- */
async function steamcmd({ dir, vars, log }) {
  const appId = String(vars.STEAM_APP_ID || '').replace(/[^0-9]/g, '');
  if (!appId) throw new Error('A Steam App ID (STEAM_APP_ID) is required for SteamCMD installs.');
  log(`Installing Steam app ${appId} via SteamCMD (this can take a while)…`);
  await runSteam(['+force_install_dir', dir, '+login', 'anonymous', '+app_update', appId, 'validate', '+quit'], dir, log);
  log(`SteamCMD install of app ${appId} complete.`);
}

/* ---- Modrinth modpack (.mrpack one-click) ------------------------------- */
function safeJoin(dir, rel) {
  const clean = path.normalize(rel || '').replace(/^([/\\]|\.\.([/\\]|$))+/, '');
  const abs = path.resolve(dir, clean);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error('Unsafe path in modpack: ' + rel);
  return abs;
}

async function modpack({ dir, vars, log }) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { throw new Error('Modpack installs need the adm-zip package — run "npm install".'); }
  const modrinth = require('./modrinth');

  log(`Resolving Modrinth modpack "${vars.MODPACK}"…`);
  const { slug, version, mrpack } = await modrinth.resolveModpackVersion(vars.MODPACK, vars.MODPACK_VERSION);
  log(`Selected ${slug} ${version.version_number}.`);
  const packPath = path.join(dir, 'pack.mrpack');
  await download(mrpack.url, packPath, log);

  const zip = new AdmZip(packPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Invalid .mrpack: modrinth.index.json missing.');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  const mc = deps.minecraft;

  // 1) Download every server-relevant file listed in the index.
  const fileList = (index.files || []).filter((f) => !f.env || f.env.server !== 'unsupported');
  log(`Downloading ${fileList.length} mod file(s)…`);
  let done = 0;
  for (const f of fileList) {
    const url = (f.downloads || [])[0];
    if (!url) continue;
    const dest = safeJoin(dir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(url, dest, () => {});
    if (++done % 10 === 0 || done === fileList.length) log(`  …${done}/${fileList.length} files`);
  }

  // 2) Apply overrides + server-overrides on top of the install dir.
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    let rel = null;
    if (name.startsWith('overrides/')) rel = name.slice('overrides/'.length);
    else if (name.startsWith('server-overrides/')) rel = name.slice('server-overrides/'.length);
    if (rel == null || !rel || entry.isDirectory) continue;
    const dest = safeJoin(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
  log('Applied modpack overrides.');
  try { fs.rmSync(packPath, { force: true }); } catch {}

  // 3) Install the matching loader server + return its startup command.
  let startup;
  if (deps['fabric-loader']) {
    log('Installing Fabric loader for the modpack…');
    await fabric({ dir, vars: { MINECRAFT_VERSION: mc, LOADER_VERSION: deps['fabric-loader'] }, log });
    startup = 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui';
  } else if (deps['quilt-loader']) {
    const r = await quilt({ dir, vars: { MINECRAFT_VERSION: mc, LOADER_VERSION: deps['quilt-loader'] }, log });
    startup = r.startup;
  } else if (deps['forge']) {
    const r = await forge({ dir, vars: { MINECRAFT_VERSION: mc, FORGE_VERSION: deps['forge'] }, log });
    startup = r.startup;
  } else if (deps['neoforge']) {
    const r = await neoforge({ dir, vars: { NEOFORGE_VERSION: deps['neoforge'] }, log });
    startup = r.startup;
  } else {
    log('No mod loader in the modpack — installing vanilla.');
    await vanilla({ dir, vars: { MINECRAFT_VERSION: mc }, log });
    startup = 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui';
  }
  acceptEula(dir, log);
  log(`Modpack "${index.name || slug}" installed for Minecraft ${mc}.`);
  return { startup };
}

const INSTALLERS = {
  paper, folia, purpur, vanilla, fabric, velocity, waterfall, bungeecord, geyser, forge, neoforge, sponge,
  quilt, pufferfish, leaf, pocketmine, steamcmd, modpack,
};

module.exports = {
  has: (name) => Boolean(INSTALLERS[name]),
  list: () => Object.keys(INSTALLERS),
  run: (name, ctx) => INSTALLERS[name](ctx),
};
