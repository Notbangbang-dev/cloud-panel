'use strict';

/**
 * Server Pets — a fun, coin-bought Tamagotchi-style mascot. No default pet:
 * members buy one (or more) from the shop and pick an active companion that
 * reacts to their servers' health. Admin-toggleable; requires the economy.
 */

const db = require('../db');
const settings = require('./settings');
const ledger = require('./ledger');

const CATALOG = [
  { id: 'cat', name: 'Pixel Cat', emoji: '🐱', price: 250, desc: 'Low-maintenance. Silently judges your uptime.' },
  { id: 'dog', name: 'Server Pup', emoji: '🐶', price: 250, desc: 'Loyal to a fault. Barks at every crash.' },
  { id: 'turtle', name: 'Lag Turtle', emoji: '🐢', price: 300, desc: 'Slow and steady wins the TPS.' },
  { id: 'fox', name: 'Firefox', emoji: '🦊', price: 400, desc: 'Sly, fast, slightly memory-hungry.' },
  { id: 'penguin', name: 'Tux', emoji: '🐧', price: 400, desc: 'Pure Linux mascot energy.' },
  { id: 'robot', name: 'Bit-Bot', emoji: '🤖', price: 600, desc: 'Beep boop. Lives for spare RAM.' },
  { id: 'alien', name: 'Lil Invader', emoji: '👾', price: 600, desc: 'Phoned home from a server far away.' },
  { id: 'dragon', name: 'RAM Dragon', emoji: '🐉', price: 1000, desc: 'Hoards memory. Breathes fire on OOM.' },
  { id: 'unicorn', name: 'Uptimecorn', emoji: '🦄', price: 1200, desc: '100% uptime, 100% magic.' },
];
const MAP = Object.fromEntries(CATALOG.map((p) => [p.id, p]));

function enabled() {
  return settings.economyEnabled() && !!(db.settings().pets || {}).enabled;
}

function view(user) {
  const owned = user.pets || [];
  return {
    enabled: enabled(),
    coins: user.coins || 0,
    active: user.activePet || null,
    owned,
    catalog: CATALOG.map((p) => ({ ...p, owned: owned.includes(p.id) })),
  };
}

function buy(user, petId) {
  if (!enabled()) throw new Error('Pets aren’t available right now.');
  const pet = MAP[petId];
  if (!pet) throw new Error('Unknown pet.');
  const owned = user.pets || [];
  if (owned.includes(pet.id)) throw new Error('You already own this pet.');
  if ((user.coins || 0) < pet.price) throw new Error(`Not enough coins — you need ${pet.price}.`);
  const updated = db.update('users', user.id, {
    coins: (user.coins || 0) - pet.price,
    pets: [...owned, pet.id],
    activePet: user.activePet || pet.id, // first pet becomes active
  });
  ledger.record(user.id, -pet.price, `pet: ${pet.name}`);
  db.log({ type: 'economy', userId: user.id, message: `${user.username} adopted ${pet.name} ${pet.emoji} (-${pet.price} coins)` });
  return view(updated);
}

function setActive(user, petId) {
  const owned = user.pets || [];
  if (petId && !owned.includes(petId)) throw new Error('You don’t own that pet.');
  const updated = db.update('users', user.id, { activePet: petId || null });
  return view(updated);
}

module.exports = { CATALOG, enabled, view, buy, setActive };
