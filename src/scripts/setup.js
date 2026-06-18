'use strict';

/**
 * Cloud Panel setup — create the first administrator.
 *
 * Interactive:   npm run setup
 * Non-interactive (VPS/automation), via flags or env:
 *   node src/scripts/setup.js --username admin --email a@b.c --password 'S3cret!!'
 *   CP_ADMIN_USERNAME=admin CP_ADMIN_EMAIL=a@b.c CP_ADMIN_PASSWORD='S3cret!!' npm run setup
 */

const config = require('../config');
const db = require('../db');
const usersSvc = require('../services/users');
const { banner, ok, err, info, ask, askHidden, parseArgs, isTTY, C, paint } = require('./lib');

(async () => {
  db.load();
  banner('First-run setup');

  const { flags } = parseArgs(process.argv.slice(2));

  if (flags['if-needed'] && usersSvc.countUsers() > 0) {
    info('Setup already completed — an account exists. Skipping.');
    process.exit(0);
  }

  let username = flags.username || flags.u || process.env.CP_ADMIN_USERNAME || '';
  let email = flags.email || flags.e || process.env.CP_ADMIN_EMAIL || '';
  let password = flags.password || flags.p || process.env.CP_ADMIN_PASSWORD || '';
  let firstName = flags.first || process.env.CP_ADMIN_FIRST || '';
  let lastName = flags.last || process.env.CP_ADMIN_LAST || '';

  if (usersSvc.countUsers() > 0) {
    info(`${usersSvc.countUsers()} user(s) already exist — this will create an ${paint(C.violet, 'additional administrator')}.`);
  }

  const interactive = isTTY && !(flags.yes || flags.y);
  if (interactive) {
    if (!username) username = await ask('Admin username', { def: 'admin' });
    if (!email) email = await ask('Admin email');
    if (!firstName) firstName = await ask('First name (optional)');
    if (!lastName) lastName = await ask('Last name (optional)');
    if (!password) {
      for (;;) {
        password = await askHidden('Password (min 8 chars)');
        const again = await askHidden('Confirm password');
        if (password !== again) { err('Passwords did not match — try again.'); continue; }
        try { usersSvc.validate({ username: username || 'admin', email: email || 'a@b.c', password }); break; }
        catch (e) { err(e.message); }
      }
    }
  }

  if (!username || !email || !password) {
    err('username, email and password are required (use flags/env or run interactively).');
    process.exit(1);
  }

  try {
    const user = usersSvc.createUser({ username, email, password, admin: true, firstName, lastName });
    ok(`Administrator ${paint(C.cyan, user.username)} created.`);
    info(`Sign in at  ${paint(C.cyan, `http://${config.publicHost}:${config.webPort}`)}`);
    process.exit(0);
  } catch (e) {
    err(e.message);
    process.exit(1);
  }
})();
