/* Cloud Panel — Server detail (console / files / network / startup / settings) */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const TABS = [
    { id: 'console', label: 'Console', icon: 'terminal', perm: 'control.console' },
    { id: 'files', label: 'Files', icon: 'folder', perm: 'file' },
    { id: 'mods', label: 'Mods', icon: 'box', perm: 'file' },
    { id: 'databases', label: 'Databases', icon: 'drive', perm: 'database' },
    { id: 'backups', label: 'Backups', icon: 'box', perm: 'backup' },
    { id: 'schedules', label: 'Schedules', icon: 'clock', perm: 'schedule' },
    { id: 'automations', label: 'Automations', icon: 'zap', perm: 'automation' },
    { id: 'players', label: 'Players', icon: 'users', perm: 'player' },
    { id: 'metrics', label: 'Metrics', icon: 'activity', perm: 'control.console' },
    { id: 'network', label: 'Network', icon: 'network', perm: 'allocation' },
    { id: 'startup', label: 'Startup', icon: 'sliders', perm: 'startup' },
    { id: 'subusers', label: 'Subusers', icon: 'users', ownerOnly: true },
    { id: 'settings', label: 'Settings', icon: 'settings', perm: 'settings' },
  ];

  function allowedTabs(server) {
    const access = server.access || { owner: true, permissions: [] };
    if (access.owner) return TABS.slice();
    const perms = access.permissions || [];
    return TABS.filter((t) => !t.ownerOnly && t.perm && perms.includes(t.perm));
  }

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

    const access = server.access || { owner: true, permissions: [] };
    const can = (perm) => access.owner || (access.permissions || []).includes(perm);
    const tabs = allowedTabs(server);
    if (!tabs.length) { root.appendChild(CP.empty('lock', 'You do not have access to any part of this server.')); return; }

    const S = {
      server,
      access,
      can,
      status: server.status,
      stats: server.resources || { cpu: 0, memory: 0, uptime: 0 },
      history: { cpu: [], mem: [] },
      logBuffer: [],
      term: null,
      tiles: null,
      tabCleanups: [],
      onTabCleanup(fn) { this.tabCleanups.push(fn); },
      activeTab: ctx.params.tab && tabs.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : tabs[0].id,
    };

    ctx.setCrumbs([{ label: 'Servers', href: '/' }, { label: server.name }]);

    /* ---- Header ---- */
    const pill = CP.statusPill(S.status);
    const powerRow = h('div', { class: 'power-row' });
    function renderPower() {
      CP.clear(powerRow);
      if (!can('control.power')) return; // subusers without power control see no buttons
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
    tabs.forEach((t) => {
      const a = h('a', { class: S.activeTab === t.id ? 'active' : '', html: `${icon(t.icon, 16)} ${t.label}`,
        onclick: () => switchTab(t.id) });
      t.node = a;
      subnav.appendChild(a);
    });
    root.append(subnav, content);

    function switchTab(tab) {
      S.activeTab = tab;
      tabs.forEach((t) => t.node.classList.toggle('active', t.id === tab));
      history.replaceState({}, '', `/server/${server.id}/${tab}`);
      renderTab();
    }

    function renderTab() {
      // tear down anything the previous tab started (polls, sockets)
      S.tabCleanups.forEach((fn) => { try { fn(); } catch {} });
      S.tabCleanups = [];
      S.term = null; S.tiles = null;
      CP.clear(content);
      const fn = {
        console: tabConsole, files: tabFiles, mods: tabMods, databases: tabDatabases,
        backups: tabBackups, schedules: tabSchedules, automations: tabAutomations,
        players: tabPlayers, metrics: tabMetrics, network: tabNetwork, startup: tabStartup,
        subusers: tabSubusers, settings: tabSettings,
      }[S.activeTab];
      (fn || tabConsole)(S, content, ctx);
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
          !f.directory && /\.zip$/i.test(f.name) ? h('button', { class: 'btn sm ghost icon', title: 'Extract', html: icon('box', 14), onclick: () => extract(full, f.name) }) : null,
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

    async function extract(full, name) {
      if (!(await CP.ui.confirm({ title: 'Extract archive', message: `Extract "${name}" into this folder?`, confirmText: 'Extract', danger: false }))) return;
      try { const r = await CP.api.unzip(S.server.id, full); CP.ui.toast(`Extracted ${r.extracted} file(s)`, 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    // ---- Uploads (files, folders, drag & drop) ----
    const upLabel = h('div', { class: 'upload-label' });
    const upFill = h('i');
    const uploadBar = h('div', { class: 'upload-bar' }, upLabel, h('div', { class: 'bar' }, upFill));
    uploadBar.style.display = 'none';
    const setUpload = (text, frac) => { if (text != null) upLabel.textContent = text; if (frac != null) upFill.style.width = Math.round(frac * 100) + '%'; };

    async function uploadFiles(fileList, useRelative) {
      const items = [...fileList].filter(Boolean);
      if (!items.length) return;
      uploadBar.style.display = '';
      let failed = 0;
      for (let i = 0; i < items.length; i++) {
        const f = items[i];
        const name = useRelative && f.webkitRelativePath ? f.webkitRelativePath : f.name;
        setUpload(`Uploading ${name}  (${i + 1}/${items.length})`, 0);
        try {
          await CP.api.upload(S.server.id, join(name), f, (loaded, total) => setUpload(null, total ? loaded / total : 0));
        } catch (err) { failed++; CP.ui.toast(`${f.name}: ${err.message}`, 'err'); }
      }
      uploadBar.style.display = 'none';
      CP.ui.toast(`Uploaded ${items.length - failed}/${items.length} item(s)`, failed ? 'info' : 'ok');
      load();
    }

    const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' },
      onchange: (e) => { uploadFiles(e.target.files, false); e.target.value = ''; } });
    const folderInput = h('input', { type: 'file', style: { display: 'none' },
      onchange: (e) => { uploadFiles(e.target.files, true); e.target.value = ''; } });
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');

    tableWrap.addEventListener('dragover', (e) => { e.preventDefault(); tableWrap.classList.add('dropping'); });
    tableWrap.addEventListener('dragleave', (e) => { if (e.target === tableWrap) tableWrap.classList.remove('dropping'); });
    tableWrap.addEventListener('drop', (e) => {
      e.preventDefault(); tableWrap.classList.remove('dropping');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files, false);
    });

    root.append(
      h('div', { class: 'fm-bar' },
        crumbs,
        h('div', { class: 'grow', style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm', html: `${icon('folder', 14)} New Folder`, onclick: newFolder }),
        h('button', { class: 'btn sm', html: `${icon('file', 14)} New File`, onclick: newFile }),
        h('button', { class: 'btn sm', html: `${icon('folderOpen', 14)} Upload Folder`, onclick: () => folderInput.click() }),
        h('button', { class: 'btn sm primary', html: `${icon('up', 14)} Upload`, onclick: () => fileInput.click() }),
        fileInput, folderInput
      ),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
        'Drag & drop files here to upload, or use the buttons. Upload a .zip then hit Extract. SFTP details are on the Network tab.'),
      uploadBar,
      tableWrap
    );
    load();
  }

  /* ============================ BACKUPS ============================ */
  function tabBackups(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } });
    const quotaNote = h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'Snapshots of your server files. Restore or download them anytime.');

    async function loadQuota() {
      try {
        const d = (await CP.api.accountResources()).data;
        quotaNote.textContent = `Backup slots: ${Math.max(0, d.available.backups)} free of ${d.quota.backups}. ${d.economyEnabled ? 'Buy more in the Shop.' : ''}`;
      } catch { /* ignore */ }
    }

    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner('Loading backups…'));
      try {
        const list = (await CP.api.backups(S.server.id)).data;
        CP.clear(wrap);
        if (!list.length) { wrap.appendChild(CP.empty('box', 'No backups yet — create one to snapshot your files.')); }
        else {
          const tbody = h('tbody');
          list.forEach((b) => tbody.appendChild(h('tr', {},
            h('td', {}, h('div', { class: 'fm-name file', html: `${icon('box', 16)} ${CP.esc(b.name)}` })),
            h('td', { class: 'muted mono nowrap' }, fmt.bytes(b.sizeBytes)),
            h('td', { class: 'muted nowrap' }, fmt.rel(b.createdAt)),
            h('td', {}, h('div', { class: 'row-actions' },
              h('button', { class: 'btn sm ghost icon', title: 'Restore', html: icon('restart', 14), onclick: () => restore(b) }),
              h('button', { class: 'btn sm ghost icon', title: 'Download', html: icon('save', 14), onclick: () => CP.api.downloadBackup(S.server.id, b.id) }),
              h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => del(b) })))
          )));
          wrap.appendChild(h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Size'), h('th', {}, 'Created'), h('th', { class: 'right' }, 'Actions'))), tbody));
        }
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
      loadQuota();
    }

    async function createBackup() {
      const name = await CP.ui.prompt({ title: 'Create backup', label: 'Name (optional)', placeholder: 'before-update' });
      if (name === null) return;
      CP.ui.toast('Creating backup…', 'info');
      try { await CP.api.createBackup(S.server.id, name); CP.ui.toast('Backup created', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function restore(b) {
      if (!(await CP.ui.confirm({ title: 'Restore backup', message: `Restore "${b.name}"? Files in the backup will overwrite the current ones.`, confirmText: 'Restore', danger: false }))) return;
      try { const r = await CP.api.restoreBackup(S.server.id, b.id); CP.ui.toast(`Restored ${r.restored} file(s)`, 'ok'); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function del(b) {
      if (!(await CP.ui.confirm({ title: 'Delete backup', message: `Delete "${b.name}"? This frees a backup slot.`, confirmText: 'Delete' }))) return;
      try { await CP.api.deleteBackup(S.server.id, b.id); CP.ui.toast('Backup deleted', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Backups'),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm primary', html: `${icon('box', 14)} Create Backup`, onclick: createBackup })),
      quotaNote, wrap
    );
    load();
  }

  /* ============================ AUTOMATIONS ============================ */
  function tabAutomations(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } });

    const actionLabel = (r) =>
      r.action === 'command' ? `Run: ${CP.esc(r.value)}` :
      r.action === 'power' ? `Power: ${r.value}` :
      'Send alert (webhook)';

    function ruleModal(rule, done) {
      rule = rule || {};
      const name = h('input', { value: rule.name || '', placeholder: 'Auto-restart on crash' });
      const match = h('input', { value: rule.match || '', placeholder: 'OutOfMemoryError' });
      const matchType = h('select', {}, ...[['contains', 'Contains text'], ['regex', 'Regex']].map(([v, l]) => h('option', { value: v, selected: (rule.matchType || 'contains') === v }, l)));
      const caseSensitive = h('input', { type: 'checkbox', class: 'switch' }); caseSensitive.checked = !!rule.caseSensitive;
      const action = h('select', {}, ...[['command', 'Send a console command'], ['power', 'Power action'], ['notify', 'Send a Discord / webhook alert']].map(([v, l]) => h('option', { value: v, selected: (rule.action || 'command') === v }, l)));
      const valWrap = h('div', {});
      function renderVal() {
        CP.clear(valWrap);
        const a = action.value;
        if (a === 'power') {
          const sel = h('select', {}, ...['restart', 'stop', 'start', 'kill'].map((p) => h('option', { value: p, selected: rule.value === p }, p)));
          valWrap._get = () => sel.value;
          valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Power action'), sel));
        } else if (a === 'notify') {
          const inp = h('input', { value: rule.action === 'notify' ? rule.value || '' : '', placeholder: 'https://discord.com/api/webhooks/…' });
          valWrap._get = () => inp.value;
          valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Webhook URL (https)'), inp));
        } else {
          const inp = h('input', { value: rule.action === 'command' ? rule.value || '' : '', placeholder: 'say Restarting in 60s…' });
          valWrap._get = () => inp.value;
          valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Console command'), inp));
        }
      }
      action.addEventListener('change', renderVal); renderVal();

      const cooldown = h('input', { type: 'number', min: '0', value: rule.cooldown != null ? rule.cooldown : 30 });
      const enabled = h('input', { type: 'checkbox', class: 'switch' }); enabled.checked = rule.enabled === undefined ? true : !!rule.enabled;

      const testLine = h('input', { placeholder: 'Paste a console line to test…' });
      const testOut = h('span', { class: 'mono', style: { fontSize: '12px', marginLeft: '8px' } }, '');
      let tt;
      testLine.addEventListener('input', () => {
        clearTimeout(tt);
        tt = setTimeout(async () => {
          if (!testLine.value || !match.value) { testOut.textContent = ''; return; }
          try {
            const r = await CP.api.testAutomation(S.server.id, { match: match.value, matchType: matchType.value, caseSensitive: caseSensitive.checked }, testLine.value);
            testOut.textContent = r.data.matched ? '✓ matches' : '✗ no match';
            testOut.style.color = r.data.matched ? 'var(--green)' : 'var(--faint)';
          } catch { testOut.textContent = ''; }
        }, 200);
      });

      const ref = CP.ui.modal({
        title: rule.id ? 'Edit automation' : 'New automation', size: 'lg',
        body: h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), name),
          h('div', { class: 'grid', style: { gridTemplateColumns: '2fr 1fr', gap: '0 16px' } },
            h('label', { class: 'field' }, h('span', {}, 'When console output matches'), match),
            h('label', { class: 'field' }, h('span', {}, 'Match type'), matchType)),
          h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Case sensitive'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Off = ignore capitalization')), h('div', { style: { marginLeft: 'auto' } }, caseSensitive)),
          h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Then…'), action),
          valWrap,
          h('label', { class: 'field' }, h('span', {}, 'Cooldown (seconds — min time between fires)'), cooldown),
          h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Enabled')), h('div', { style: { marginLeft: 'auto' } }, enabled)),
          h('label', { class: 'field', style: { marginTop: '6px' } }, h('span', {}, 'Test against a sample line', testOut), testLine)),
        footer: [
          h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('save', 15)} Save automation`, onclick: async () => {
            const payload = { name: name.value, match: match.value, matchType: matchType.value, caseSensitive: caseSensitive.checked, action: action.value, value: valWrap._get(), cooldown: +cooldown.value, enabled: enabled.checked };
            try {
              if (rule.id) await CP.api.updateAutomation(S.server.id, rule.id, payload);
              else await CP.api.createAutomation(S.server.id, payload);
              CP.ui.toast('Automation saved', 'ok'); ref.close(); done();
            } catch (err) { CP.ui.toast(err.message, 'err'); }
          } }),
        ],
      });
    }

    async function delRule(r) {
      if (!(await CP.ui.confirm({ title: 'Delete automation', message: `Delete "${r.name}"?`, confirmText: 'Delete' }))) return;
      try { await CP.api.deleteAutomation(S.server.id, r.id); CP.ui.toast('Deleted', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner('Loading automations…'));
      try {
        const list = (await CP.api.serverAutomations(S.server.id)).data;
        CP.clear(wrap);
        if (!list.length) {
          wrap.appendChild(CP.empty('zap', 'No automations yet — create one to react to console output automatically.'));
          return;
        }
        const tbody = h('tbody');
        list.forEach((r) => {
          const toggle = h('input', { type: 'checkbox', class: 'switch' }); toggle.checked = !!r.enabled;
          toggle.addEventListener('change', async () => {
            try { await CP.api.updateAutomation(S.server.id, r.id, { enabled: toggle.checked }); CP.ui.toast(toggle.checked ? 'Enabled' : 'Disabled', 'ok'); }
            catch (e) { toggle.checked = !toggle.checked; CP.ui.toast(e.message, 'err'); }
          });
          tbody.appendChild(h('tr', {},
            h('td', {}, h('b', {}, CP.esc(r.name)), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${r.matchType === 'regex' ? 'regex' : 'contains'}: ${CP.esc(r.match)}`)),
            h('td', { class: 'muted' }, actionLabel(r)),
            h('td', { class: 'muted nowrap' }, `${r.cooldown || 0}s`),
            h('td', { class: 'muted nowrap' }, String(r.fireCount || 0)),
            h('td', {}, toggle),
            h('td', {}, h('div', { class: 'row-actions' },
              h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => ruleModal(r, load) }),
              h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delRule(r) })))
          ));
        });
        wrap.appendChild(h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Automation'), h('th', {}, 'Action'), h('th', {}, 'Cooldown'), h('th', {}, 'Fired'), h('th', {}, 'On'), h('th', { class: 'right' }, 'Edit'))),
          tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Console Automations'),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm primary', html: `${icon('zap', 14)} New Automation`, onclick: () => ruleModal(null, load) })),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
        "Watch this server's live console and react automatically — send a command, power-cycle, or fire a Discord/webhook alert when a line matches. Perfect for auto-restart on crashes or instant error alerts."),
      wrap
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
      statusPageCard(S),
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

  /* ---- Public status page card (inside Settings) ---- */
  function statusPageCard(S) {
    const card = h('div', { class: 'card' }, CP.spinner('Loading status page…'));
    (async () => {
      let cfg;
      try { cfg = (await CP.api.statusPageConfig(S.server.id)).data; }
      catch (err) { CP.clear(card); card.appendChild(CP.empty('alert', err.message)); return; }
      const enabled = h('input', { type: 'checkbox', class: 'switch' }); enabled.checked = !!cfg.enabled;
      const showPlayers = h('input', { type: 'checkbox', class: 'switch' }); showPlayers.checked = cfg.showPlayers !== false;
      const showResources = h('input', { type: 'checkbox', class: 'switch' }); showResources.checked = !!cfg.showResources;
      const linkWrap = h('div', { style: { marginTop: '12px' } });
      const renderLink = (slug) => {
        CP.clear(linkWrap);
        if (!slug) return;
        const url = `${location.origin}/status/${slug}`;
        linkWrap.append(
          h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '4px' } }, 'Public URL'),
          copyChip(url),
          h('a', { class: 'btn sm ghost', style: { marginLeft: '8px' }, html: `${icon('globe', 13)} Open`, onclick: () => window.open('/status/' + slug, '_blank') }, '')
        );
      };
      renderLink(cfg.slug);
      const save = h('button', { class: 'btn primary', style: { marginTop: '14px' }, html: `${icon('save', 15)} Save status page`, onclick: async () => {
        try {
          const r = await CP.api.saveStatusPage(S.server.id, { enabled: enabled.checked, showPlayers: showPlayers.checked, showResources: showResources.checked });
          renderLink(r.data.slug);
          CP.ui.toast('Status page saved', 'ok');
        } catch (err) { CP.ui.toast(err.message, 'err'); }
      } });
      CP.clear(card);
      card.append(
        h('h3', { html: `${icon('globe', 16)} Public status page` }),
        h('p', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 12px' } }, 'A shareable, read-only page showing live status and player count — no login required.'),
        h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Enabled')), h('div', { style: { marginLeft: 'auto' } }, enabled)),
        h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Show player list')), h('div', { style: { marginLeft: 'auto' } }, showPlayers)),
        h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Show resources & uptime')), h('div', { style: { marginLeft: 'auto' } }, showResources)),
        linkWrap, save
      );
    })();
    return card;
  }

  /* ============================ MODS / PLUGINS (Modrinth) ============================ */
  function tabMods(S, root) {
    const installedWrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Reading installed…'));
    const resultsWrap = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', marginTop: '12px' } });
    const search = h('input', { placeholder: 'Search Modrinth (e.g. EssentialsX, Sodium)…' });
    const versionFilter = h('input', { placeholder: 'MC version (optional)', style: { maxWidth: '160px' } });
    let folderLabel = h('span', { class: 'badge soft' }, '…');

    async function loadInstalled() {
      CP.clear(installedWrap); installedWrap.appendChild(CP.spinner('Reading installed…'));
      try {
        const d = (await CP.api.pluginInstalled(S.server.id)).data;
        folderLabel.textContent = `${d.loader} → ${d.folder}/`;
        CP.clear(installedWrap);
        if (!d.files.length) { installedWrap.appendChild(CP.empty('box', `No files in ${d.folder}/ yet — search below to install some.`)); return; }
        const tbody = h('tbody');
        d.files.forEach((f) => tbody.appendChild(h('tr', {},
          h('td', {}, h('div', { class: 'fm-name file', html: `${icon('box', 15)} ${CP.esc(f.name)}` })),
          h('td', { class: 'muted mono nowrap' }, fmt.bytes(f.size)),
          h('td', { class: 'muted nowrap' }, fmt.rel(f.modifiedAt)))));
        installedWrap.appendChild(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, `Installed in ${d.folder}/`), h('th', {}, 'Size'), h('th', {}, 'Modified'))), tbody));
      } catch (err) { CP.clear(installedWrap); installedWrap.appendChild(CP.empty('alert', err.message)); }
    }

    async function doSearch() {
      CP.clear(resultsWrap); resultsWrap.appendChild(CP.spinner('Searching Modrinth…'));
      try {
        const d = (await CP.api.pluginSearch(S.server.id, search.value.trim(), versionFilter.value.trim())).data;
        folderLabel.textContent = `${d.loader} → ${d.folder}/`;
        CP.clear(resultsWrap);
        if (!d.hits.length) { resultsWrap.appendChild(CP.empty('search', 'No results — try a different search.')); return; }
        d.hits.forEach((p) => resultsWrap.appendChild(modCard(p)));
      } catch (err) { CP.clear(resultsWrap); resultsWrap.appendChild(CP.empty('alert', err.message)); }
    }

    function modCard(p) {
      const installBtn = h('button', { class: 'btn sm primary', html: `${icon('up', 13)} Install`, onclick: () => pickVersion(p, installBtn) });
      return h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          p.icon ? h('img', { src: p.icon, alt: '', style: { width: '38px', height: '38px', borderRadius: '8px', objectFit: 'cover' } }) : h('div', { class: 'glyph', style: { width: '38px', height: '38px' }, html: icon('box', 18) }),
          h('div', { style: { minWidth: 0 } }, h('b', {}, CP.esc(p.title)), h('div', { class: 'muted', style: { fontSize: '12px' } }, `by ${CP.esc(p.author || '—')} · ${(p.downloads || 0).toLocaleString()} dl`))),
        h('p', { class: 'muted', style: { fontSize: '12.5px', lineHeight: '1.5', margin: '8px 0 10px', maxHeight: '54px', overflow: 'hidden' } }, p.description || ''),
        h('div', { style: { display: 'flex', gap: '8px' } }, installBtn,
          h('a', { class: 'btn sm ghost', html: `${icon('globe', 13)} Page`, onclick: () => window.open(`https://modrinth.com/project/${p.slug}`, '_blank') }, '')));
    }

    async function pickVersion(p, btn) {
      btn.disabled = true;
      let versions;
      try { versions = (await CP.api.pluginVersions(S.server.id, p.projectId, versionFilter.value.trim())).data; }
      catch (err) { btn.disabled = false; return CP.ui.toast(err.message, 'err'); }
      btn.disabled = false;
      if (!versions.length) return CP.ui.toast('No compatible versions for this server.', 'err');
      const sel = h('select', {}, ...versions.slice(0, 50).map((v) => h('option', { value: v.id }, `${v.versionNumber} · MC ${v.gameVersions.slice(0, 3).join(', ')}`)));
      const ref = CP.ui.modal({
        title: `Install ${p.title}`,
        body: h('div', {}, h('label', { class: 'field' }, h('span', {}, 'Version'), sel)),
        footer: [
          h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('up', 14)} Install`, onclick: async () => {
            try { const r = await CP.api.pluginInstall(S.server.id, p.projectId, sel.value); CP.ui.toast(`Installed ${r.data.installed}`, 'ok'); ref.close(); loadInstalled(); }
            catch (err) { CP.ui.toast(err.message, 'err'); }
          } }),
        ],
      });
    }

    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Plugins & Mods'), folderLabel,
        h('div', { style: { flex: 1 } }),
        versionFilter, search,
        h('button', { class: 'btn sm primary', html: `${icon('search', 14)} Search`, onclick: doSearch }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Installed`, onclick: loadInstalled })),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'Search Modrinth and install straight into this server. Restart the server to load new plugins/mods.'),
      installedWrap, resultsWrap
    );
    loadInstalled();
    doSearch();
  }

  /* ============================ DATABASES ============================ */
  function tabDatabases(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Loading databases…'));
    const note = h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'MySQL / MariaDB databases for this server.');
    let state = { hosts: [], limit: 0, used: 0, driver: true };

    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner('Loading databases…'));
      try {
        const res = await CP.api.databases(S.server.id);
        state = { hosts: res.hosts || [], limit: res.limit || 0, used: res.used || 0, driver: res.driver };
        note.textContent = `${state.used} of ${state.limit} databases used.` + (state.driver ? '' : ' (MySQL driver not installed on the panel — ask an admin.)');
        CP.clear(wrap);
        const list = res.data || [];
        if (!list.length) { wrap.appendChild(CP.empty('drive', 'No databases yet — create one below.')); return; }
        const tbody = h('tbody');
        list.forEach((d) => tbody.appendChild(dbRow(d)));
        wrap.appendChild(h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Database'), h('th', {}, 'Username'), h('th', {}, 'Host'), h('th', {}, 'Password'), h('th', { class: 'right' }, 'Actions'))), tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }

    function dbRow(d) {
      let shown = false;
      const pw = h('span', { class: 'mono' }, '••••••••');
      const reveal = h('button', { class: 'btn sm ghost icon', title: 'Show/Hide', html: icon('key', 14), onclick: () => { shown = !shown; pw.textContent = shown ? d.password : '••••••••'; } });
      return h('tr', {},
        h('td', { class: 'mono' }, d.database),
        h('td', { class: 'mono muted' }, d.username),
        h('td', { class: 'mono muted nowrap' }, `${d.host.host}:${d.host.port}`),
        h('td', {}, h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, pw, reveal,
          h('button', { class: 'btn sm ghost icon', title: 'Copy connection string', html: icon('copy', 14), onclick: () => CP.copy(d.connectionString || d.password) }))),
        h('td', {}, h('div', { class: 'row-actions' },
          d.host.phpMyAdminUrl ? h('a', { class: 'btn sm ghost icon', title: 'phpMyAdmin', html: icon('globe', 14), onclick: () => window.open(d.host.phpMyAdminUrl, '_blank') }, '') : null,
          h('button', { class: 'btn sm ghost icon', title: 'Rotate password', html: icon('refresh', 14), onclick: () => rotate(d) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => del(d) }))));
    }

    async function create() {
      if (!state.hosts.length) return CP.ui.toast('No database host configured — ask an admin to add one in Admin → Databases.', 'err');
      if (state.used >= state.limit) return CP.ui.toast(`Database limit reached (${state.limit}).`, 'err');
      const name = h('input', { placeholder: 'e.g. survival' });
      const host = h('select', {}, ...state.hosts.map((hh) => h('option', { value: hh.id }, `${hh.name} (${hh.host})`)));
      const remote = h('input', { value: '%', placeholder: '% (any host)' });
      const ref = CP.ui.modal({
        title: 'Create database',
        body: h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), name),
          h('label', { class: 'field' }, h('span', {}, 'Host'), host),
          h('label', { class: 'field' }, h('span', {}, 'Allowed remote (connections from)'), remote)),
        footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: async () => {
            try { await CP.api.createDatabase(S.server.id, { name: name.value, hostId: host.value, remote: remote.value }); CP.ui.toast('Database created', 'ok'); ref.close(); load(); }
            catch (err) { CP.ui.toast(err.message, 'err'); }
          } }, 'Create')],
      });
    }
    async function rotate(d) {
      if (!(await CP.ui.confirm({ title: 'Rotate password', message: `Generate a new password for ${d.database}?`, confirmText: 'Rotate', danger: false }))) return;
      try { await CP.api.rotateDatabase(S.server.id, d.id); CP.ui.toast('Password rotated', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function del(d) {
      if (!(await CP.ui.confirm({ title: 'Delete database', message: `Delete ${d.database}? This drops the database and its user.`, confirmText: 'Delete' }))) return;
      try { await CP.api.deleteDatabase(S.server.id, d.id); CP.ui.toast('Database deleted', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Databases'),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm primary', html: `${icon('plus', 14)} New Database`, onclick: create })),
      note, wrap
    );
    load();
  }

  /* ============================ SCHEDULES (cron) ============================ */
  function tabSchedules(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Loading schedules…'));
    const PRESETS = [
      ['Every day at 5:00', '0 5 * * *'], ['Every 6 hours', '0 */6 * * *'],
      ['Every hour', '0 * * * *'], ['Every 15 minutes', '*/15 * * * *'],
      ['Weekly (Sun 4:00)', '0 4 * * 0'],
    ];

    function modal(row, done) {
      row = row || {};
      const name = h('input', { value: row.name || '', placeholder: 'Nightly restart' });
      const cron = h('input', { class: 'mono', value: row.cron || '0 5 * * *', placeholder: 'min hour dom mon dow' });
      const presets = h('div', { class: 'grad-quick', style: { gap: '6px', flexWrap: 'wrap' } },
        ...PRESETS.map(([label, expr]) => h('button', { class: 'btn sm ghost', onclick: () => { cron.value = expr; } }, label)));
      const action = h('select', {}, ...[['command', 'Send a console command'], ['power', 'Power action'], ['backup', 'Create a backup']].map(([v, l]) => h('option', { value: v, selected: (row.action || 'command') === v }, l)));
      const valWrap = h('div', {});
      function renderVal() {
        CP.clear(valWrap);
        if (action.value === 'power') {
          const sel = h('select', {}, ...['restart', 'stop', 'start', 'kill'].map((p) => h('option', { value: p, selected: row.value === p }, p)));
          valWrap._get = () => sel.value; valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Power action'), sel));
        } else if (action.value === 'backup') {
          const inp = h('input', { value: row.action === 'backup' ? row.value || '' : '', placeholder: 'Scheduled backup' });
          valWrap._get = () => inp.value; valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Backup name'), inp));
        } else {
          const inp = h('input', { value: row.action === 'command' ? row.value || '' : '', placeholder: 'say Restarting soon…' });
          valWrap._get = () => inp.value; valWrap.appendChild(h('label', { class: 'field' }, h('span', {}, 'Console command'), inp));
        }
      }
      action.addEventListener('change', renderVal); renderVal();
      const onlyOnline = h('input', { type: 'checkbox', class: 'switch' }); onlyOnline.checked = !!row.onlyWhenOnline;
      const enabled = h('input', { type: 'checkbox', class: 'switch' }); enabled.checked = row.enabled === undefined ? true : !!row.enabled;

      const ref = CP.ui.modal({
        title: row.id ? 'Edit schedule' : 'New schedule', size: 'lg',
        body: h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), name),
          h('label', { class: 'field' }, h('span', {}, 'Cron expression (min hour day month weekday)'), cron),
          presets,
          h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Action'), action), valWrap,
          h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Only when running'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Skip if the server is offline')), h('div', { style: { marginLeft: 'auto' } }, onlyOnline)),
          h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Enabled')), h('div', { style: { marginLeft: 'auto' } }, enabled))),
        footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('save', 15)} Save`, onclick: async () => {
            const payload = { name: name.value, cron: cron.value, action: action.value, value: valWrap._get(), onlyWhenOnline: onlyOnline.checked, enabled: enabled.checked };
            try { if (row.id) await CP.api.updateSchedule(S.server.id, row.id, payload); else await CP.api.createSchedule(S.server.id, payload); CP.ui.toast('Schedule saved', 'ok'); ref.close(); done(); }
            catch (err) { CP.ui.toast(err.message, 'err'); }
          } })],
      });
    }

    async function del(r) {
      if (!(await CP.ui.confirm({ title: 'Delete schedule', message: `Delete "${r.name}"?`, confirmText: 'Delete' }))) return;
      try { await CP.api.deleteSchedule(S.server.id, r.id); CP.ui.toast('Deleted', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner('Loading schedules…'));
      try {
        const list = (await CP.api.schedules(S.server.id)).data;
        CP.clear(wrap);
        if (!list.length) { wrap.appendChild(CP.empty('clock', 'No schedules yet — automate restarts, backups and timed commands.')); return; }
        const tbody = h('tbody');
        list.forEach((r) => {
          const toggle = h('input', { type: 'checkbox', class: 'switch' }); toggle.checked = !!r.enabled;
          toggle.addEventListener('change', async () => {
            try { await CP.api.updateSchedule(S.server.id, r.id, { enabled: toggle.checked }); CP.ui.toast(toggle.checked ? 'Enabled' : 'Disabled', 'ok'); load(); }
            catch (e) { toggle.checked = !toggle.checked; CP.ui.toast(e.message, 'err'); }
          });
          const actLabel = r.action === 'command' ? `Run: ${CP.esc(r.value)}` : r.action === 'power' ? `Power: ${r.value}` : `Backup: ${CP.esc(r.value)}`;
          tbody.appendChild(h('tr', {},
            h('td', {}, h('b', {}, CP.esc(r.name)), h('div', { class: 'mono muted', style: { fontSize: '12px' } }, r.cron)),
            h('td', { class: 'muted' }, actLabel),
            h('td', { class: 'muted nowrap', style: { fontSize: '12px' } }, r.nextRunAt ? fmt.date(r.nextRunAt) : '—'),
            h('td', { class: 'muted nowrap', style: { fontSize: '12px' } }, r.lastRunAt ? fmt.rel(r.lastRunAt) : 'never'),
            h('td', {}, toggle),
            h('td', {}, h('div', { class: 'row-actions' },
              h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => modal(r, load) }),
              h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => del(r) })))));
        });
        wrap.appendChild(h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Schedule'), h('th', {}, 'Action'), h('th', {}, 'Next run'), h('th', {}, 'Last run'), h('th', {}, 'On'), h('th', { class: 'right' }, 'Edit'))), tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Scheduled Tasks'),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh`, onclick: load }),
        h('button', { class: 'btn sm primary', html: `${icon('clock', 14)} New Schedule`, onclick: () => modal(null, load) })),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'Run commands, power actions or backups on a cron schedule — a nightly restart, a 3am backup, timed announcements.'),
      wrap
    );
    load();
  }

  /* ============================ PLAYERS ============================ */
  function tabPlayers(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Loading players…'));
    const countChip = h('span', { class: 'badge soft' }, '0 online');

    async function load() {
      try {
        const d = (await CP.api.players(S.server.id)).data;
        countChip.textContent = `${d.count} online`;
        CP.clear(wrap);
        if (S.status !== 'running') { wrap.appendChild(CP.empty('users', 'Server is offline.')); return; }
        if (!d.online.length) { wrap.appendChild(CP.empty('users', 'No players online right now.')); return; }
        const tbody = h('tbody');
        d.online.forEach((p) => tbody.appendChild(h('tr', {},
          h('td', {}, h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            h('img', { src: `https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/28`, alt: '', style: { width: '28px', height: '28px', borderRadius: '6px' }, onerror: (e) => { e.target.style.display = 'none'; } }),
            h('b', {}, CP.esc(p.name)))),
          h('td', {}, h('div', { class: 'row-actions' },
            h('button', { class: 'btn sm ghost', html: `${icon('logout', 13)} Kick`, onclick: () => act('kick', p.name) }),
            h('button', { class: 'btn sm red', html: `${icon('x', 13)} Ban`, onclick: () => act('ban', p.name) })))
        )));
        wrap.appendChild(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'right' }, 'Actions'))), tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }
    async function act(kind, name) {
      const fn = kind === 'ban' ? CP.api.banPlayer : CP.api.kickPlayer;
      if (kind === 'ban' && !(await CP.ui.confirm({ title: 'Ban player', message: `Ban ${name}?`, confirmText: 'Ban' }))) return;
      try { await fn.call(CP.api, S.server.id, name); CP.ui.toast(`${kind === 'ban' ? 'Banned' : 'Kicked'} ${name}`, 'ok'); setTimeout(load, 400); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }
    async function refresh() { try { await CP.api.playersRefresh(S.server.id); } catch {} setTimeout(load, 400); }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Players'), countChip,
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', html: `${icon('refresh', 14)} Refresh (/list)`, onclick: refresh })),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, "Who's online, parsed live from the console. Kick or ban with one click."),
      wrap
    );
    load();
    const timer = setInterval(load, 5000);
    S.onTabCleanup(() => clearInterval(timer));
  }

  /* ============================ METRICS ============================ */
  function tabMetrics(S, root) {
    let range = 86400;
    const summary = h('div', { class: 'grid stat-grid', style: { marginBottom: '16px' } });
    const cpuCanvas = h('canvas', { style: { width: '100%', height: '160px' } });
    const memCanvas = h('canvas', { style: { width: '100%', height: '160px' } });
    const cpuCard = h('div', { class: 'card' }, h('h3', { html: `${icon('cpu', 15)} CPU load (%)` }), cpuCanvas);
    const memCard = h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', { html: `${icon('drive', 15)} Memory` }), memCanvas);

    const ranges = [['1h', 3600], ['6h', 21600], ['24h', 86400], ['7d', 604800]];
    const rangeBtns = h('div', { class: 'grad-quick', style: { gap: '6px' } });
    function renderRangeBtns() {
      CP.clear(rangeBtns);
      ranges.forEach(([l, v]) => rangeBtns.appendChild(h('button', { class: 'btn sm ' + (range === v ? 'primary' : 'ghost'), onclick: () => { range = v; renderRangeBtns(); load(); } }, l)));
    }
    renderRangeBtns();

    async function load() {
      try {
        const res = await CP.api.serverMetrics(S.server.id, range);
        const pts = res.data || [];
        const sm = res.summary || {};
        CP.clear(summary);
        const tile = (ic, k, v) => h('div', { class: 'card tile' }, h('div', { class: 'k', html: `${icon(ic, 15)} ${k}` }), h('div', { class: 'v', html: v }));
        summary.append(
          tile('activity', 'Uptime', sm.uptimePercent == null ? '—' : `${sm.uptimePercent}<small>%</small>`),
          tile('cpu', 'Peak CPU', `${(sm.peakCpu || 0).toFixed(0)}<small>%</small>`),
          tile('drive', 'Peak RAM', fmt.bytes(sm.peakMem || 0)),
          tile('clock', 'Samples', String(sm.samples || 0)));
        CP.sparkline(cpuCanvas, pts.map((p) => p.cpu || 0), '#22d3ee');
        CP.sparkline(memCanvas, pts.map((p) => (p.mem || 0) / 1048576), '#a855f7');
        if (!pts.length) { cpuCanvas.getContext('2d').clearRect(0, 0, cpuCanvas.width, cpuCanvas.height); }
      } catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Historical Metrics'),
        h('div', { style: { flex: 1 } }), rangeBtns),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'CPU, memory and uptime recorded every minute. Live values still stream on the Console tab.'),
      summary, cpuCard, memCard
    );
    load();
    const timer = setInterval(load, 60000);
    S.onTabCleanup(() => clearInterval(timer));
  }

  /* ============================ SUBUSERS ============================ */
  function tabSubusers(S, root) {
    const wrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Loading subusers…'));
    let PERMS = [];

    const PERM_LABELS = {
      'control.console': 'View console & stats', 'control.command': 'Send commands', 'control.power': 'Start / stop / restart',
      file: 'Manage files & mods', backup: 'Manage backups', automation: 'Manage automations', schedule: 'Manage schedules',
      database: 'Manage databases', player: 'View players, kick & ban', startup: 'Edit startup variables',
      allocation: 'View network / SFTP', settings: 'Rename & status page', activity: 'View activity log',
    };

    function permPicker(selected) {
      const set = new Set(selected || []);
      const inputs = {};
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '6px 14px' } },
        ...PERMS.map((p) => {
          const cb = h('input', { type: 'checkbox' }); cb.checked = set.has(p); inputs[p] = cb;
          return h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' } }, cb, h('span', {}, PERM_LABELS[p] || p));
        }));
      return { grid, get: () => Object.keys(inputs).filter((p) => inputs[p].checked) };
    }

    function addModal() {
      const ident = h('input', { placeholder: 'username or email' });
      const picker = permPicker(['control.console', 'control.command']);
      const ref = CP.ui.modal({
        title: 'Add subuser', size: 'lg',
        body: h('div', {},
          h('label', { class: 'field' }, h('span', {}, 'Account (must already exist)'), ident),
          h('div', { class: 'section-title', style: { margin: '12px 0 8px' } }, 'Permissions'), picker.grid),
        footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('plus', 14)} Add`, onclick: async () => {
            try { await CP.api.addSubuser(S.server.id, ident.value.trim(), picker.get()); CP.ui.toast('Subuser added', 'ok'); ref.close(); load(); }
            catch (err) { CP.ui.toast(err.message, 'err'); }
          } }, 'Add')],
      });
    }
    function editModal(su) {
      const picker = permPicker(su.permissions);
      const ref = CP.ui.modal({
        title: `Permissions · ${su.user.username}`, size: 'lg',
        body: h('div', {}, picker.grid),
        footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
          h('button', { class: 'btn primary', html: `${icon('save', 14)} Save`, onclick: async () => {
            try { await CP.api.updateSubuser(S.server.id, su.id, picker.get()); CP.ui.toast('Updated', 'ok'); ref.close(); load(); }
            catch (err) { CP.ui.toast(err.message, 'err'); }
          } }, 'Save')],
      });
    }
    async function del(su) {
      if (!(await CP.ui.confirm({ title: 'Remove subuser', message: `Remove ${su.user.username}'s access?`, confirmText: 'Remove' }))) return;
      try { await CP.api.deleteSubuser(S.server.id, su.id); CP.ui.toast('Removed', 'ok'); load(); }
      catch (err) { CP.ui.toast(err.message, 'err'); }
    }

    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner('Loading subusers…'));
      try {
        const res = await CP.api.serverSubusers(S.server.id);
        PERMS = res.permissions || [];
        const list = res.data || [];
        CP.clear(wrap);
        if (!list.length) { wrap.appendChild(CP.empty('users', 'No subusers yet — invite someone to help manage this server.')); return; }
        const tbody = h('tbody');
        list.forEach((su) => tbody.appendChild(h('tr', {},
          h('td', {}, h('b', {}, CP.esc(su.user.username)), h('div', { class: 'muted', style: { fontSize: '12px' } }, su.user.email)),
          h('td', { class: 'muted', style: { fontSize: '12px' } }, `${su.permissions.length} permission(s)`),
          h('td', {}, h('div', { class: 'row-actions' },
            h('button', { class: 'btn sm ghost icon', title: 'Edit permissions', html: icon('edit', 14), onclick: () => editModal(su) }),
            h('button', { class: 'btn sm ghost icon', title: 'Remove', html: icon('trash', 14), onclick: () => del(su) })))
        )));
        wrap.appendChild(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Access'), h('th', { class: 'right' }, 'Actions'))), tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }

    root.append(
      h('div', { class: 'fm-bar' },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Subusers'),
        h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn sm primary', html: `${icon('plus', 14)} Add Subuser`, onclick: addModal })),
      h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } }, 'Share this server with other accounts and choose exactly what each can do.'),
      wrap
    );
    load();
  }
})();
