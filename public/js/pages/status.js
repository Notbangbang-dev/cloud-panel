/* Cloud Panel — public, read-only server status page */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const COL = { ok: 'var(--green, #4ade80)', warn: 'var(--amber, #fbbf24)' };

  function tile(ic, label, valueHtml, accent) {
    return h('div', { class: 'card tile res-tile' },
      h('div', { class: 'k', html: `${icon(ic, 15)} ${label}` }),
      h('div', { class: 'v', html: valueHtml, style: accent ? { color: accent } : undefined }));
  }

  function statusDot(on, size) {
    const s = size || 11;
    return h('span', { style: { width: s + 'px', height: s + 'px', borderRadius: '50%', flex: `0 0 ${s}px`, display: 'inline-block', background: on ? COL.ok : '#5c6788', boxShadow: on ? `0 0 10px ${COL.ok}` : 'none' } });
  }

  function nodeCard(n) {
    return h('div', { class: 'card' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        statusDot(n.online, 10),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('b', {}, n.name),
          n.location ? h('div', { class: 'faint', style: { fontSize: '11.5px' } }, n.location) : null),
        h('span', { class: 'badge soft' }, `${n.serversOnline}/${n.servers} online`)),
      h('div', { style: { marginTop: '12px' } },
        CP.bar(`RAM · ${fmt.bytes(n.memUsed)} / ${n.memMax ? fmt.bytes(n.memMax) : '∞'}`, n.memUsed, n.memMax || 1, 'ram'),
        CP.bar(`Disk · ${fmt.bytes(n.diskUsed)} / ${n.diskMax ? fmt.bytes(n.diskMax) : '∞'}`, n.diskUsed, n.diskMax || 1, 'disk'),
        h('div', { class: 'faint', style: { fontSize: '11.5px', marginTop: '8px' } }, `CPU load · ${n.cpu}%`)));
  }

  async function renderOverview(appRoot, ctx) {
    const page = h('div', { style: { maxWidth: '940px', margin: '0 auto', padding: '30px 18px 60px' } }, CP.spinner('Loading status…'));
    appRoot.appendChild(page);

    function render(d) {
      CP.clear(page);
      const ok = d.status === 'operational';
      const accent = ok ? COL.ok : COL.warn;
      const t = d.totals;

      page.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px', flexWrap: 'wrap' } },
        h('img', { src: '/img/logo.svg', alt: '', style: { width: '40px', height: '40px' } }),
        h('div', { style: { flex: 1, minWidth: '180px' } },
          h('h1', { style: { fontSize: '24px', margin: 0 } }, d.title),
          h('div', { class: 'faint', style: { fontSize: '12px' } }, `Updated ${new Date(d.updatedAt).toLocaleTimeString()} · auto-refreshing`)),
        h('span', { class: 'badge', style: { background: accent + '22', color: accent, border: `1px solid ${accent}55`, fontWeight: 700 } }, ok ? '● Operational' : '● Degraded')));

      page.appendChild(h('div', { class: 'card', style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', borderColor: accent + '55' } },
        statusDot(true, 12), h('b', { style: { fontSize: '15px' } }, ok ? 'All systems operational' : 'Some servers need attention')));

      page.appendChild(h('div', { class: 'grid stat-grid', style: { marginBottom: '18px' } },
        tile('server', 'Servers online', `${t.online}<small> / ${t.servers}</small>`, accent),
        tile('users', 'Players online', String(t.players)),
        tile('activity', 'Uptime (24h)', t.uptime24h != null ? `${t.uptime24h}<small>%</small>` : '—'),
        tile('cpu', 'Live CPU', `${t.cpu}<small>%</small>`)));

      page.appendChild(h('div', { class: 'card', style: { marginBottom: '22px' } },
        h('h3', { html: `${icon('activity', 16)} Network usage` }),
        CP.bar(`Memory · ${fmt.bytes(t.memUsed)} / ${t.memTotal ? fmt.bytes(t.memTotal) : '∞'}`, t.memUsed, t.memTotal || 1, 'ram'),
        CP.bar(`Disk · ${fmt.bytes(t.diskUsed)} / ${t.diskTotal ? fmt.bytes(t.diskTotal) : '∞'}`, t.diskUsed, t.diskTotal || 1, 'disk')));

      if (d.nodes && d.nodes.length) {
        page.appendChild(h('div', { class: 'section-title', style: { margin: '4px 0 12px' } }, `Nodes · ${t.nodesOnline}/${t.nodes} online`));
        page.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' } }, ...d.nodes.map(nodeCard)));
      }

      page.appendChild(h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginTop: '26px' } },
        h('a', { style: { cursor: 'pointer', color: 'var(--cyan)' }, onclick: () => CP.app.go('/') }, 'Powered by Cloud Panel')));
    }

    async function tick() {
      try {
        const r = await fetch('/api/status');
        if (!r.ok) throw new Error('The network status page is not available.');
        render((await r.json()).data);
      } catch (e) {
        CP.clear(page);
        page.appendChild(h('div', { class: 'auth' }, h('div', { class: 'auth-card', style: { maxWidth: '460px' } }, CP.empty('alert', e.message))));
      }
    }
    await tick();
    const timer = setInterval(tick, 12000);
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
