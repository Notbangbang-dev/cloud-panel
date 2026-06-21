'use strict';

/**
 * Friends — mutual connections with incoming/outgoing requests and live
 * (in-memory) online status. Friendship is stored symmetrically on both users:
 *   user.friends        — accepted friend ids
 *   user.friendRequests — incoming pending request ids
 */

const db = require('../db');
const presence = require('./presence');

function pub(u) {
  return u ? { id: u.id, username: u.username, avatar: u.avatar || null, online: presence.isOnline(u.id) } : null;
}

function list(user) {
  const me = db.get('users', user.id) || user;
  const friends = (me.friends || []).map((id) => pub(db.get('users', id))).filter(Boolean);
  const incoming = (me.friendRequests || []).map((id) => pub(db.get('users', id))).filter(Boolean);
  const outgoing = db.all('users')
    .filter((u) => (u.friendRequests || []).includes(me.id))
    .map(pub);
  return { friends, incoming, outgoing };
}

function request(user, username) {
  const target = db.all('users').find((u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!target) throw new Error('No user with that username.');
  if (target.id === user.id) throw new Error("You can't add yourself.");
  const me = db.get('users', user.id);
  if ((me.friends || []).includes(target.id)) throw new Error('You’re already friends.');
  // If they already requested me, accept it instead of sending a new one.
  if ((me.friendRequests || []).includes(target.id)) return accept(user, target.id);
  if ((target.friendRequests || []).includes(user.id)) throw new Error('Request already sent.');
  db.update('users', target.id, { friendRequests: [...(target.friendRequests || []), user.id] });
  return { ok: true, sent: true };
}

function accept(user, id) {
  const me = db.get('users', user.id);
  if (!(me.friendRequests || []).includes(id)) throw new Error('No pending request from that user.');
  const other = db.get('users', id);
  if (!other) throw new Error('User not found.');
  db.update('users', me.id, {
    friendRequests: (me.friendRequests || []).filter((x) => x !== id),
    friends: [...new Set([...(me.friends || []), id])],
  });
  db.update('users', other.id, { friends: [...new Set([...(other.friends || []), me.id])] });
  return { ok: true };
}

function decline(user, id) {
  const me = db.get('users', user.id);
  db.update('users', me.id, { friendRequests: (me.friendRequests || []).filter((x) => x !== id) });
  return { ok: true };
}

function remove(user, id) {
  const me = db.get('users', user.id);
  db.update('users', me.id, { friends: (me.friends || []).filter((x) => x !== id) });
  const other = db.get('users', id);
  if (other) db.update('users', other.id, { friends: (other.friends || []).filter((x) => x !== me.id) });
  return { ok: true };
}

module.exports = { list, request, accept, decline, remove };
