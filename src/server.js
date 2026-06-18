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
const consoleWs = require('./ws/console');
const sftp = require('./sftp/sftpServer');

db.load();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- API ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    brand: config.brand,
    ports: { web: config.webPort, sftp: config.sftpPort },
    store: db.backend ? db.backend.kind : 'unknown',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes); // public — must be before the authed client router
app.use('/api', clientRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// ---- Static frontend ------------------------------------------------------
const publicDir = path.join(config.root, 'public');
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
  db.persistNow();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
