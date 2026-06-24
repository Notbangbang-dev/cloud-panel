'use strict';

/**
 * Billing & paid plans — real money via Stripe (configured in the admin console).
 *
 * Modes (admin → Billing):
 *   free  — no billing; the Plans page is hidden.
 *   paid  — members must buy a plan to get its resource quota.
 *   trial — paid, but each member can start ONE free trial first.
 *
 * Plans are fully admin-defined (name, price, interval, resource grants, coins,
 * features…). Stripe is called over plain HTTPS (no SDK dependency). Activation
 * happens on the Checkout return (`confirmCheckout`) and via webhooks
 * (`handleWebhook`) for renewals/cancellations.
 */

const crypto = require('crypto');
const db = require('../db');
const ipguard = require('./ipguard');

const STRIPE_API = 'https://api.stripe.com/v1';
const RES_KEYS = ['memory', 'cpu', 'disk', 'servers', 'backups', 'databases'];

function cfg() {
  const b = db.settings().billing || {};
  const s = b.stripe || {};
  return {
    mode: ['free', 'paid', 'trial'].includes(b.mode) ? b.mode : 'free',
    currency: (b.currency || 'usd').toLowerCase(),
    trialDays: Math.max(0, Math.floor(b.trialDays || 0)),
    cancelBehavior: b.cancelBehavior === 'keep' ? 'keep' : 'revert',
    trialPlanId: b.trialPlanId || null,
    stripe: {
      enabled: !!s.enabled,
      secretKey: s.secretKey || '',
      publishableKey: s.publishableKey || '',
      webhookSecret: s.webhookSecret || '',
    },
  };
}

function paymentsReady() {
  const c = cfg();
  return c.stripe.enabled && /^sk_/.test(c.stripe.secretKey);
}

/**
 * True when this user must pick a plan before they can use the panel.
 * Admins are always exempt (they configure billing/plans). Only applies in
 * 'paid' / 'trial' modes when the user has no active or trialing plan.
 */
function requiresPlan(user) {
  if (!user || user.admin) return false;
  const c = cfg();
  if (c.mode !== 'paid' && c.mode !== 'trial') return false;
  return !entitled(user);
}

/** A trial whose end date has passed but is still flagged 'trialing' in the DB. */
function isTrialExpired(user) {
  return !!(user && user.planStatus === 'trialing' && user.trialEndsAt && Date.parse(user.trialEndsAt) <= Date.now());
}

/** Currently entitled to plan quota? Active subscription OR a still-running trial. */
function entitled(user) {
  if (!user) return false;
  if (user.planStatus === 'active') return true;
  if (user.planStatus === 'trialing') return !isTrialExpired(user);
  return false;
}

/**
 * Downgrade a user whose free trial has elapsed. Idempotent — it only acts on
 * the trialing→expired transition, so it is safe to call on every request. It is
 * wired into the auth middleware (authRequired) so an expired trial takes effect
 * the instant the clock runs out, panel-wide, with no scheduler. Returns the
 * (possibly updated) user record.
 */
function reconcile(user) {
  if (!isTrialExpired(user)) return user;
  const d = db.settings().defaults || {};
  const patch = {
    planStatus: 'expired',
    plan: null,
    resources: { memory: d.memory, cpu: d.cpu, disk: d.disk, servers: d.servers, backups: d.backups, databases: d.databases },
  };
  const updated = db.update('users', user.id, patch);
  db.log({ type: 'billing', userId: user.id, message: `${user.username}'s free trial ended — plan access revoked` });
  return updated || { ...user, ...patch };
}

/* -------------------------------------------------------------------------- */
/* Plans (admin-defined)                                                       */
/* -------------------------------------------------------------------------- */
function plans({ activeOnly = false } = {}) {
  let list = db.all('plans');
  if (activeOnly) list = list.filter((p) => p.active !== false);
  return list.sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.price || 0) - (b.price || 0));
}
function getPlan(id) { return id ? db.get('plans', id) : null; }

function sanitizePlan(input, existing) {
  const b = input || {};
  const e = existing || {};
  const res = {};
  for (const k of RES_KEYS) {
    const v = (b.resources && b.resources[k] != null) ? b.resources[k] : (e.resources && e.resources[k]);
    res[k] = Math.max(0, Math.floor(Number(v) || 0));
  }
  const interval = ['month', 'year', 'one_time'].includes(b.interval) ? b.interval : (e.interval || 'month');
  const features = Array.isArray(b.features)
    ? b.features.map((f) => String(f).slice(0, 80)).filter(Boolean).slice(0, 12)
    : (Array.isArray(e.features) ? e.features : []);
  return {
    name: String(b.name != null ? b.name : e.name || '').slice(0, 60) || 'Plan',
    description: String(b.description != null ? b.description : e.description || '').slice(0, 240),
    price: Math.min(99999999, Math.max(0, Math.round(Number(b.price != null ? b.price : e.price) || 0))), // minor units (cents); clamp to Stripe's max
    interval,
    resources: res, // plans grant quota only — no coins (coins are a free-mode thing)
    features,
    featured: b.featured === undefined ? !!e.featured : !!b.featured,
    active: b.active === undefined ? (e.active !== false) : !!b.active,
    sort: Math.floor(Number(b.sort != null ? b.sort : e.sort) || 0),
  };
}
function createPlan(input) {
  const rec = { id: 'plan_' + crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), ...sanitizePlan(input, null) };
  db.insert('plans', rec);
  return rec;
}
function updatePlan(id, input) {
  const cur = db.get('plans', id);
  if (!cur) throw new Error('Plan not found');
  return db.update('plans', id, sanitizePlan(input, cur));
}
function removePlan(id) {
  const p = db.get('plans', id);
  if (!p) return false;
  db.remove('plans', id);
  // Don't strand members on a now-deleted plan with a phantom resource grant.
  for (const u of db.all('users')) {
    if (u.plan === id) cancelPlan(u);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */
function publicConfig() {
  const c = cfg();
  return { mode: c.mode, currency: c.currency, trialDays: c.trialDays, paymentsReady: paymentsReady() };
}
function adminConfig() {
  const c = cfg();
  return {
    mode: c.mode, currency: c.currency, trialDays: c.trialDays, cancelBehavior: c.cancelBehavior, trialPlanId: c.trialPlanId,
    stripe: {
      enabled: c.stripe.enabled,
      publishableKey: c.stripe.publishableKey,
      secretKeySet: !!c.stripe.secretKey,
      webhookSecretSet: !!c.stripe.webhookSecret,
    },
    paymentsReady: paymentsReady(),
  };
}
function userPlan(user) {
  return {
    plan: getPlan(user.plan) || null,
    status: user.planStatus || 'none',
    trialEndsAt: user.trialEndsAt || null,
    trialUsed: !!user.trialUsed,
  };
}

/* -------------------------------------------------------------------------- */
/* Applying / cancelling                                                       */
/* -------------------------------------------------------------------------- */
function applyPlan(user, plan, status, extra = {}) {
  const patch = { plan: plan ? plan.id : null, planStatus: status, planSince: new Date().toISOString(), ...extra };
  if (plan && (status === 'active' || status === 'trialing')) {
    patch.resources = { ...(user.resources || {}), ...plan.resources };
  }
  return db.update('users', user.id, patch);
}
function cancelPlan(user) {
  const c = cfg();
  const patch = { planStatus: 'canceled', plan: null, stripeSubId: null };
  if (c.cancelBehavior === 'revert') {
    const d = db.settings().defaults || {};
    patch.resources = { memory: d.memory, cpu: d.cpu, disk: d.disk, servers: d.servers, backups: d.backups, databases: d.databases };
  }
  return db.update('users', user.id, patch);
}

/** Claim a price-0 plan instantly (no payment needed). */
function selectFreePlan(user, planId) {
  if (cfg().mode === 'free') throw new Error('Billing is disabled.'); // not a self-serve quota grant
  const plan = getPlan(planId);
  if (!plan || plan.active === false) throw new Error('Plan not available.');
  if (plan.price > 0) throw new Error('This plan requires payment.');
  // Idempotent: re-claiming the same free plan must not reset/oscillate quota.
  if (user.plan === plan.id && user.planStatus === 'active') return { ok: true, plan: plan.name };
  applyPlan(user, plan, 'active');
  db.log({ type: 'billing', userId: user.id, message: `${user.username} selected the free plan “${plan.name}”` });
  return { ok: true, plan: plan.name };
}

/* ---- Trial anti-abuse ----------------------------------------------------- */
/** Normalize an email so + addressing and gmail dots can't mint fresh trials. */
function normEmail(email) {
  let e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at), domain = e.slice(at + 1);
  local = local.split('+')[0]; // drop +tag plus-addressing (any provider)
  if (domain === 'gmail.com' || domain === 'googlemail.com') { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  return local && domain ? `${local}@${domain}` : e;
}
/** Identity fingerprints a trial is bound to — matching ANY blocks a new trial. */
function trialFingerprints(user, ip) {
  const fps = [];
  const e = normEmail(user.email); if (e) fps.push('email:' + e);
  if (user.discordId) fps.push('discord:' + user.discordId);
  const cip = ip ? ipguard.canonicalIp(ip) : ''; if (cip) fps.push('ip:' + cip);
  return fps;
}

/**
 * Start the single free trial. Hardened against abuse:
 *  - one per account (trialUsed),
 *  - one per identity ACROSS accounts: normalized email, Discord id, and IP are
 *    recorded in a persistent `trialClaims` store; any prior match is rejected
 *    (survives account deletion + re-registration),
 *  - blocked over VPN/proxy when anti-VPN is enabled (stops IP rotation),
 *  - restricted to the admin-configured trial plan when one is set,
 *  - disabled entirely when trialDays <= 0.
 */
async function startTrial(user, planId, ctx = {}) {
  const c = cfg();
  if (c.mode !== 'trial') throw new Error('Free trials are not available.');
  if (c.trialDays <= 0) throw new Error('Free trials are not available.');
  if (user.trialUsed || user.planStatus === 'trialing' || user.planStatus === 'expired')
    throw new Error('You have already used your free trial.');
  if (c.trialPlanId && planId !== c.trialPlanId) throw new Error('That plan is not available for a free trial.');
  const plan = getPlan(planId);
  if (!plan || plan.active === false) throw new Error('Plan not available.');

  // Cross-account identity check (the real anti-abuse).
  const fps = trialFingerprints(user, ctx.ip);
  if (fps.length) {
    const taken = db.all('trialClaims').some((r) => fps.includes(r.fp));
    if (taken) throw new Error('A free trial has already been claimed from this account, email, or network.');
  }
  // Block VPN/proxy IPs (no-op unless the admin enabled anti-VPN). Closes the
  // "hop to a new IP to mint another trial" hole.
  const vpn = await ipguard.vpnBlockReason(ctx.ip || '');
  if (vpn) throw new Error('Free trials are not available over a VPN or proxy.');

  const trialEndsAt = new Date(Date.now() + c.trialDays * 86400000).toISOString();
  applyPlan(user, plan, 'trialing', { trialEndsAt, trialUsed: true });
  for (const fp of fps)
    db.insert('trialClaims', { id: 'tc_' + crypto.randomBytes(5).toString('hex'), fp, userId: user.id, username: user.username, at: new Date().toISOString() });
  db.log({ type: 'billing', userId: user.id, message: `${user.username} started a ${c.trialDays}-day trial of “${plan.name}”` });
  return { ok: true, trialEndsAt };
}

/* -------------------------------------------------------------------------- */
/* Stripe (raw HTTPS — no SDK)                                                 */
/* -------------------------------------------------------------------------- */
function form(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') form(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      form(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}
async function stripe(method, pathname, body) {
  const c = cfg();
  if (!/^sk_/.test(c.stripe.secretKey)) throw new Error('Stripe is not configured.');
  const res = await fetch(STRIPE_API + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + c.stripe.secretKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
  return data;
}

async function createCheckout(user, planId, origin) {
  const c = cfg();
  if (c.mode === 'free') throw new Error('Billing is disabled.');
  if (!paymentsReady()) throw new Error('Payments are not configured yet.');
  const plan = getPlan(planId);
  if (!plan || plan.active === false) throw new Error('Plan not available.');
  if (plan.price <= 0) throw new Error('This plan is free — no checkout needed.');
  const sub = plan.interval !== 'one_time';
  const session = await stripe('POST', '/checkout/sessions', {
    mode: sub ? 'subscription' : 'payment',
    success_url: `${origin}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing?status=cancel`,
    client_reference_id: user.id,
    customer_email: user.email,
    metadata: { userId: user.id, planId: plan.id },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: c.currency,
        unit_amount: plan.price,
        product_data: { name: plan.name, description: plan.description || undefined },
        ...(sub ? { recurring: { interval: plan.interval === 'year' ? 'year' : 'month' } } : {}),
      },
    }],
    ...(sub ? { subscription_data: { metadata: { userId: user.id, planId: plan.id } } } : {}),
  });
  return { url: session.url, id: session.id };
}

/** Verify a returned checkout session and activate the plan (no webhook needed). */
async function confirmCheckout(user, sessionId) {
  if (!sessionId) throw new Error('Missing session id.');
  const s = await stripe('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.client_reference_id && s.client_reference_id !== user.id) throw new Error('This checkout belongs to another account.');
  // Only a genuinely-settled payment activates a plan. `status === 'complete'`
  // can be true while payment_status is 'unpaid' (async/delayed payments), so it
  // is NOT sufficient on its own.
  const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
  if (!paid) return { ok: false, status: s.payment_status || s.status };
  // Idempotent: a returned session_id can be replayed — don't re-apply / re-log.
  if (user.lastCheckoutSessionId && user.lastCheckoutSessionId === s.id)
    return { ok: true, plan: (getPlan(user.plan) || {}).name || null };
  const plan = getPlan(s.metadata && s.metadata.planId);
  if (!plan) throw new Error('Plan not found for this checkout.');
  applyPlan(user, plan, 'active', { stripeCustomerId: s.customer || user.stripeCustomerId || null, stripeSubId: s.subscription || null, lastCheckoutSessionId: s.id });
  db.log({ type: 'billing', userId: user.id, message: `${user.username} subscribed to “${plan.name}”` });
  return { ok: true, plan: plan.name };
}

/* -------------------------------------------------------------------------- */
/* Webhook (renewals / cancellations)                                          */
/* -------------------------------------------------------------------------- */
// Reject webhooks whose signed timestamp is too old/new — matches Stripe's
// default tolerance and prevents indefinite replay of a captured event.
const WEBHOOK_TOLERANCE_S = 300;

function verifyWebhook(rawBody, sigHeader) {
  const secret = cfg().stripe.webhookSecret;
  if (!secret) throw new Error('Webhook secret not configured.');
  const parts = {};
  String(sigHeader || '').split(',').forEach((kv) => { const [k, v] = kv.split('='); if (k) parts[k.trim()] = (v || '').trim(); });
  if (!parts.t || !parts.v1) throw new Error('Bad signature header.');
  // Replay protection: the timestamp must be recent (CWE-294). Checked before
  // the HMAC so a stale-but-valid signature is still rejected.
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > WEBHOOK_TOLERANCE_S)
    throw new Error('Webhook timestamp outside tolerance (possible replay).');
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Webhook signature mismatch.');
  return JSON.parse(payload);
}
// For the initial grant we can trust the session metadata (it links payment to
// the buyer). For every other (state-changing) event we resolve the user ONLY
// by stored ownership — subscription id, then customer id — never by caller
// metadata, so a crafted event can't cancel/flip an account it doesn't own.
function userByCustomer(customerId, metaUserId) {
  if (metaUserId) { const u = db.get('users', metaUserId); if (u) return u; }
  return customerId ? db.find('users', (u) => u.stripeCustomerId === customerId) : null;
}
function userBySubscription(subId, customerId) {
  if (subId) { const u = db.find('users', (x) => x.stripeSubId === subId); if (u) return u; }
  return customerId ? db.find('users', (x) => x.stripeCustomerId === customerId) : null;
}
function handleWebhook(rawBody, sig) {
  const event = verifyWebhook(rawBody, sig);
  // Idempotency: process each Stripe event id at most once (defeats replay
  // within the signature tolerance window and Stripe's own retries/reordering).
  if (event.id) {
    if (db.get('stripeEvents', event.id)) return event.type;
    db.insert('stripeEvents', { id: event.id, type: event.type, at: new Date().toISOString() });
  }
  const obj = (event.data && event.data.object) || {};
  const meta = obj.metadata || {};
  if (event.type === 'checkout.session.completed') {
    const u = userByCustomer(obj.customer, meta.userId);
    const plan = getPlan(meta.planId);
    if (u && plan && plan.active !== false) applyPlan(u, plan, 'active', { stripeCustomerId: obj.customer || null, stripeSubId: obj.subscription || null });
  } else if (event.type === 'invoice.payment_succeeded') {
    // Card recovered after a failure → restore access (was stuck on past_due).
    const u = userBySubscription(obj.subscription, obj.customer);
    if (u && u.planStatus === 'past_due') db.update('users', u.id, { planStatus: 'active' });
  } else if (event.type === 'invoice.payment_failed') {
    const u = userBySubscription(obj.subscription, obj.customer);
    if (u) db.update('users', u.id, { planStatus: 'past_due' });
  } else if (event.type === 'customer.subscription.updated') {
    const u = userBySubscription(obj.id, obj.customer);
    const plan = getPlan(meta.planId);
    if (u && plan && plan.active !== false && ['active', 'trialing'].includes(obj.status)) applyPlan(u, plan, 'active');
  } else if (event.type === 'customer.subscription.deleted') {
    const u = userBySubscription(obj.id, obj.customer);
    if (u) cancelPlan(u);
  }
  return event.type;
}

module.exports = {
  cfg, publicConfig, adminConfig, userPlan, paymentsReady, requiresPlan,
  isTrialExpired, entitled, reconcile,
  plans, getPlan, createPlan, updatePlan, removePlan,
  applyPlan, cancelPlan, selectFreePlan, startTrial,
  createCheckout, confirmCheckout, verifyWebhook, handleWebhook,
};
