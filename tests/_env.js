'use strict';
// Point every test at a throwaway data dir + a fixed JWT secret, set BEFORE any
// src module is required (config.js reads these at load time). Required as the
// first line of each *.test.js so the suite never touches real panel data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.env.CP_DATA_DIR) process.env.CP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
if (!process.env.CP_JWT_SECRET) process.env.CP_JWT_SECRET = 'test-secret-0123456789-abcdefghijklmnop';
