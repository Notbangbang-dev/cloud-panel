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

    const node = h('div', { class: 'card hover srv-card', onclick: () => CP.app.go(`/server/${server.id}`) },
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
    return node;
  }

  CP.pages.dashboard = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Dashboard' }]);
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {},
        h('h2', {}, `Welcome back, ${CP.app.user.firstName || CP.app.user.username}`),
        h('p', {}, 'Your game servers at a glance — live resource usage updates automatically.')
      ),
      h('div', { class: 'grow' }),
      CP.app.user.admin ? h('button', { class: 'btn primary', html: `${icon('shield', 16)} Admin Console`, onclick: () => CP.app.go('/admin') }) : null
    ));

    const grid = h('div', { class: 'grid cards' });
    const loader = CP.spinner('Loading your servers…');
    root.append(loader, grid);

    let servers = [];
    async function refresh() {
      try {
        const res = await CP.api.get('/servers');
        servers = res.data;
        loader.remove();
        CP.clear(grid);
        if (!servers.length) {
          grid.appendChild(CP.empty('server', 'No servers yet. Create one from the Admin Console.'));
          return;
        }
        servers.forEach((s) => grid.appendChild(card(s, refresh)));
      } catch (err) {
        loader.remove();
        CP.clear(grid);
        grid.appendChild(CP.empty('alert', err.message));
      }
    }

    await refresh();
    const timer = setInterval(refresh, 3000);
    ctx.onCleanup(() => clearInterval(timer));
  };
})();
