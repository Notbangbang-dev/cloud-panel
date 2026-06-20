'use strict';

/** Public, read-only status pages — no authentication required. */

const express = require('express');
const statuspage = require('../services/statuspage');
const { rateLimit } = require('../middleware');

const router = express.Router();
const limiter = rateLimit({ windowMs: 60000, max: 120, message: 'Too many requests — slow down.' });

router.get('/status/:slug', limiter, (req, res) => {
  const server = statuspage.findBySlug(req.params.slug);
  if (!server) return res.status(404).json({ error: 'No public status page found for that address.' });
  res.json({ data: statuspage.publicView(server) });
});

module.exports = router;
