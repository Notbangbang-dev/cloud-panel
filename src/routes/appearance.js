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
  try { css = appearance.generateCss(appearance.get()); } catch (err) { css = `/* ${err.message} */\n`; }
  res.type('text/css');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(css);
});

router.get('/appearance.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ appearance: appearance.get(), presets: appearance.presetList() });
});

module.exports = router;
