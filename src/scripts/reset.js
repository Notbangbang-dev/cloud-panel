'use strict';

/** Wipes the database + server volumes and re-seeds a fresh demo dataset. */

const fs = require('fs');
const config = require('../config');

const targets = [
  config.dbFile,
  config.sqliteFile,
  `${config.sqliteFile}-wal`,
  `${config.sqliteFile}-shm`,
  config.volumesDir,
  config.hostKeyFile,
];
for (const target of targets) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  } catch (err) {
    console.warn(`could not remove ${target}: ${err.message}`);
  }
}

// Re-create + seed.
delete require.cache[require.resolve('../db')];
const db = require('../db');
db.load();
console.log('Cloud Panel data reset and re-seeded.');
