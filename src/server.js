'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const pm = require('./services/processManager');

const authRoutes = require('./routes/auth');
const setupRoutes = require('./routes/setup');
const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');
const appearanceRoutes = require('./routes/appearance');
const downloadRoutes = require('./routes/download');
const statusRoutes = require('./routes/status');
const appearance = require('./services/appearance');
const automations = require('./services/automations');
const schedules = require('./services/schedules');
const players = require('./services/players');
const metrics = require('./services/metrics');
const isolation = require('./services/isolation');
const billing = require('./services/billing');
const consoleWs = require('./ws/console');
const sftp = require('./sftp/sftpServer');
const { securityHeaders } = require('./middleware');

db.load();
isolation.init(); // optional: lock panel internals + enable per-server-user isolation
automations.init(); // start watching consoles for servers that have rules
schedules.init(); // start the cron scheduler for time-based tasks
players.init(); // track live player rosters from console output
metrics.init(); // record CPU/RAM/disk/uptime history for graphs + status pages

const app = express();
app.disable('x-powered-by');
// Only when explicitly configured (see CP_TRUST_PROXY). Off by default so the
// IP-based rate limiter can't be bypassed via spoofed X-Forwarded-For headers.
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);

// Stripe webhook — needs the RAW body for signature verification, so it must be
// mounted before the JSON body parser.
app.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  try { const type = billing.handleWebhook(req.body, req.headers['stripe-signature']); res.json({ received: true, type }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- API ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  let brand = config.brand;
  try {
    const b = appearance.get().brand || {};
    brand = { name: b.name || config.brand.name, tagline: b.tagline || config.brand.tagline };
  } catch { /* fall back to config brand */ }
  res.json({
    status: 'ok',
    brand,
    ports: { web: config.webPort, sftp: config.sftpPort },
    store: db.backend ? db.backend.kind : 'unknown',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes); // public — must be before the authed client router
app.use('/api', appearanceRoutes); // public theme CSS/JSON — before the authed client router
app.use('/api', downloadRoutes); // public, ticket-authed downloads — before the authed client router
app.use('/api', statusRoutes); // public, read-only status pages — before the authed client router
app.use('/api', clientRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// ---- Static frontend ------------------------------------------------------
const publicDir = path.join(config.root, 'public');
// Admin-uploaded theme assets (images / gifs / video).
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));
app.use(express.static(publicDir));
// SPA fallback — non-API routes return the app shell.
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ---- Error handler --------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[http] error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Boot -----------------------------------------------------------------
const httpServer = http.createServer(app);
consoleWs.attach(httpServer);

httpServer.listen(config.webPort, config.host, () => {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log(`  ${config.brand.name} — ${config.brand.tagline}`);
  console.log(line);
  console.log(`  Web   : http://${config.publicHost}:${config.webPort}`);
  sftp.start();
  console.log(line);
  if (db.needsSetup()) {
    console.log('  FIRST-RUN SETUP REQUIRED — no users exist yet.');
    console.log(`  → Open  http://${config.publicHost}:${config.webPort}  to create your admin,`);
    console.log('    or run:  npm run setup');
  } else {
    console.log('  Ready. Sign in at the web panel above.');
  }
  console.log(`${line}\n`);
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[fatal] Port ${config.webPort} is already in use.`);
    console.error('Set a different port with CP_WEB_PORT and try again.\n');
    process.exit(1);
  }
  throw err;
});

// ---- Graceful shutdown ----------------------------------------------------
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[cloud-panel] shutting down — stopping servers...');
  pm.shutdownAll();
  try { metrics.flush(); } catch {}
  db.persistNow();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
