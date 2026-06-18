/* Cloud Panel — Server detail (console / files / network / startup / settings) */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const TABS = [
    { id: 'console', label: 'Console', icon: 'terminal' },
    { id: 'files', label: 'Files', icon: 'folder' },
    { id: 'network', label: 'Network', icon: 'network' },
    { id: 'startup', label: 'Startup', icon: 'sliders' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  CP.pages.server = async function (root, ctx) {
    const id = ctx.params.id;
    let server;
    root.appendChild(CP.spinner('Loading server…'));
    try {
      server = (await CP.api.get(`/servers/${id}`)).data;
    } catch (err) {
      CP.clear(root);
      root.appendChild(CP.empty('alert', err.message));
      return;
    }
    CP.clear(root);

    const S = {
      server,
      status: server.status,
      stats: server.resources || { cpu: 0, memory: 0, uptime: 0 },
      history: { cpu: [], mem: [] },
      logBuffer: [],
      term: null,
      tiles: null,
      activeTab: ctx.params.tab && TABS.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : 'console',
    };

    ctx.setCrumbs([{ label: 'Servers', href: '/' }, { label: server.name }]);

    /* ---- Header ---- */
    const pill = CP.statusPill(S.status);
    const powerRow = h('div', { class: 'power-row' });
    function renderPower() {
      CP.clear(powerRow);
      if (S.status === 'installing') {
        powerRow.appendChild(h('button', { class: 'btn', disabled: true, html: `${icon('refresh', 15)} Installing…` }));
        return;
      }
      const running = ['running', 'starting', 'stopping'].includes(S.status);
      const mk = (action, cls, ic, label) =>
        h('button', { class: `btn ${cls}`, html: `${icon(ic, 15)} ${label}`, onclick: () => power(action) });
      if (!running) powerRow.appendChild(mk('start', 'green', 'play', 'Start'));
      if (running) powerRow.appendChild(mk('restart', 'amber', 'restart', 'Restart'));
      if (running) powerRow.appendChild(mk('stop', 'red', 'stop', 'Stop'));
      if (running) powerRow.appendChild(mk('kill', 'ghost', 'power', 'Kill'));
    }
    async function power(action) {
      try {
        await CP.api.post(`/servers/${server.id}/power`, { action });
        CP.ui.toast(`Sent ${action}`, 'ok');
      } catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    const header = h('div', { class: 'page-head' },
      h('div', { class: 'srv-header', style: { flex: 1 } },
        h('div', { class: 'glyph', html: icon('server', 26) }),
        h('div', {},
          h('h2', {}, server.name),
          h('span', { class: 'addr' }, server.allocation ? server.allocation.notation : 'no allocation')
        ),
        pill
      ),
      powerRow
    );
    root.appendChild(header);
    renderPower();

    /* ---- Subnav ---- */
    const subnav = h('div', { class: 'subnav' });
    const content = h('div', {});
    TABS.forEach((t) => {
      const a = h('a', { class: S.activeTab === t.id ? 'active' : '', html: `${icon(t.icon, 16)} ${t.label}`,
        onclick: () => switchTab(t.id) });
      t.node = a;
      subnav.appendChild(a);
    });
    root.append(subnav, content);

    function switchTab(tab) {
      S.activeTab = tab;
      TABS.forEach((t) => t.node.classList.toggle('active', t.id === tab));
      history.replaceState({}, '', `/server/${server.id}/${tab}`);
      renderTab();
    }

    function renderTab() {
      S.term = null; S.tiles = null;
      CP.clear(content);
      const fn = { console: tabConsole, files: tabFiles, network: tabNetwork, startup: tabStartup, settings: tabSettings }[S.activeTab];
      fn(S, content, ctx);
    }
    renderTab();

    /* ---- Live websocket (status + stats + console) ---- */
    const ws = CP.api.consoleSocket(server.id, (msg) => {
      if (msg.event === 'status') {
        S.status = msg.status;
        const fresh = CP.statusPill(S.status);
        pill.replaceWith(fresh);
        pill.className = fresh.className; pill.innerHTML = fresh.innerHTML;
        renderPower();
      } else if (msg.event === 'stats') {
        S.stats = msg.stats;
        S.history.cpu.push(msg.stats.cpu || 0);
        S.history.mem.push((msg.stats.memory || 0) / 1048576);
        if (S.history.cpu.length > 40) S.history.cpu.shift();
        if (S.history.mem.length > 40) S.history.mem.shift();
        if (S.tiles) S.tiles.update();
      } else if (msg.event === 'console') {
        const line = { line: msg.line, stream: msg.stream };
        S.logBuffer.push(line);
        if (S.logBuffer.length > 500) S.logBuffer.shift();
        if (S.term) appendLine(S.term, line);
      } else if (msg.event === 'error') {
        CP.ui.toast(msg.message, 'err');
      }
    });
    ctx.onCleanup(() => { try { ws.close(); } catch {} });
  };

  /* ============================ CONSOLE ============================ */
  function appendLine(term, { line, stream }) {
    const near = term.scrollHeight - term.scrollTop - term.clientHeight < 60;
    const cls = stream === 'in' ? 'ln in' : stream === 'err' ? 'ln err' : stream === 'sys' ? 'ln sys' : 'ln';
    term.appendChild(h('div', { class: cls, html: CP.ansiToHtml(line) }));
    while (term.childElementCount > 600) term.removeChild(term.firstChild);
    if (near) term.scrollTop = term.scrollHeight;
  }

  function tabConsole(S, root) {
    const tile = (key, k, ic, color) => {
      const v = h('div', { class: 'v' }, '—');
      const cv = h('canvas');
      const card = h('div', { class: 'card tile' },
        h('div', { class: 'k', html: `${icon(ic, 15)} ${k}` }), v, color ? cv : null);
      return { card, v, cv, key, color };
    };
    const tCpu = tile('cpu', 'CPU Load', 'cpu', '#22d3ee');
    const tMem = tile('mem', 'Memory', 'drive', '#a855f7');
    const tDisk = tile('disk', 'Disk', 'folderOpen');
    const tUp = tile('up', 'Uptime', 'clock');

    const tiles = h('div', { class: 'grid stat-grid', style: { marginBottom: '18px' } },
      tCpu.card, tMem.card, tDisk.card, tUp.card);

    S.tiles = {
      update() {
        const s = S.stats;
        tCpu.v.innerHTML = `${(s.cpu || 0).toFixed(1)}<small>%</small>`;
        tMem.v.innerHTML = `${fmt.bytes(s.memory || 0).replace(/ /, '<small> ')}</small>`;
        tDisk.v.innerHTML = `${fmt.bytes(s.disk || 0)}<small> / ${fmt.mib(S.server.limits.disk)}</small>`;
        tUp.v.innerHTML = S.status === 'running' ? fmt.duration(s.uptime) : '<small>offline</small>';
        CP.sparkline(tCpu.cv, S.history.cpu, '#22d3ee');
        CP.sparkline(tMem.cv, S.history.mem, '#a855f7');
      },
    };

    const term = h('div', { class: 'term' });
    S.term = term;
    S.logBuffer.forEach((l) => appendLine(term, l));
    term.scrollTop = term.scrollHeight;

    const input = h('input', { placeholder: 'Type a command and press Enter…  (try: help, list, say hi)', autocomplete: 'off' });
    const hist = []; let hp = -1;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const cmd = input.value;
        hist.push(cmd); hp = hist.length;
        input.value = '';
        try { await CP.api.post(`/servers/${S.server.id}/command`, { command: cmd }); }
        catch (err) { CP.ui.toast(err.message, 'err'); }
      } else if (e.key === 'ArrowUp' && hp > 0) { hp--; input.value = hist[hp] || ''; }
      else if (e.key === 'ArrowDown') { hp = Math.min(hist.length, hp + 1); input.value = hist[hp] || ''; }
    });

    root.append(tiles, term, h('div', { class: 'console-input', style: { marginTop: '14px' } }, input));
    S.tiles.update();
  }

  /* ============================ FILES ============================ */
  function tabFiles(S, root) {
    let path = '/';
    const crumbs = h('div', { class: 'crumbs2' });
    const tableWrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } });

    function renderCrumbs() {
      CP.clear(crumbs);
      const parts = path.split('/').filter(Boolean);
      crumbs.appendChild(h('a', { html: icon('folderOpen', 15) + ' /', onclick: () => go('/') }));
      let acc = '';
      parts.forEach((p, i) => {
        acc += '/' + p;
        const target = acc;
        crumbs.appendChild(h('span', { class: 'sep' }, '/'));
        crumbs.appendChild(h('a', { onclick: () => go(target) }, p));
      });
    }
    function go(p) { path = p || '/'; load(); }

    async function load() {
      renderCrumbs();
      CP.clear(tableWrap);
      tableWrap.appendChild(CP.spinner('Reading directory…'));
      try {
        const res = await CP.api.get(`/servers/${S.server.id}/files/list?path=${encodeURIComponent(path)}`);
        CP.clear(tableWrap);
        const tbody = h('tbody');
        if (!res.data.length) {
          tableWrap.appendChild(CP.empty('folder', 'This folder is empty.'));
        } else {
          res.data.forEach((f) => tbody.appendChild(fileRow(f)));
          tableWrap.appendChild(h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Name'), h('th', {}, 'Size'), h('th', {}, 'Modified'), h('th', { class: 'right' }, 'Actions'))),
            tbody));
        }
      } catch (err) {
        CP.clear(tableWrap);
        tableWrap.appendChild(CP.empty('alert', err.message));
      }
    }

    function join(name) { return (path === '/' ? '' : path) + '/' + name; }

    function fileRow(f) {
      const full = join(f.name);
      const name = h('div', { class: 'fm-name ' + (f.directory ? 'dir' : 'file'),
        html: `${icon(f.directory ? 'folder' : 'file', 17)} ${CP.esc(f.name)}`,
        onclick: () => (f.directory ? go(full) : openEditor(full, f.name)) });
      return h('tr', {},
        h('td', {}, name),
        h('td', { class: 'muted mono nowrap' }, f.directory ? '—' : fmt.bytes(f.size)),
        h('td', { class: 'muted nowrap' }, fmt.rel(f.modifiedAt)),
        h('td', {}, h('div', { class: 'row-actions' },
          !f.directory ? h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => openEditor(full, f.name) }) : null,
          h('button', { class: 'btn sm ghost icon', title: 'Rename', html: icon('sliders', 14), onclick: () => rename(full, f.name) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => del(full, f.name) })
        ))
      );
    }

    async function openEditor(full, name) {
      let content = '';
      try { content = await CP.api.text(`/servers/${S.server.id}/files/contents?path=${encodeURIComponent(full)}`); }
      catch (err) { return CP.ui.toast(err.message, 'err'); }
      const ta = h('textarea', { style: { minHeight: '52vh', width: '100%' } }, content);
      const ref = CP.ui.modal({
        title: `Editing ${name}`, size: 'lg',
        body: h('div', {}, h('div', { class: 'mono muted', style: { marginBottom: '8px', fontSize: '12px' } }, full), ta),
        footer: [
          h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('save', 15)} Save`, onclick: async () => {
            try {
              await CP.api.post(`/servers/${S.server.id}/files/write`, { path: full, content: ta.value });
              CP.ui.toast('File saved', 'ok'); ref.close(); load();
            } catch (err) { CP.ui.toast(err.message, 'err'); }
          } }),
        ],
      });
    }

    async function rename(full, name) {
      const next = await CP.ui.prompt({ title: 'Rename / Move', label: 'New path (relative to server root)', value: full });
      if (!next || next === full) return;
      try { await CP.api.post(`/servers/${S.server.id}/files/rename`, { from: full, to: next }); CP.ui.toast('Renamed', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function del(full, name) {
      if (!(await CP.ui.confirm({ title: 'Delete', message: `Delete "${name}"? This cannot be undone.`, confirmText: 'Delete' }))) return;
      try { await CP.api.post(`/servers/${S.server.id}/files/delete`, { path: full }); CP.ui.toast('Deleted', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function newFile() {
      const name = await CP.ui.prompt({ title: 'New file', label: 'File name', placeholder: 'config.yml' });
      if (!name) return;
      try { await CP.api.post(`/servers/${S.server.id}/files/write`, { path: join(name), content: '' }); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function newFolder() {
      const name = await CP.ui.prompt({ title: 'New folder', label: 'Folder name', placeholder: 'plugins' });
      if (!name) return;
      try { await CP.api.post(`/servers/${S.server.id}/files/mkdir`, { path: join(name) }); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        crumbs,
        h('div', { class: 'grow', style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm', html: `${icon('folder', 14)} New Folder`, onclick: newFolder }),
        h('button', { class: 'btn sm primary', html: `${icon('plus', 14)} New File`, onclick: newFile })
      ),
      h('p', { class: 'muted', style: { margin: '0 0 14px', fontSize: '13px' } },
        'Tip: you can also connect over SFTP — see the Network tab for connection details.'),
      tableWrap
    );
    load();
  }

  /* ============================ NETWORK ============================ */
  async function tabNetwork(S, root) {
    const sftpPort = (CP.app.ports && CP.app.ports.sftp) || 5657;
    const sftpUser = `${CP.app.user.username}.${S.server.identifier}`;
    const host = location.hostname;

    const allocWrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden', marginBottom: '20px' } }, CP.spinner('Loading allocations…'));

    const sftpCard = h('div', { class: 'card' },
      h('h3', { html: `${icon('key', 16)} SFTP Connection` }),
      h('p', { class: 'muted', style: { marginTop: '4px', fontSize: '13px' } },
        'Connect with any SFTP client (FileZilla, WinSCP, VS Code). Uses the PufferPanel SFTP port.'),
      h('dl', { class: 'kv', style: { marginTop: '16px' } },
        h('dt', {}, 'Address'), h('dd', {}, copyChip(`${host}:${sftpPort}`)),
        h('dt', {}, 'Port'), h('dd', {}, copyChip(String(sftpPort))),
        h('dt', {}, 'Username'), h('dd', {}, copyChip(sftpUser)),
        h('dt', {}, 'Password'), h('dd', { class: 'muted' }, 'Your account password')
      ),
      h('div', { class: 'note', style: { marginTop: '16px' },
        html: `<b>One-click:</b> <span class="mono">sftp://${sftpUser}@${host}:${sftpPort}</span>` })
    );

    root.append(
      h('div', { class: 'section-title' }, 'Allocations (game server ports)'),
      allocWrap,
      h('div', { class: 'section-title' }, 'Remote access'),
      sftpCard
    );

    try {
      const res = await CP.api.get(`/servers/${S.server.id}/allocations`);
      CP.clear(allocWrap);
      const tbody = h('tbody');
      res.data.forEach((a) => tbody.appendChild(h('tr', {},
        h('td', { class: 'mono' }, a.ip),
        h('td', { class: 'mono' }, String(a.port)),
        h('td', {}, copyChip(a.notation)),
        h('td', { class: 'right' }, a.primary ? h('span', { class: 'badge primary' }, 'Primary') : h('span', { class: 'badge soft' }, 'Additional'))
      )));
      allocWrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'IP'), h('th', {}, 'Port'), h('th', {}, 'Connect'), h('th', { class: 'right' }, 'Type'))),
        tbody));
    } catch (err) {
      CP.clear(allocWrap);
      allocWrap.appendChild(CP.empty('alert', err.message));
    }
  }

  function copyChip(text) {
    return h('span', { class: 'copy', html: `<span class="mono">${CP.esc(text)}</span> ${icon('copy', 13)}`, onclick: () => CP.copy(text) });
  }

  /* ============================ STARTUP ============================ */
  async function tabStartup(S, root) {
    root.appendChild(CP.spinner('Loading startup configuration…'));
    let cfg;
    try { cfg = (await CP.api.get(`/servers/${S.server.id}/startup`)).data; }
    catch (err) { CP.clear(root); return root.appendChild(CP.empty('alert', err.message)); }
    CP.clear(root);

    const isAdmin = !!CP.app.user.admin;
    const startupTa = h('textarea', { style: { minHeight: '70px' }, ...(isAdmin ? {} : { readonly: true, title: 'Only administrators can change the startup command' }) }, cfg.startup || '');
    const varInputs = {};
    const varFields = (cfg.variables || []).map((v) => {
      const input = h('input', { value: (cfg.environment && cfg.environment[v.env]) ?? v.default ?? '' });
      varInputs[v.env] = input;
      return h('label', { class: 'field' },
        h('span', {}, `${v.name}  ·  ${v.env}`), input);
    });

    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save changes`, onclick: async () => {
      const environment = {};
      Object.entries(varInputs).forEach(([k, el]) => (environment[k] = el.value));
      const payload = { environment };
      if (isAdmin) payload.startup = startupTa.value; // server also enforces this
      try {
        await CP.api.put(`/servers/${S.server.id}/startup`, payload);
        CP.ui.toast('Startup configuration saved', 'ok');
      } catch (err) { CP.ui.toast(err.message, 'err'); }
    } });

    root.append(
      h('div', { class: 'card' },
        h('h3', {}, 'Startup Command'),
        h('p', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 14px' } },
          'Tokens like {{SERVER_MEMORY}}, {{SERVER_PORT}} and your variables below are substituted at boot.' + (isAdmin ? '' : ' Only administrators can change the raw command.')),
        startupTa,
        cfg.docker ? h('div', { class: 'chip', style: { marginTop: '12px' }, html: `${icon('box', 13)} ${CP.esc(cfg.docker)}` }) : null
      ),
      varFields.length ? h('div', { class: 'card', style: { marginTop: '18px' } },
        h('h3', { style: { marginBottom: '16px' } }, 'Variables'),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' } }, varFields)
      ) : null,
      h('div', { style: { marginTop: '18px' } }, save)
    );
  }

  /* ============================ SETTINGS ============================ */
  function tabSettings(S, root) {
    const nameInput = h('input', { value: S.server.name });
    const descInput = h('input', { value: S.server.description || '' });

    const rename = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save`, onclick: async () => {
      try {
        const res = await CP.api.post(`/servers/${S.server.id}/settings/rename`, { name: nameInput.value, description: descInput.value });
        S.server = res.data; CP.ui.toast('Server details updated', 'ok');
      } catch (err) { CP.ui.toast(err.message, 'err'); }
    } });

    const info = h('dl', { class: 'kv' },
      h('dt', {}, 'Server ID'), h('dd', {}, copyChip(S.server.identifier)),
      h('dt', {}, 'UUID'), h('dd', { class: 'mono faint' }, S.server.uuid),
      h('dt', {}, 'Node'), h('dd', {}, S.server.node ? S.server.node.name : '—'),
      h('dt', {}, 'Egg'), h('dd', {}, S.server.eggDetail ? S.server.eggDetail.name : '—'),
      h('dt', {}, 'Memory'), h('dd', {}, fmt.mib(S.server.limits.memory)),
      h('dt', {}, 'Disk'), h('dd', {}, fmt.mib(S.server.limits.disk)),
      h('dt', {}, 'CPU'), h('dd', {}, S.server.limits.cpu + '%')
    );

    const cards = [
      h('div', { class: 'card' },
        h('h3', {}, 'Server Details'),
        h('label', { class: 'field', style: { marginTop: '14px' } }, h('span', {}, 'Display name'), nameInput),
        h('label', { class: 'field' }, h('span', {}, 'Description'), descInput),
        rename
      ),
      h('div', { class: 'card' }, h('h3', { style: { marginBottom: '16px' } }, 'Information'), info),
    ];

    if (S.server.eggDetail && S.server.eggDetail.installer && S.server.eggDetail.installer !== 'none') {
      cards.push(h('div', { class: 'card' },
        h('h3', {}, 'Reinstall'),
        h('p', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 14px' } },
          'Re-run the egg installer to (re)download server files. Your config files are kept; server jars are replaced.'),
        h('button', { class: 'btn amber', html: `${icon('refresh', 15)} Reinstall server`, onclick: async () => {
          if (!(await CP.ui.confirm({ title: 'Reinstall server', message: 'Re-download and reinstall the server files now?', confirmText: 'Reinstall', danger: false }))) return;
          try {
            await CP.api.post(`/servers/${S.server.id}/reinstall`);
            CP.ui.toast('Reinstall started — watch the console', 'ok');
            CP.app.go(`/server/${S.server.id}/console`);
          } catch (err) { CP.ui.toast(err.message, 'err'); }
        } })
      ));
    }

    if (CP.app.user.admin) {
      cards.push(h('div', { class: 'card danger-zone' },
        h('h3', {}, 'Danger Zone'),
        h('p', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 14px' } },
          'Permanently delete this server and all of its files. This cannot be undone.'),
        h('button', { class: 'btn red', html: `${icon('trash', 15)} Delete Server`, onclick: async () => {
          if (!(await CP.ui.confirm({ title: 'Delete server', message: `Delete "${S.server.name}" and all its data permanently?`, confirmText: 'Delete forever' }))) return;
          try { await CP.api.del(`/admin/servers/${S.server.id}`); CP.ui.toast('Server deleted', 'ok'); CP.app.go('/'); }
          catch (err) { CP.ui.toast(err.message, 'err'); }
        } })
      ));
    }

    root.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } }, cards));
  }
})();
