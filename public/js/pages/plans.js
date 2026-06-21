/* Cloud Panel — Plans / billing (user + paywall gate) */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  function money(cents, cur) {
    const v = (cents || 0) / 100;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(v); }
    catch { return '$' + v.toFixed(2); }
  }
  function mib(mb) { return mb >= 1024 ? (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB' : mb + ' MB'; }
  const intervalLabel = (i) => (i === 'one_time' ? 'one-time' : i === 'year' ? '/year' : '/month');
  async function refreshMe() { try { const me = await CP.api.me(); CP.app.user = me.user; CP.app.needsPlan = !!me.needsPlan; } catch {} }

  // Shared plan UI used by both the /billing page and the full-screen paywall.
  async function buildPlansUI(host, opts) {
    opts = opts || {};
    const onActivated = opts.gated ? (() => { location.href = '/'; }) : null;

    // Returning from Stripe Checkout?
    const params = new URLSearchParams(location.search);
    if (params.get('status') === 'success' && params.get('session_id')) {
      try {
        const r = await CP.api.billingConfirm(params.get('session_id'));
        if (r.data && r.data.ok) { CP.ui.toast(`You're now on ${r.data.plan}! 🎉`, 'ok', 5000); await refreshMe(); if (opts.gated) { location.href = '/'; return; } }
      } catch (e) { CP.ui.toast(e.message, 'err'); }
      history.replaceState({}, '', '/billing');
    } else if (params.get('status') === 'cancel') {
      CP.ui.toast('Checkout canceled', 'info');
      history.replaceState({}, '', '/billing');
    }

    const wrap = h('div', {}, CP.spinner('Loading plans…'));
    host.appendChild(wrap);
    const resLine = (label, value) => (value ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${label}: ${value}`) : null);

    function planCard(p, cur, cfg) {
      const isCurrent = cur.plan && cur.plan.id === p.id && (cur.status === 'active' || cur.status === 'trialing');
      const free = p.price <= 0;
      const cta = h('button', { class: 'btn primary block', disabled: isCurrent, html: isCurrent ? `${icon('check', 14)} Current plan` : free ? `${icon('check', 14)} Choose` : `${icon('cart', 14)} Subscribe` });
      cta.onclick = async () => {
        cta.disabled = true;
        try {
          const r = (await CP.api.billingCheckout(p.id)).data;
          if (r.url) { location.href = r.url; return; }
          if (r.free) { CP.ui.toast(`You're on ${r.plan}!`, 'ok'); await refreshMe(); (onActivated || load)(); }
        } catch (e) { CP.ui.toast(e.message, 'err'); cta.disabled = false; }
      };
      let trialBtn = null;
      if (cfg.mode === 'trial' && !free && !cur.trialUsed && !isCurrent) {
        trialBtn = h('button', { class: 'btn ghost block', style: { marginTop: '8px' }, html: `${icon('clock', 14)} Start ${cfg.trialDays}-day free trial` });
        trialBtn.onclick = async () => {
          trialBtn.disabled = true;
          try { await CP.api.billingTrial(p.id); CP.ui.toast('Free trial started! 🎉', 'ok'); await refreshMe(); (onActivated || load)(); }
          catch (e) { CP.ui.toast(e.message, 'err'); trialBtn.disabled = false; }
        };
      }
      return h('div', { class: 'card', style: p.featured ? { borderColor: 'rgba(168,85,247,.55)', boxShadow: '0 0 0 1px rgba(168,85,247,.25)' } : {} },
        p.featured ? h('span', { class: 'badge', style: { background: 'rgba(168,85,247,.18)', color: '#d8b4fe', marginBottom: '8px', display: 'inline-block' } }, '★ Popular') : null,
        h('h3', { style: { margin: '2px 0' } }, p.name),
        h('div', { style: { margin: '6px 0 10px' } },
          h('span', { style: { fontSize: '26px', fontWeight: '800' } }, free ? 'Free' : money(p.price, cfg.currency)),
          free ? null : h('span', { class: 'faint', style: { fontSize: '12px', marginLeft: '4px' } }, intervalLabel(p.interval))),
        p.description ? h('p', { class: 'muted', style: { fontSize: '12.5px', minHeight: '34px' } }, p.description) : h('div', { style: { minHeight: '12px' } }),
        h('div', { style: { margin: '6px 0 10px' } },
          resLine('RAM', p.resources.memory ? mib(p.resources.memory) : null),
          resLine('CPU', p.resources.cpu ? p.resources.cpu + '%' : null),
          resLine('Disk', p.resources.disk ? mib(p.resources.disk) : null),
          resLine('Servers', p.resources.servers || null),
          p.coins ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `+${p.coins} coins`) : null),
        (p.features || []).length
          ? h('div', { style: { margin: '4px 0 12px' } }, ...p.features.map((f) => h('div', { style: { fontSize: '12.5px', display: 'flex', gap: '6px', alignItems: 'center' } }, h('span', { html: icon('check', 12), style: { color: 'var(--green)' } }), f)))
          : null,
        cta, trialBtn);
    }

    async function load() {
      let d;
      try { d = (await CP.api.billing()).data; }
      catch (e) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', e.message)); return; }
      CP.clear(wrap);
      const cur = d.current, cfg = d.config;
      if (!opts.gated && cur.plan) {
        wrap.appendChild(h('div', { class: 'card', style: { marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '12px' } },
          h('div', { class: 'glyph', html: icon('check', 20) }),
          h('div', { style: { flex: 1 } }, h('b', {}, `Current plan: ${cur.plan.name}`),
            h('div', { class: 'muted', style: { fontSize: '12.5px' } }, cur.status === 'trialing' && cur.trialEndsAt ? `Free trial — ends ${new Date(cur.trialEndsAt).toLocaleDateString()}` : `Status: ${cur.status}`))));
      }
      if (cfg.mode !== 'free' && !cfg.paymentsReady) {
        wrap.appendChild(h('div', { class: 'note', style: { marginBottom: '14px' }, html: `${icon('alert', 15)} Card payments aren't fully set up yet — only free plans can be selected for now.` }));
      }
      if (!d.plans.length) { wrap.appendChild(CP.empty('cart', opts.gated ? 'No plans available yet — please contact an administrator.' : 'No plans available yet.')); return; }
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' } });
      d.plans.forEach((p) => grid.appendChild(planCard(p, cur, cfg)));
      wrap.appendChild(grid);
    }

    await load();
  }

  // Normal in-panel page.
  CP.pages.billing = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Plans' }]);
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Plans'), h('p', {}, 'Pick the plan that fits your servers.'))));
    await buildPlansUI(root, {});
  };

  // Full-screen paywall (no sidebar) — shown until the member has a plan/trial.
  CP.pages.paywall = async function (appRoot) {
    CP.clear(appRoot);
    const cfg = CP.app.billing || {};
    const trial = cfg.mode === 'trial';
    const page = h('div', { style: { maxWidth: '940px', margin: '0 auto', padding: '40px 18px 60px' } },
      h('div', { style: { textAlign: 'center', marginBottom: '24px' } },
        h('img', { src: '/img/logo.svg', alt: '', style: { width: '48px', height: '48px' } }),
        h('h1', { style: { fontSize: '26px', margin: '10px 0 4px' } }, trial ? 'Start your free trial' : 'Choose a plan to continue'),
        h('p', { class: 'muted', style: { maxWidth: '520px', margin: '0 auto' } },
          trial ? `Pick a plan to get started${cfg.trialDays ? ` — your first ${cfg.trialDays} days are on us` : ''}.` : 'A plan is required to deploy and manage servers on this panel.'),
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn ghost sm', html: `${icon('logout', 14)} Sign out`, onclick: () => CP.app.logout() }))));
    appRoot.appendChild(page);
    await buildPlansUI(page, { gated: true });
  };
})();
