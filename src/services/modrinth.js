'use strict';

/**
 * Modrinth integration — search & one-click install plugins/mods straight into
 * a server's plugins/ or mods/ folder, plus .mrpack modpack parsing reused by
 * the modpack installer.
 *
 * Modrinth API: https://docs.modrinth.com/  (v2, public, no key required)
 */

const path = require('path');
const { Readable } = require('stream');
const db = require('../db');
const files = require('./files');

const API = 'https://api.modrinth.com/v2';
const UA = 'CloudPanel/1.9 (+https://github.com/Notbangbang-dev/cloud-panel)';

/** Loaders that take plugins (→ plugins/) vs mods (→ mods/). */
const PLUGIN_LOADERS = ['paper', 'purpur', 'spigot', 'bukkit', 'folia', 'velocity', 'bungeecord', 'waterfall', 'pufferfish', 'leaf'];
const MOD_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

async function api(pathname) {
  const res = await fetch(API + pathname, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Modrinth request failed (${res.status})`);
  return res.json();
}

/** Map a server's egg to a Modrinth loader + the install folder it uses. */
function serverLoader(server) {
  const egg = db.get('eggs', server.eggId) || {};
  const inst = (egg.installer || '').toLowerCase();
  const name = (egg.name || '').toLowerCase();
  const map = {
    paper: 'paper', purpur: 'purpur', folia: 'folia', pufferfish: 'pufferfish', leaf: 'leaf',
    velocity: 'velocity', waterfall: 'waterfall', bungeecord: 'bungeecord',
    fabric: 'fabric', forge: 'forge', neoforge: 'neoforge', quilt: 'quilt',
  };
  if (map[inst]) return map[inst];
  if (name.includes('spigot')) return 'spigot';
  if (name.includes('bukkit')) return 'bukkit';
  if (name.includes('paper')) return 'paper';
  if (name.includes('fabric')) return 'fabric';
  if (name.includes('forge')) return 'forge';
  return 'paper'; // sensible default for generic MC servers
}

function targetFolder(loader) {
  return MOD_LOADERS.includes(loader) ? 'mods' : 'plugins';
}

function kindFor(loader) {
  return MOD_LOADERS.includes(loader) ? 'mod' : 'plugin';
}

/** Search Modrinth, scoped to the server's loader. */
async function search(server, { query = '', gameVersion = '', limit = 30 } = {}) {
  const loader = serverLoader(server);
  const projectType = kindFor(loader) === 'mod' ? 'mod' : 'plugin';
  const facets = [[`project_type:${projectType}`], [`categories:${loader}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const params = new URLSearchParams({
    query: String(query || '').slice(0, 120),
    facets: JSON.stringify(facets),
    limit: String(Math.min(50, Math.max(1, limit))),
    index: query ? 'relevance' : 'downloads',
  });
  const data = await api(`/search?${params.toString()}`);
  return {
    loader,
    folder: targetFolder(loader),
    hits: (data.hits || []).map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      downloads: h.downloads,
      follows: h.follows,
      icon: h.icon_url || '',
      categories: h.categories || [],
      versions: h.versions || [],
    })),
  };
}

/** Compatible versions of a project for this server's loader. */
async function versions(server, projectId, { gameVersion = '' } = {}) {
  const loader = serverLoader(server);
  const params = new URLSearchParams({ loaders: JSON.stringify([loader]) });
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  const data = await api(`/project/${encodeURIComponent(projectId)}/version?${params.toString()}`);
  return (Array.isArray(data) ? data : []).map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    datePublished: v.date_published,
    downloads: v.downloads,
    primaryFile: pickFile(v),
  })).filter((v) => v.primaryFile);
}

function pickFile(version) {
  const list = version.files || [];
  const jar = list.find((f) => f.primary && /\.jar$/i.test(f.filename)) || list.find((f) => /\.jar$/i.test(f.filename));
  if (!jar) return null;
  return { filename: jar.filename, url: jar.url, size: jar.size };
}

/** Download a URL straight into a server-relative path (quota-enforced). */
async function downloadInto(server, relPath, fileUrl) {
  const res = await fetch(fileUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  return files.saveStream(server, relPath, Readable.fromWeb(res.body));
}

/** Install a specific version's jar into the server's plugins/ or mods/ folder. */
async function install(server, { projectId, versionId } = {}) {
  if (!versionId) throw new Error('Pick a version to install.');
  const v = await api(`/version/${encodeURIComponent(versionId)}`);
  const file = pickFile(v);
  if (!file) throw new Error('That version has no installable .jar file.');
  const loader = serverLoader(server);
  const folder = targetFolder(loader);
  const safeName = path.basename(file.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const rel = `/${folder}/${safeName}`;
  await downloadInto(server, rel, file.url);
  const project = await api(`/project/${encodeURIComponent(v.project_id || projectId)}`).catch(() => ({}));
  db.log({ type: 'plugin', serverId: server.id, message: `Installed ${project.title || safeName} (${v.version_number}) → ${folder}/` });
  return { installed: safeName, folder, project: project.title || safeName, version: v.version_number };
}

/** List jars currently present in the server's plugins/ or mods/ folder. */
async function installed(server) {
  const loader = serverLoader(server);
  const folder = targetFolder(loader);
  let entries = [];
  try { entries = await files.list(server, '/' + folder); } catch { entries = []; }
  return {
    loader, folder,
    files: entries.filter((e) => e.file && /\.jare?$/i.test(e.name))
      .map((e) => ({ name: e.name, size: e.size, modifiedAt: e.modifiedAt, disabled: /\.jar\.disabled$/i.test(e.name) })),
  };
}

/* ---- modpack helpers (used by the modpack installer) -------------------- */

/** Resolve "slug", a full URL, or a project id to a Modrinth project id/slug. */
function parseModpackRef(ref) {
  const s = String(ref || '').trim();
  const m = s.match(/modrinth\.com\/(?:modpack|project)\/([a-zA-Z0-9!_-]+)/i);
  return (m ? m[1] : s).replace(/[^a-zA-Z0-9!_-]/g, '');
}

async function resolveModpackVersion(ref, wantedVersion) {
  const slug = parseModpackRef(ref);
  if (!slug) throw new Error('Enter a Modrinth modpack slug or URL.');
  const list = await api(`/project/${encodeURIComponent(slug)}/version`);
  if (!Array.isArray(list) || !list.length) throw new Error(`No versions found for modpack "${slug}".`);
  let chosen;
  if (wantedVersion && wantedVersion !== 'latest') {
    chosen = list.find((v) => v.version_number === wantedVersion || v.id === wantedVersion);
    if (!chosen) throw new Error(`Modpack version "${wantedVersion}" not found.`);
  } else {
    chosen = list[0]; // newest first
  }
  const mrpack = (chosen.files || []).find((f) => /\.mrpack$/i.test(f.filename)) || (chosen.files || [])[0];
  if (!mrpack) throw new Error('That modpack version has no .mrpack file.');
  return { slug, version: chosen, mrpack };
}

module.exports = {
  search, versions, install, installed, downloadInto,
  serverLoader, targetFolder, kindFor,
  parseModpackRef, resolveModpackVersion,
  PLUGIN_LOADERS, MOD_LOADERS,
};
