'use strict';

/**
 * SFTP server on the PufferPanel SFTP port (5657).
 *
 * Login:  username = "<panelUser>.<serverIdentifier>"   password = panel password
 * Root:   the matched server's volume directory.
 *
 * This mirrors how Pterodactyl/PufferPanel expose per-server SFTP, but on
 * PufferPanel's port (5657) rather than Pterodactyl's 2022.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ssh2 = require('ssh2');
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const { canAccessServer } = require('../routes/helpers');

const { Server } = ssh2;
// Resolve SFTP protocol constants across ssh2 export shapes.
const SFTP_NS = (ssh2.utils && ssh2.utils.sftp) || ssh2.sftp || ssh2;
const STATUS_CODE = SFTP_NS.STATUS_CODE || {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
};
const OPEN_MODE = SFTP_NS.OPEN_MODE || {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREAT: 0x00000008,
  TRUNC: 0x00000010,
  EXCL: 0x00000020,
};

function loadHostKey() {
  if (fs.existsSync(config.hostKeyFile)) return fs.readFileSync(config.hostKeyFile);
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.mkdirSync(path.dirname(config.hostKeyFile), { recursive: true });
  fs.writeFileSync(config.hostKeyFile, privateKey, { mode: 0o600 });
  return Buffer.from(privateKey);
}

function safeJoin(root, rel) {
  const clean = path.normalize(rel || '/').replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.resolve(root, '.' + path.sep + clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function toAttrs(stat) {
  return {
    mode: stat.mode,
    uid: 0,
    gid: 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  };
}

function longname(name, stat) {
  const dir = stat.isDirectory() ? 'd' : '-';
  const perms = 'rwxr-xr-x';
  const size = String(stat.size).padStart(8, ' ');
  const date = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
  return `${dir}${perms} 1 cloud cloud ${size} ${date} ${name}`;
}

function start() {
  const hostKey = loadHostKey();
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    let ctxServer = null;
    let root = null;

    client.on('authentication', (ctx) => {
      if (ctx.method !== 'password') {
        if (ctx.method === 'none') return ctx.reject(['password']);
        return ctx.reject(['password']);
      }
      const raw = ctx.username || '';
      const dot = raw.lastIndexOf('.');
      const username = dot === -1 ? raw : raw.slice(0, dot);
      const identifier = dot === -1 ? null : raw.slice(dot + 1);

      const user = db.find(
        'users',
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );
      if (!user || !auth.checkPassword(user, ctx.password)) return ctx.reject();

      let target = identifier
        ? db.find('servers', (s) => s.identifier === identifier || s.uuid === identifier)
        : db.find('servers', (s) => canAccessServer(user, s));
      if (!target || !canAccessServer(user, target)) return ctx.reject();

      ctxServer = target;
      root = path.join(config.volumesDir, target.id);
      fs.mkdirSync(root, { recursive: true });
      ctx.accept();
    });

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          bindSftp(sftp, () => root, () => ctxServer);
        });
      });
    });

    client.on('error', () => {});
  });

  server.listen(config.sftpPort, config.host, () => {
    console.log(
      `  SFTP  : sftp://${config.publicHost}:${config.sftpPort}  (login: <user>.<serverId>)`
    );
  });

  server.on('error', (err) => {
    console.error('[sftp] server error:', err.message);
  });

  return server;
}

function bindSftp(sftp, getRoot, getServer) {
  const handles = new Map();
  let handleSeq = 0;

  const newHandle = (data) => {
    const id = handleSeq++;
    handles.set(id, data);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id, 0);
    return buf;
  };
  const getHandle = (buf) => handles.get(buf.readUInt32BE(0));
  const resolve = (p) => safeJoin(getRoot(), p);

  sftp.on('REALPATH', (reqid, p) => {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    let rel = abs.slice(getRoot().length).split(path.sep).join('/');
    if (!rel.startsWith('/')) rel = '/' + rel;
    sftp.name(reqid, [{ filename: rel || '/', longname: rel || '/', attrs: {} }]);
  });

  sftp.on('STAT', (reqid, p) => doStat(reqid, p, false));
  sftp.on('LSTAT', (reqid, p) => doStat(reqid, p, true));

  function doStat(reqid, p, l) {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    const fn = l ? fs.lstat : fs.stat;
    fn(abs, (err, stat) => {
      if (err) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      sftp.attrs(reqid, toAttrs(stat));
    });
  }

  sftp.on('FSTAT', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
    fs.stat(h.path, (err, stat) => {
      if (err) return sftp.status(reqid, STATUS_CODE.FAILURE);
      sftp.attrs(reqid, toAttrs(stat));
    });
  });

  sftp.on('OPENDIR', (reqid, p) => {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    fs.readdir(abs, { withFileTypes: true }, (err, entries) => {
      if (err) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      sftp.handle(reqid, newHandle({ type: 'dir', path: abs, entries, idx: 0 }));
    });
  });

  sftp.on('READDIR', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);
    if (h.idx >= h.entries.length) return sftp.status(reqid, STATUS_CODE.EOF);
    const slice = h.entries.slice(h.idx, h.idx + 50);
    h.idx += slice.length;
    const names = [];
    for (const e of slice) {
      try {
        const stat = fs.statSync(path.join(h.path, e.name));
        names.push({ filename: e.name, longname: longname(e.name, stat), attrs: toAttrs(stat) });
      } catch {
        /* skip */
      }
    }
    sftp.name(reqid, names);
  });

  sftp.on('OPEN', (reqid, filename, flags, attrs) => {
    const abs = resolve(filename);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    let mode = 'r';
    if (flags & OPEN_MODE.WRITE && flags & OPEN_MODE.READ) mode = 'r+';
    else if (flags & OPEN_MODE.APPEND) mode = 'a';
    else if (flags & OPEN_MODE.WRITE) mode = 'w';
    if (flags & OPEN_MODE.CREAT && mode === 'r+') mode = 'w+';
    fs.open(abs, mode, (err, fd) => {
      if (err) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      sftp.handle(reqid, newHandle({ type: 'file', path: abs, fd }));
    });
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
    const buf = Buffer.alloc(length);
    fs.read(h.fd, buf, 0, length, offset, (err, bytes) => {
      if (err) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (bytes === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.data(reqid, buf.slice(0, bytes));
    });
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
    fs.write(h.fd, data, 0, data.length, offset, (err) => {
      sftp.status(reqid, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
    });
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
    handles.delete(handle.readUInt32BE(0));
    if (h.type === 'file') {
      fs.close(h.fd, () => sftp.status(reqid, STATUS_CODE.OK));
    } else {
      sftp.status(reqid, STATUS_CODE.OK);
    }
  });

  sftp.on('MKDIR', (reqid, p) => {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    fsp.mkdir(abs, { recursive: true }).then(
      () => sftp.status(reqid, STATUS_CODE.OK),
      () => sftp.status(reqid, STATUS_CODE.FAILURE)
    );
  });

  sftp.on('RMDIR', (reqid, p) => {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    fsp.rm(abs, { recursive: true, force: true }).then(
      () => sftp.status(reqid, STATUS_CODE.OK),
      () => sftp.status(reqid, STATUS_CODE.FAILURE)
    );
  });

  sftp.on('REMOVE', (reqid, p) => {
    const abs = resolve(p);
    if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    fsp.unlink(abs).then(
      () => sftp.status(reqid, STATUS_CODE.OK),
      () => sftp.status(reqid, STATUS_CODE.FAILURE)
    );
  });

  sftp.on('RENAME', (reqid, from, to) => {
    const a = resolve(from);
    const b = resolve(to);
    if (!a || !b) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    fsp.rename(a, b).then(
      () => sftp.status(reqid, STATUS_CODE.OK),
      () => sftp.status(reqid, STATUS_CODE.FAILURE)
    );
  });

  // Accept attribute changes as no-ops (we do not honor unix perms here).
  sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
}

module.exports = { start };
