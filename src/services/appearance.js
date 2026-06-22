'use strict';

/**
 * Appearance / theming engine.
 *
 * The whole panel is themed through the CSS custom properties declared in
 * public/css/style.css (:root). This module:
 *   - ships a catalog of built-in PRESETS (full palettes),
 *   - validates/sanitizes an admin-supplied appearance document,
 *   - and generates the override CSS that is served at /api/appearance.css
 *     (and used verbatim for the admin live-preview).
 *
 * Keep DEFAULT_APPEARANCE in sync with SETTINGS_DEFAULTS.appearance in db.js.
 */

const db = require('../db');

/* ----------------------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------------------- */
const DEFAULT_APPEARANCE = {
  preset: 'nebula',
  colors: {},
  background: { type: 'preset', value: '', fit: 'cover', blur: 0, dim: 35, fixed: true },
  effects: { animations: true, glass: true, radius: 16 },
  brand: { name: '', tagline: '' },
  customCss: '',
};

/* ----------------------------------------------------------------------------
 * Preset palettes
 *  bg / bg2        — page background base + slightly lighter band
 *  surface / surf2 — card / panel solids (rendered translucent unless glass off)
 *  text/muted/faint— foreground ramp
 *  primary/secondary/accent — the cyan→indigo→violet style accent trio
 *  borderRgb       — "r,g,b" used for hairline borders
 *  light           — true for light-on-dark inversion hints
 * ------------------------------------------------------------------------- */
const PRESETS = [
  {
    id: 'nebula', name: 'Nebula', tag: 'The Cloud Panel classic',
    p: { bg: '#070a12', bg2: '#0b0f1a', surface: '#121828', surf2: '#1a2136', text: '#e7ecf6', muted: '#8a97b4', faint: '#5c6788', primary: '#22d3ee', secondary: '#6366f1', accent: '#a855f7', borderRgb: '118,140,200' },
  },
  {
    id: 'midnight', name: 'Midnight', tag: 'Deep ocean blues',
    p: { bg: '#060912', bg2: '#0a1020', surface: '#111a2e', surf2: '#182740', text: '#e8eefc', muted: '#8aa0c8', faint: '#5a6e96', primary: '#38bdf8', secondary: '#3b82f6', accent: '#6366f1', borderRgb: '96,130,200' },
  },
  {
    id: 'aurora', name: 'Aurora', tag: 'Teal & emerald glow',
    p: { bg: '#051210', bg2: '#08201a', surface: '#0e241d', surf2: '#133029', text: '#e6fff5', muted: '#84b8a6', faint: '#4f8a76', primary: '#2dd4bf', secondary: '#10b981', accent: '#34d399', borderRgb: '90,160,140' },
  },
  {
    id: 'sunset', name: 'Sunset', tag: 'Amber, coral & rose',
    p: { bg: '#140a08', bg2: '#1d0f0c', surface: '#251411', surf2: '#321b16', text: '#fdeee6', muted: '#c2a092', faint: '#8a6256', primary: '#fb923c', secondary: '#f43f5e', accent: '#f59e0b', borderRgb: '200,140,110' },
  },
  {
    id: 'grape', name: 'Grape', tag: 'Violet & magenta',
    p: { bg: '#0d0716', bg2: '#140a20', surface: '#1d1230', surf2: '#281840', text: '#f1e8ff', muted: '#b29ad0', faint: '#7a5fa0', primary: '#c084fc', secondary: '#a855f7', accent: '#ec4899', borderRgb: '160,120,210' },
  },
  {
    id: 'matrix', name: 'Matrix', tag: 'Neon green on black',
    p: { bg: '#010a06', bg2: '#02140c', surface: '#06120d', surf2: '#0a1c14', text: '#b9ffcf', muted: '#5fae7e', faint: '#3a7a55', primary: '#22c55e', secondary: '#16a34a', accent: '#4ade80', borderRgb: '60,160,100' },
  },
  {
    id: 'crimson', name: 'Crimson', tag: 'Red alert',
    p: { bg: '#120608', bg2: '#1b090c', surface: '#240d11', surf2: '#311318', text: '#ffe9ec', muted: '#c89aa2', faint: '#8f5c66', primary: '#fb7185', secondary: '#ef4444', accent: '#f97316', borderRgb: '200,120,130' },
  },
  {
    id: 'slate', name: 'Slate', tag: 'Understated & pro',
    p: { bg: '#0b0d12', bg2: '#11141c', surface: '#171b26', surf2: '#1f2533', text: '#e6e9f2', muted: '#9aa3b8', faint: '#646d84', primary: '#818cf8', secondary: '#22d3ee', accent: '#94a3b8', borderRgb: '130,140,170' },
  },
  {
    id: 'cotton', name: 'Cotton (Light)', tag: 'Bright daylight theme', light: true,
    p: { bg: '#eef1f8', bg2: '#e6ebf6', surface: '#ffffff', surf2: '#f4f6fc', text: '#1f2638', muted: '#5a6b7f', faint: '#8a93a8', primary: '#0ea5e9', secondary: '#6366f1', accent: '#a855f7', borderRgb: '120,135,180' },
  },
];
const PRESET_MAP = Object.fromEntries(PRESETS.map((x) => [x.id, x]));

/* ----------------------------------------------------------------------------
 * Validators / helpers
 * ------------------------------------------------------------------------- */
const COLOR_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s]+\))$/;
const URL_RE = /^(https?:\/\/|\/)[^"'()\\\s;{}<>]+$/;
const GRADIENT_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\([^;{}<>]*\)$/i;
const BG_TYPES = ['preset', 'color', 'gradient', 'image', 'gif', 'video'];
const FITS = ['cover', 'contain', 'tile', 'center'];

const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v.trim());
const isUrl = (v) => typeof v === 'string' && v.length < 1024 && URL_RE.test(v.trim());
const isGradient = (v) => typeof v === 'string' && v.length < 1024 && GRADIENT_RE.test(v.trim());
const clamp = (v, min, max, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

function hexToRgba(hex, a) {
  if (typeof hex !== 'string') return `rgba(0,0,0,${a})`;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(0,0,0,${a})`;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Strip anything that could break out of a <style> context, run script, or
 *  beacon out to a remote host. Same-origin (relative) and data: URLs are kept
 *  so admins can still reference uploaded assets; only remote fetches are cut. */
function sanitizeCustomCss(css) {
  if (typeof css !== 'string') return '';
  return css
    .slice(0, 20000)
    .replace(/<\/?style/gi, '')
    .replace(/<\/?script/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    // Drop @import entirely — it can pull in remote stylesheets (and leak the
    // visitor's IP / referrer to an arbitrary host).
    .replace(/@import[^;]*;?/gi, '')
    // Neutralize remote url(...) targets (privacy beacon via background-image,
    // cursor, etc.). Relative paths and data: URIs are left intact.
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, _q, inner) => {
      const t = String(inner).trim().toLowerCase();
      return /^(https?:|\/\/)/.test(t) ? 'url()' : m;
    });
}

/* ----------------------------------------------------------------------------
 * Sanitize a (partial or full) appearance document into a safe, complete one.
 * ------------------------------------------------------------------------- */
function sanitize(input = {}) {
  const a = input && typeof input === 'object' ? input : {};
  const out = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));

  out.preset = PRESET_MAP[a.preset] ? a.preset : 'nebula';

  // Color overrides — only keep recognised, valid colors.
  out.colors = {};
  const colorsIn = a.colors && typeof a.colors === 'object' ? a.colors : {};
  for (const key of ['bg', 'surface', 'text', 'primary', 'secondary', 'accent']) {
    if (isColor(colorsIn[key])) out.colors[key] = colorsIn[key].trim();
  }

  // Background.
  const bgIn = a.background && typeof a.background === 'object' ? a.background : {};
  const type = BG_TYPES.includes(bgIn.type) ? bgIn.type : 'preset';
  let value = '';
  if (type === 'color' && isColor(bgIn.value)) value = bgIn.value.trim();
  else if (type === 'gradient' && isGradient(bgIn.value)) value = bgIn.value.trim();
  else if ((type === 'image' || type === 'gif' || type === 'video') && isUrl(bgIn.value)) value = bgIn.value.trim();
  out.background = {
    type: value || type === 'preset' ? type : 'preset',
    value,
    fit: FITS.includes(bgIn.fit) ? bgIn.fit : 'cover',
    blur: clamp(bgIn.blur, 0, 40, 0),
    dim: clamp(bgIn.dim, 0, 90, 35),
    fixed: bgIn.fixed === undefined ? true : !!bgIn.fixed,
  };

  // Effects.
  const fx = a.effects && typeof a.effects === 'object' ? a.effects : {};
  out.effects = {
    animations: fx.animations === undefined ? true : !!fx.animations,
    glass: fx.glass === undefined ? true : !!fx.glass,
    radius: clamp(fx.radius, 0, 28, 16),
  };

  // Brand overrides.
  const br = a.brand && typeof a.brand === 'object' ? a.brand : {};
  out.brand = {
    name: typeof br.name === 'string' ? br.name.slice(0, 40) : '',
    tagline: typeof br.tagline === 'string' ? br.tagline.slice(0, 80) : '',
  };

  out.customCss = sanitizeCustomCss(a.customCss);
  return out;
}

/* ----------------------------------------------------------------------------
 * Resolve the effective palette (preset + valid overrides).
 * ------------------------------------------------------------------------- */
function resolvePalette(app) {
  const preset = PRESET_MAP[app.preset] || PRESET_MAP.nebula;
  const p = { ...preset.p };
  const c = app.colors || {};
  if (isColor(c.bg)) p.bg = c.bg;
  if (isColor(c.surface)) p.surface = c.surface;
  if (isColor(c.text)) p.text = c.text;
  if (isColor(c.primary)) p.primary = c.primary;
  if (isColor(c.secondary)) p.secondary = c.secondary;
  if (isColor(c.accent)) p.accent = c.accent;
  return { p, light: !!preset.light };
}

/* ----------------------------------------------------------------------------
 * Generate the override CSS for an appearance document.
 * ------------------------------------------------------------------------- */
function generateCss(input) {
  const app = sanitize(input);
  const { p } = resolvePalette(app);
  const fx = app.effects;
  const bg = app.background;
  const surfAlpha = fx.glass ? 0.72 : 0.97;
  const radius = Math.round(fx.radius);
  const radiusSm = Math.max(6, radius - 6);

  const lines = [];
  lines.push('/* Generated by Cloud Panel appearance engine — do not edit by hand. */');
  lines.push(':root {');
  lines.push(`  --bg: ${p.bg};`);
  lines.push(`  --bg-2: ${p.bg2 || p.bg};`);
  lines.push(`  --surface: ${hexToRgba(p.surface, surfAlpha)};`);
  lines.push(`  --surface-2: ${hexToRgba(p.surf2 || p.surface, surfAlpha)};`);
  lines.push(`  --surface-solid: ${p.surface};`);
  lines.push(`  --border: rgba(${p.borderRgb}, 0.16);`);
  lines.push(`  --border-strong: rgba(${p.borderRgb}, 0.30);`);
  lines.push(`  --text: ${p.text};`);
  lines.push(`  --muted: ${p.muted};`);
  lines.push(`  --faint: ${p.faint};`);
  lines.push(`  --cyan: ${p.primary};`);
  lines.push(`  --indigo: ${p.secondary};`);
  lines.push(`  --violet: ${p.accent};`);
  lines.push(`  --accent-grad: linear-gradient(135deg, ${p.primary} 0%, ${p.secondary} 50%, ${p.accent} 100%);`);
  lines.push(`  --radius: ${radius}px;`);
  lines.push(`  --radius-sm: ${radiusSm}px;`);
  lines.push(`  --input-bg: ${hexToRgba(p.bg, 0.55)};`);
  lines.push(`  --input-bg-focus: ${hexToRgba(p.bg, 0.92)};`);
  lines.push('}');

  // Make form fields follow the palette (style.css hard-codes them otherwise).
  lines.push('input, select, textarea { background: var(--input-bg); }');
  lines.push('input:focus, select:focus, textarea:focus { background: var(--input-bg-focus); }');

  // Glass off → drop the translucent blur on panels.
  if (!fx.glass) {
    lines.push('.card, .sidebar, .topbar, .modal, .auth-card, .coins-chip, .term { backdrop-filter: none !important; }');
  }
  // Animations off → freeze ambient motion (keep functional spinners).
  if (!fx.animations) {
    lines.push('body::after { animation: none !important; }');
    lines.push('.boot-logo, .boot-bar span { animation: none !important; }');
  }

  // Background layer.
  const dim = (bg.dim / 100).toFixed(2);
  const attach = bg.fixed ? 'fixed' : 'scroll';
  if (bg.type === 'color' && bg.value) {
    lines.push(`body::before { background: ${bg.value} !important; }`);
  } else if (bg.type === 'gradient' && bg.value) {
    lines.push(`body::before { background: ${bg.value} !important; }`);
  } else if ((bg.type === 'image' || bg.type === 'gif') && bg.value) {
    const size = bg.fit === 'tile' ? 'auto' : bg.fit === 'center' ? 'auto' : bg.fit; // cover|contain|auto
    const repeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat';
    const blurExtra = bg.blur > 0 ? ` filter: blur(${bg.blur}px); transform: scale(1.08);` : '';
    lines.push(
      `body::before { background-color: var(--bg) !important;` +
        ` background-image: linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${bg.value}") !important;` +
        ` background-position: center, center !important;` +
        ` background-size: cover, ${size} !important;` +
        ` background-repeat: no-repeat, ${repeat} !important;` +
        ` background-attachment: ${attach}, ${attach} !important;${blurExtra} }`
    );
    lines.push('body::after { opacity: 0.18; }');
  } else if (bg.type === 'video' && bg.value) {
    // The <video> element itself is injected by public/js/appearance.js.
    lines.push(`body::before { background: rgba(0,0,0,${dim}) !important; }`);
    lines.push('body::after { opacity: 0.12; }');
    lines.push(
      `.cp-bg-video { position: fixed; inset: 0; width: 100%; height: 100%;` +
        ` object-fit: cover; z-index: -3; pointer-events: none; }`
    );
  }

  if (app.customCss) {
    lines.push('\n/* ---- Custom CSS (admin) ---- */');
    lines.push(app.customCss);
  }

  return lines.join('\n') + '\n';
}

/* ----------------------------------------------------------------------------
 * Per-user theme — a single preset's :root color overrides (no background), so
 * a member can re-skin the panel for themselves on top of the admin theme.
 * ------------------------------------------------------------------------- */
function presetCss(presetId) {
  const preset = PRESET_MAP[presetId];
  if (!preset) return '';
  const p = preset.p;
  const a = 0.72;
  return [
    `/* Cloud Panel per-user theme: ${preset.id} */`,
    ':root {',
    `  --bg: ${p.bg};`,
    `  --bg-2: ${p.bg2 || p.bg};`,
    `  --surface: ${hexToRgba(p.surface, a)};`,
    `  --surface-2: ${hexToRgba(p.surf2 || p.surface, a)};`,
    `  --surface-solid: ${p.surface};`,
    `  --border: rgba(${p.borderRgb}, 0.16);`,
    `  --border-strong: rgba(${p.borderRgb}, 0.30);`,
    `  --text: ${p.text};`,
    `  --muted: ${p.muted};`,
    `  --faint: ${p.faint};`,
    `  --cyan: ${p.primary};`,
    `  --indigo: ${p.secondary};`,
    `  --violet: ${p.accent};`,
    `  --accent-grad: linear-gradient(135deg, ${p.primary} 0%, ${p.secondary} 50%, ${p.accent} 100%);`,
    `  --input-bg: ${hexToRgba(p.bg, 0.55)};`,
    `  --input-bg-focus: ${hexToRgba(p.bg, 0.92)};`,
    '}',
    'input, select, textarea { background: var(--input-bg); }',
    'input:focus, select:focus, textarea:focus { background: var(--input-bg-focus); }',
  ].join('\n') + '\n';
}

/* ----------------------------------------------------------------------------
 * Seasonal auto-themes — a festive accent palette layered on top of the theme.
 * ------------------------------------------------------------------------- */
const SEASON_ACCENTS = {
  halloween: { name: 'Halloween', emoji: '🎃', primary: '#f97316', secondary: '#a855f7', accent: '#f59e0b' },
  winter: { name: 'Winter', emoji: '❄️', primary: '#38bdf8', secondary: '#818cf8', accent: '#22d3ee' },
  christmas: { name: 'Christmas', emoji: '🎄', primary: '#ef4444', secondary: '#22c55e', accent: '#f43f5e' },
  newyear: { name: "New Year", emoji: '🎉', primary: '#f59e0b', secondary: '#a855f7', accent: '#fde047' },
};

/** Resolve the active season from a configured mode ('auto' uses the date). */
function effectiveSeason(mode) {
  if (!mode || mode === 'off') return null;
  if (mode !== 'auto') return SEASON_ACCENTS[mode] ? mode : null;
  const d = new Date();
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 10) return 'halloween';
  if (m === 12 && day <= 26) return 'christmas';
  if ((m === 12 && day >= 27) || (m === 1 && day <= 2)) return 'newyear';
  if (m === 1 || m === 2) return 'winter';
  return null;
}

/** Extra CSS for the active seasonal theme (appended to /api/appearance.css). */
function seasonalCss() {
  const mode = (db.settings().seasonal || {}).mode || 'off';
  const season = effectiveSeason(mode);
  const s = season && SEASON_ACCENTS[season];
  if (!s) return '';
  return [
    `/* Seasonal theme: ${s.name} */`,
    ':root {',
    `  --cyan: ${s.primary};`,
    `  --indigo: ${s.secondary};`,
    `  --violet: ${s.accent};`,
    `  --accent-grad: linear-gradient(135deg, ${s.primary} 0%, ${s.secondary} 50%, ${s.accent} 100%);`,
    '}',
  ].join('\n') + '\n';
}

/* ----------------------------------------------------------------------------
 * Public accessors
 * ------------------------------------------------------------------------- */
/** The currently-active seasonal id (or null) from settings. */
function activeSeason() {
  return effectiveSeason((db.settings().seasonal || {}).mode || 'off');
}

/** The current, sanitized appearance document. */
function get() {
  const s = db.settings();
  return sanitize(s && s.appearance);
}

/** Catalog of presets exposed to the client (with swatch colors). */
function presetList() {
  return PRESETS.map((x) => ({
    id: x.id,
    name: x.name,
    tag: x.tag || '',
    light: !!x.light,
    swatch: [x.p.primary, x.p.secondary, x.p.accent],
    bg: x.p.bg,
    palette: x.p,
  }));
}

module.exports = {
  DEFAULT_APPEARANCE,
  PRESETS,
  presetList,
  presetCss,
  seasonalCss,
  effectiveSeason,
  activeSeason,
  sanitize,
  generateCss,
  resolvePalette,
  get,
};
