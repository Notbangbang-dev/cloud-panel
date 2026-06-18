'use strict';

/**
 * Cloud Panel user management CLI.
 *
 *   node src/scripts/user.js create [--username u --email e --password p] [--admin]
 *   node src/scripts/user.js list
 *   node src/scripts/user.js delete <username|id> [--yes]
 *   node src/scripts/user.js passwd <username|id> [--password p]
 *   node src/scripts/user.js promote <username|id>
 *   node src/scripts/user.js demote <username|id>
 */

const db = require('../db');
const auth = require('../auth');
const usersSvc = require('../services/users');
const { banner, ok, err, info, ask, askHidden, confirm, parseArgs, printUsers, isTTY, C, paint } = require('./lib');

function findUser(idOrName) {
  if (!idOrName) return null;
  return (
    db.get('users', idOrName) ||
    db.find('users', (u) => u.username.toLowerCase() === String(idOrName).toLowerCase()) ||
    db.find('users', (u) => u.email.toLowerCase() === String(idOrName).toLowerCase()) ||
    null
  );
}

function usage() {
  console.log(`Usage:
  ${paint(C.cyan, 'create')}  [--username u --email e --password p] [--admin]   create a user (admin or non-admin)
  ${paint(C.cyan, 'list')}                                                  list all users
  ${paint(C.cyan, 'delete')} <username|id> [--yes]                          delete a user
  ${paint(C.cyan, 'passwd')} <username|id> [--password p]                   reset a password
  ${paint(C.cyan, 'promote')} <username|id>                                 grant administrator
  ${paint(C.cyan, 'demote')} <username|id>                                  revoke administrator`);
}

(async () => {
  db.load();
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const target = _[1];

  if (!cmd || cmd === 'help') { banner('User management'); usage(); process.exit(0); }

  if (cmd === 'list') {
    banner('Users');
    printUsers(db.all('users'));
    return process.exit(0);
  }

  if (cmd === 'create') {
    banner('Create user');
    let username = flags.username || flags.u || '';
    let email = flags.email || flags.e || '';
    let password = flags.password || flags.p || '';
    let admin = Boolean(flags.admin);
    let firstName = flags.first || '';
    let lastName = flags.last || '';
    if (isTTY) {
      if (!username) username = await ask('Username');
      if (!email) email = await ask('Email');
      if (!flags.admin && !flags['non-admin']) admin = await confirm('Make this user an administrator?', false);
      if (!password) {
        for (;;) {
          password = await askHidden('Password (min 8 chars)');
          const again = await askHidden('Confirm password');
          if (password !== again) { err('Passwords did not match.'); continue; }
          try { usersSvc.validate({ username, email, password }); break; } catch (e) { err(e.message); }
        }
      }
    }
    try {
      const u = usersSvc.createUser({ username, email, password, admin, firstName, lastName });
      ok(`Created ${u.admin ? paint(C.violet, 'admin') : 'user'} ${paint(C.cyan, u.username)} (${u.email}).`);
      process.exit(0);
    } catch (e) { err(e.message); process.exit(1); }
  }

  // Remaining commands need a target user.
  const user = findUser(target);
  if (!user) { err(`User not found: ${target || '(none provided)'}`); process.exit(1); }

  if (cmd === 'delete') {
    if (user.admin && usersSvc.countAdmins() <= 1) { err('Refusing to delete the last administrator.'); process.exit(1); }
    if (db.find('servers', (s) => s.ownerId === user.id)) { err('This user still owns servers — reassign or delete them first.'); process.exit(1); }
    if (!flags.yes && !(await confirm(`Delete user ${user.username}?`, false))) { info('Cancelled.'); process.exit(0); }
    db.remove('users', user.id);
    ok(`Deleted ${user.username}.`);
    return process.exit(0);
  }

  if (cmd === 'passwd') {
    let password = flags.password || flags.p || '';
    if (!password && isTTY) {
      for (;;) {
        password = await askHidden('New password (min 8 chars)');
        const again = await askHidden('Confirm password');
        if (password !== again) { err('Passwords did not match.'); continue; }
        if (password.length < 8) { err('Too short.'); continue; }
        break;
      }
    }
    if (!password || password.length < 8) { err('A password of at least 8 characters is required.'); process.exit(1); }
    db.update('users', user.id, { password: auth.hashPassword(password) });
    ok(`Password updated for ${user.username}.`);
    return process.exit(0);
  }

  if (cmd === 'promote') {
    db.update('users', user.id, { admin: true });
    ok(`${user.username} is now an ${paint(C.violet, 'administrator')}.`);
    return process.exit(0);
  }

  if (cmd === 'demote') {
    if (user.admin && usersSvc.countAdmins() <= 1) { err('Refusing to demote the last administrator.'); process.exit(1); }
    db.update('users', user.id, { admin: false });
    ok(`${user.username} is now a standard user.`);
    return process.exit(0);
  }

  banner('User management'); err(`Unknown command: ${cmd}`); usage(); process.exit(1);
})();
