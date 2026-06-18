/* Cloud Panel — Dashboard */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;

  CP.pages = CP.pages || {};

  function powerBtns(server, refresh) {
    const running = ['running', 'starting'].includes(server.status);
    const act = async (action, e) => {
      e.stopPropagation();
      try {
        await CP.api.post(`/servers/${server.id}/power`, { action });
        CP.ui.toast(`Sent ${action} to ${server.name}`, 'ok');
        setTimeout(refresh, 600);
      } catch (err) { CP.ui.toast(err.message, 'err'); }
    };
    return h('div', { class: 'btn-row', style: { marginLeft: 'auto' } },
      running
        ? h('button', { class: 'btn sm red', title: 'Stop', html: icon('stop', 15), onclick: (e) => act('stop', e) })
        : h('button', { class: 'btn sm green', title: 'Start', html: icon('play', 15), onclick: (e) => act('start', e) }),
      h('button', { class: 'btn sm', title: 'Restart', html: icon('restart', 15), onclick: (e) => act('restart', e) })
    );
  }

  function card(server, refresh) {
    const r = server.resources || {};
    const cpuPct = server.limits.cpu ? (r.cpu || 0) / server.limits.cpu * 100 : 0;
    const memBytes = r.memory || 0;
    const memLimit = (server.limits.memory || 0) * 1024 * 1024;
    const memPct = memLimit ? memBytes / memLimit * 100 : 0;
    const diskBytes = r.disk || 0;
    const diskLimit = r.diskLimit || (server.limits.disk || 0) * 1024 * 1024;
    const diskPct = diskLimit ? diskBytes / diskLimit * 100 : 0;

    return h('div', { class: 'card hover srv-card', onclick: () => CP.app.go(`/server/${server.id}`) },
      h('div', { class: 'top' },
        h('div', { class: 'glyph', html: icon('server', 22) }),
        h('div', { class: 'title' },
          h('b', {}, server.name),
          h('span', { class: 'addr' }, server.allocation ? server.allocation.notation : 'no allocation')
        ),
        CP.statusPill(server.status)
      ),
      h('div', { class: 'bars' },
        CP.bar(`CPU · ${(r.cpu || 0).toFixed(1)}% / ${server.limits.cpu}%`, cpuPct, 100, 'cpu'),
        CP.bar(`RAM · ${fmt.bytes(memBytes)} / ${fmt.mib(server.limits.memory)}`, memPct, 100, 'ram'),
        CP.bar(`Disk · ${fmt.bytes(diskBytes)} / ${fmt.mib(server.limits.disk)}`, diskPct, 100, 'disk')
      ),
      h('div', { class: 'foot' },
        h('span', { class: 'chip', html: `${icon('clock', 13)} ${server.status === 'running' ? fmt.duration(r.uptime) : 'offline'}` }),
        h('span', { class: 'badge soft' }, server.egg ? server.egg.name : '—'),
        powerBtns(server, refresh)
      )
    );
  }

  function resTile(ic, label, value, sub) {
    return h('div', { class: 'card tile res-tile' },
      h('div', { class: 'k', html: `${icon(ic, 15)} ${label}` }),
      h('div', { class: 'v', html: value }),
      sub ? h('div', { class: 'faint', style: { fontSize: '11.5px' } }, sub) : null);
  }

  function renderResPanel(el, d) {
    CP.clear(el);
    const a = d.available, q = d.quota;
    if (CP.app.economyEnabled)
      el.appendChild(resTile('coin', 'Coins', `${(d.coins || 0).toLocaleString()}`, 'spend in the shop'));
    el.appendChild(resTile('drive', 'RAM free', `${fmt.mib(Math.max(0, a.memory))}`, `of ${fmt.mib(q.memory)}`));
    el.appendChild(resTile('cpu', 'CPU free', `${Math.max(0, a.cpu)}<small>%</small>`, `of ${q.cpu}%`));
    el.appendChild(resTile('folderOpen', 'Disk free', `${fmt.mib(Math.max(0, a.disk))}`, `of ${fmt.mib(q.disk)}`));
    el.appendChild(resTile('server', 'Server slots', `${Math.max(0, a.servers)}`, `of ${q.servers}`));
  }

  async function openCreateModal(onCreated) {
    let eggs, res;
    try {
      eggs = (await CP.api.eggs()).data;
      res = (await CP.api.accountResources()).data;
    } catch (err) { return CP.ui.toast(err.message, 'err'); }
    const a = res.available;
    if (a.servers < 1) {
      return CP.ui.toast(CP.app.economyEnabled ? 'No server slots left — buy one in the Shop.' : 'No server slots left — ask an admin for more.', 'err');
    }

    const name = h('input', { placeholder: 'My awesome server' });
    const egg = h('select');
    const byCat = {};
    eggs.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
    Object.keys(byCat).sort().forEach((cat) => {
      const og = document.createElement('optgroup'); og.label = cat;
      byCat[cat].forEach((e) => og.appendChild(h('option', { value: e.id }, e.name)));
      egg.appendChild(og);
    });

    const eggDesc = h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 0' } });
    const eggById = Object.fromEntries(eggs.map((e) => [e.id, e]));
    const updateDesc = () => { const e = eggById[egg.value]; eggDesc.textContent = e ? e.description : ''; };
    egg.addEventListener('change', updateDesc);

    const mem = h('input', { type: 'number', value: Math.min(a.memory, 1024), min: 256, max: a.memory });
    const cpu = h('input', { type: 'number', value: Math.min(a.cpu, 100), min: 25, max: a.cpu });
    const disk = h('input', { type: 'number', value: Math.min(a.disk, 5120), min: 1024, max: a.disk });
    const fieldWithHint = (label, input, hint) =>
      h('label', { class: 'field' }, h('span', {}, label), input, h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '4px' } }, hint));

    const create = h('button', { class: 'btn primary', html: `${icon('rocket', 16)} Deploy server` });
    const ref = CP.ui.modal({
      title: 'Create a server', size: 'lg',
      body: h('div', {},
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field', style: { marginBottom: '2px' } }, h('span', {}, 'Server type'), egg), eggDesc,
        h('div', { class: 'section-title', style: { margin: '16px 0 6px' } }, 'Resources (from your quota)'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' } },
          fieldWithHint('RAM (MB)', mem, `${a.memory} MB free`),
          fieldWithHint('CPU (%)', cpu, `${a.cpu}% free`),
          fieldWithHint('Disk (MB)', disk, `${a.disk} MB free`))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'), create],
    });
    updateDesc();
    setTimeout(() => name.focus(), 50);

    create.onclick = async () => {
      create.disabled = true; create.textContent = 'Deploying…';
      try {
        const r = await CP.api.createServer({ name: name.value, eggId: egg.value, memory: +mem.value, cpu: +cpu.value, disk: +disk.value });
        CP.ui.toast('Server created! 🚀', 'ok');
        ref.close();
        if (onCreated) await onCreated();
        CP.app.go(`/server/${r.data.id}`);
      } catch (err) {
        CP.ui.toast(err.message, 'err');
        create.disabled = false; create.innerHTML = `${icon('rocket', 16)} Deploy server`;
      }
    };
  }

  CP.pages.dashboard = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Dashboard' }]);
    const u = CP.app.user;

    root.appendChild(h('div', { class: 'page-head' },
      h('div', {},
        h('h2', {}, `Welcome back, ${u.firstName || u.username}`),
        h('p', {}, 'Your game servers at a glance — live resource usage updates automatically.')
      ),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', html: `${icon('plus', 16)} New Server`, onclick: () => openCreateModal(reloadAll) }),
      u.admin ? h('button', { class: 'btn', html: `${icon('shield', 16)} Admin`, onclick: () => CP.app.go('/admin') }) : null
    ));

    const resPanel = h('div', { class: 'grid stat-grid', style: { marginBottom: '22px' } });
    root.appendChild(resPanel);

    const grid = h('div', { class: 'grid cards' });
    const loader = CP.spinner('Loading your servers…');
    root.append(loader, grid);

    async function loadResources() {
      try {
        const d = (await CP.api.accountResources()).data;
        renderResPanel(resPanel, d);
        if (CP.app.economyEnabled) CP.app.setCoins(d.coins);
      } catch { /* ignore */ }
    }

    let servers = [];
    async function refresh() {
      try {
        servers = (await CP.api.get('/servers')).data;
        loader.remove();
        CP.clear(grid);
        if (!servers.length) {
          grid.appendChild(h('div', { class: 'empty' },
            h('div', { html: icon('server', 46) }),
            h('div', { style: { marginBottom: '14px' } }, 'No servers yet.'),
            h('button', { class: 'btn primary', html: `${icon('plus', 15)} Create your first server`, onclick: () => openCreateModal(reloadAll) })));
          return;
        }
        servers.forEach((s) => grid.appendChild(card(s, refresh)));
      } catch (err) {
        loader.remove(); CP.clear(grid);
        grid.appendChild(CP.empty('alert', err.message));
      }
    }

    async function reloadAll() { await refresh(); await loadResources(); }

    await refresh();
    await loadResources();
    const timer = setInterval(refresh, 3000);
    ctx.onCleanup(() => clearInterval(timer));
  };
})();
