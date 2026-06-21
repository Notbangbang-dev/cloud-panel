/* Cloud Panel — public, read-only server status page */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  function statTile(v, l) {
    return h('div', { class: 'card tile', style: { padding: '14px' } },
      h('div', { class: 'v', style: { fontSize: '26px' } }, String(v)),
      h('div', { class: 'faint', style: { fontSize: '12px' } }, l));
  }

  async function renderOverview(appRoot, ctx) {
    const card = h('div', { class: 'auth-card', style: { maxWidth: '460px' } }, CP.spinner('Loading status…'));
    appRoot.appendChild(h('div', { class: 'auth' }, card,
      h('div', { class: 'auth-legal' }, h('a', { onclick: () => CP.app.go('/') }, 'Powered by Cloud Panel'))));
    async function tick() {
      let d;
      try { const r = await fetch('/api/status'); if (!r.ok) throw new Error('The network status page is not available.'); d = (await r.json()).data; }
      catch (e) { CP.clear(card); card.appendChild(CP.empty('alert', e.message)); return; }
      CP.clear(card);
      card.append(
        h('div', { class: 'auth-brand', style: { justifyContent: 'center' } },
          h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', { style: { fontSize: '20px' } }, d.title))),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '16px', textAlign: 'center' } },
          statTile(d.online, 'Online'), statTile(d.total, 'Servers'), statTile(d.nodes, 'Nodes')),
        h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginTop: '16px' } },
          `Updated ${new Date(d.updatedAt).toLocaleTimeString()} · auto-refreshing`));
    }
    await tick();
    const timer = setInterval(tick, 10000);
    if (ctx && ctx.onCleanup) ctx.onCleanup(() => clearInterval(timer));
  }

  CP.pages.status = async function (appRoot, ctx) {
    CP.clear(appRoot);
    const slug = (ctx && ctx.params && ctx.params.slug) || (location.pathname.split('/').filter(Boolean)[1] || '');
    if (!slug) return renderOverview(appRoot, ctx);

    const card = h('div', { class: 'auth-card', style: { maxWidth: '480px' } }, CP.spinner('Loading status…'));
    const wrap = h('div', { class: 'auth' }, card,
      h('div', { class: 'auth-legal' }, h('a', { onclick: () => CP.app.go('/') }, 'Powered by Cloud Panel')));
    appRoot.appendChild(wrap);

    async function fetchStatus() {
      const res = await fetch('/api/status/' + encodeURIComponent(slug));
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Status page not found'); }
      return (await res.json()).data;
    }

    function render(d) {
      CP.clear(card);
      const dotColor = d.status === 'running' ? 'var(--green, #4ade80)' : d.status === 'starting' || d.status === 'stopping' ? 'var(--amber, #fbbf24)' : '#8a97b4';
      const desc = d.description && d.description !== 'null' ? d.description : '';
      // NOTE: native Element.append() stringifies null → "null", so build the
      // list and filter out empty sections before appending.
      const parts = [
        h('div', { class: 'auth-brand', style: { justifyContent: 'center' } },
          h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', { style: { fontSize: '20px' } }, d.name))),
        h('div', { style: { textAlign: 'center', margin: '6px 0 18px' } },
          h('span', { class: 'status ' + d.status, html: `<span class="dot" style="background:${dotColor}"></span>${d.status}` })),
        desc ? h('p', { class: 'sub', style: { textAlign: 'center' } }, desc) : null,
        h('dl', { class: 'kv' },
          d.egg ? h('dt', {}, 'Type') : null, d.egg ? h('dd', {}, d.egg) : null,
          d.address ? h('dt', {}, 'Address') : null, d.address ? h('dd', { class: 'mono' }, d.address) : null,
          d.status === 'running' ? h('dt', {}, 'Uptime') : null, d.status === 'running' ? h('dd', {}, fmt.duration(d.uptime)) : null,
          d.players ? h('dt', {}, 'Players') : null, d.players ? h('dd', {}, String(d.players.count)) : null,
          (d.uptime24h != null) ? h('dt', {}, 'Uptime (24h)') : null, (d.uptime24h != null) ? h('dd', {}, d.uptime24h + '%') : null
        ),
        d.players && d.players.online && d.players.online.length
          ? h('div', { style: { marginTop: '12px' } },
              h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } }, 'Online now'),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                ...d.players.online.slice(0, 50).map((n) => h('span', { class: 'badge soft' }, n))))
          : null,
        d.resources
          ? h('div', { style: { marginTop: '14px' } },
              CP.bar(`CPU · ${(d.resources.cpu || 0).toFixed(1)}%`, d.resources.cpu || 0, 100, 'cpu'),
              CP.bar(`RAM · ${fmt.bytes(d.resources.memory)} / ${fmt.bytes(d.resources.memoryLimit)}`, d.resources.memory, d.resources.memoryLimit || 1, 'ram'))
          : null,
        h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginTop: '16px' } },
          `Updated ${new Date(d.updatedAt).toLocaleTimeString()} · auto-refreshing`),
      ];
      card.append(...parts.filter((x) => x != null && x !== false));
    }

    async function tick() {
      try { render(await fetchStatus()); }
      catch (err) { CP.clear(card); card.appendChild(CP.empty('alert', err.message)); }
    }
    await tick();
    const timer = setInterval(tick, 10000);
    if (ctx && ctx.onCleanup) ctx.onCleanup(() => clearInterval(timer));
  };
})();
