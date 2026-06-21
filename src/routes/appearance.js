'use strict';

/**
 * Public appearance endpoints (no auth) — so the login screen and every
 * visitor gets the configured theme with no flash of default styling.
 *
 *   GET /api/appearance.css   → generated theme stylesheet (linked in index.html)
 *   GET /api/appearance.json  → current appearance + preset catalog (runtime/editor)
 */

const express = require('express');
const appearance = require('../services/appearance');

const router = express.Router();

router.get('/appearance.css', (req, res) => {
  let css = '/* appearance unavailable */\n';
  try { css = appearance.generateCss(appearance.get()) + appearance.seasonalCss(); } catch (err) { css = `/* ${err.message} */\n`; }
  res.type('text/css');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(css);
});

router.get('/appearance.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ appearance: appearance.get(), presets: appearance.presetList(), season: appearance.activeSeason() });
});

// Theme preset catalog (for the per-user theme picker).
router.get('/appearance/presets', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data: appearance.presetList() });
});

// A single preset's stylesheet — linked client-side as a per-user theme.
router.get('/appearance/preset/:id', (req, res) => {
  res.type('text/css');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(appearance.presetCss(req.params.id) || '/* unknown preset */\n');
});

module.exports = router;
