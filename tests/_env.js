'use strict';
// Point every test at a throwaway data dir + a fixed JWT secret, set BEFORE any
// src module is required (config.js reads these at load time). Required as the
// first line of each *.test.js so the suite never touches real panel data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Allocate a FRESH, unique data dir for THIS process — we deliberately ignore any
// inherited CP_DATA_DIR. `node --test` runs each test file in its own worker
// process; if those workers shared one data dir (e.g. via an exported env var)
// they'd share the singleton SQLite `settings` row, and tests that flip global
// state (billing mode = free vs trial) would race and fail nondeterministically.
// A per-process dir makes that race structurally impossible. mkdtemp guarantees
// uniqueness; the pid prefix just makes leftover dirs traceable.
process.env.CP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `cp-test-${process.pid}-`));
if (!process.env.CP_JWT_SECRET) process.env.CP_JWT_SECRET = 'test-secret-0123456789-abcdefghijklmnop';
