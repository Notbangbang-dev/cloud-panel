/* Cloud Panel — Admin console */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const SUBS = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'analytics', label: 'Analytics', icon: 'activity' },
    { id: 'servers', label: 'Servers', icon: 'server' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'nodes', label: 'Nodes', icon: 'cpu' },
    { id: 'locations', label: 'Locations', icon: 'pin' },
    { id: 'allocations', label: 'Allocations', icon: 'network' },
    { id: 'eggs', label: 'Eggs', icon: 'box' },
    { id: 'databases', label: 'Databases', icon: 'drive' },
    { id: 'settings', label: 'Settings', icon: 'sliders' },
    { id: 'achievements', label: 'Achievements', icon: 'zap' },
    { id: 'billing', label: 'Billing', icon: 'cart' },
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'login', label: 'Login', icon: 'key' },
  ];

  /** Drop any unsaved live-preview and restore the saved theme. */
  function removeAppearancePreview() {
    if (document.getElementById('cp-appearance-preview') && CP.appearance) CP.appearance.clearPreview();
  }

  /* While editing the GLOBAL panel theme, the admin's own *personal* theme
     (Account → Appearance) would otherwise sit on top of the cascade and mask
     every change — so a global Save looks like it does nothing. Suspend the
     personal theme on entering the Appearance tab and restore it on leaving,
     so the admin previews and saves against the true global theme. */
  let _personalThemeSuspended = false;
  function suspendPersonalTheme() {
    if (_personalThemeSuspended) return;
    if (CP.app.user && CP.app.user.themePreset && CP.appearance && CP.appearance.applyUserPreset) {
      _personalThemeSuspended = true;
      CP.appearance.applyUserPreset(null);
    }
  }
  function restorePersonalTheme() {
    if (!_personalThemeSuspended) return;
    _personalThemeSuspended = false;
    if (CP.appearance && CP.appearance.applyUserPreset) CP.appearance.applyUserPreset((CP.app.user && CP.app.user.themePreset) || null);
  }

  CP.pages.admin = async function (root, ctx) {
    if (!CP.app.user.admin) { root.appendChild(CP.empty('shield', 'Administrator access required.')); return; }
    ctx.setCrumbs([{ label: 'Admin' }]);
    ctx.onCleanup(() => { removeAppearancePreview(); restorePersonalTheme(); });

    let active = ctx.params.tab && SUBS.some((s) => s.id === ctx.params.tab) ? ctx.params.tab : 'overview';

    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', { html: `${icon('shield', 22)} Admin Console` }),
        h('p', {}, 'Manage every server, user, node and allocation across Cloud Panel.'))
    ));

    const tabs = h('div', { class: 'tabs2' });
    const content = h('div', {});
    SUBS.forEach((s) => {
      const t = h('div', { class: 'tab2' + (active === s.id ? ' active' : ''), html: `${icon(s.icon, 14)} ${s.label}`,
        onclick: () => { active = s.id; SUBS.forEach((x) => x.node.classList.toggle('active', x.id === active)); history.replaceState({}, '', `/admin/${active}`); render(); } });
      s.node = t; tabs.appendChild(t);
    });
    root.append(tabs, content);

    function render() {
      removeAppearancePreview(); // leaving a tab discards an unsaved theme preview
      restorePersonalTheme();    // leaving Appearance restores the admin's personal theme
      CP.clear(content);
      ({ overview, analytics: analyticsTab, servers, users, nodes, locations, allocations, eggs, databases: databasesTab, settings, achievements: achievementsTab, billing: billingTab, appearance: appearanceTab, login: loginTab }[active])(content);
    }
    render();
  };

  function loading(root) { root.appendChild(CP.spinner()); }
  function tableCard(...kids) { return h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, ...kids); }

  /* ---------------- Overview ---------------- */
  async function overview(root) {
    loading(root);
    let d;
    try { d = (await CP.api.get('/admin/overview')).data; }
    catch (err) { CP.clear(root); return root.appendChild(CP.empty('alert', err.message)); }
    CP.clear(root);
    const c = d.counts;
    const stat = (ic, v, k) => h('div', { class: 'card ov-stat' },
      h('div', { class: 'ic', html: icon(ic, 26) }), h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, k));

    root.appendChild(h('div', { class: 'grid ring-grid' },
      stat('server', c.servers, 'Servers'),
      stat('zap', c.running, 'Running'),
      stat('users', c.users, 'Users'),
      stat('cpu', c.nodes, 'Nodes'),
      stat('network', `${c.allocationsUsed}/${c.allocations}`, 'Allocations'),
      stat('pin', c.locations, 'Locations')
    ));

    root.appendChild(h('div', { class: 'note', style: { margin: '20px 0' },
      html: `${icon('info', 15)} Panel ports — <b>Web</b> <span class="mono">${d.ports.web}</span> · <b>SFTP</b> <span class="mono">${d.ports.sftp}</span>. Version ${d.version}.` }));

    root.appendChild(h('div', { class: 'section-title' }, 'Node Capacity'));
    const nodeGrid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' } });
    d.nodes.forEach((n) => nodeGrid.appendChild(h('div', { class: 'card' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('div', { class: 'glyph', style: { width: '40px', height: '40px' }, html: icon('cpu', 20) }),
        h('div', {}, h('b', {}, n.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, n.location ? n.location.long : '—')),
        n.maintenance ? h('span', { class: 'badge admin', style: { marginLeft: 'auto' } }, 'Maintenance') : h('span', { class: 'badge green', style: { marginLeft: 'auto' } }, 'Online')),
      h('div', { class: 'bars', style: { marginTop: '14px' } },
        CP.bar(`Memory · ${fmt.mib(n.usage.memory)} / ${fmt.mib(n.usage.memoryMax)}`, n.usage.memory, n.usage.memoryMax, 'ram'),
        CP.bar(`Disk · ${fmt.mib(n.usage.disk)} / ${fmt.mib(n.usage.diskMax)}`, n.usage.disk, n.usage.diskMax, 'disk')),
      h('div', { class: 'foot', style: { marginTop: '14px' } },
        h('span', { class: 'chip' }, `${n.serverCount} servers`),
        h('span', { class: 'chip' }, `${n.allocationsUsed}/${n.allocationCount} ports`))
    )));
    root.appendChild(nodeGrid);

    root.appendChild(h('div', { class: 'section-title' }, 'Recent Activity'));
    const tbody = h('tbody');
    d.activity.forEach((a) => tbody.appendChild(h('tr', {},
      h('td', {}, h('span', { class: 'badge soft' }, a.type)),
      h('td', {}, a.message),
      h('td', { class: 'muted nowrap right' }, fmt.rel(a.createdAt)))));
    root.appendChild(tableCard(h('table', { class: 'tbl' }, tbody)));
  }

  /* ---------------- Servers ---------------- */
  async function servers(root) {
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { class: 'grow', style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Create Server`, onclick: () => createServer(() => servers(CP.clear(root))) })));
    const wrap = tableCard(CP.spinner());
    root.appendChild(wrap);
    try {
      const list = (await CP.api.get('/admin/servers')).data;
      CP.clear(wrap);
      const tbody = h('tbody');
      list.forEach((s) => tbody.appendChild(h('tr', {},
        h('td', {}, h('div', { class: 'fm-name', html: `${icon('server', 16)} ${CP.esc(s.name)}`, onclick: () => CP.app.go(`/server/${s.id}`) })),
        h('td', {}, CP.statusPill(s.status)),
        h('td', { class: 'muted' }, s.owner ? s.owner.username : '—'),
        h('td', { class: 'muted' }, s.node ? s.node.name : '—'),
        h('td', { class: 'mono muted' }, s.allocation ? s.allocation.notation : '—'),
        h('td', { class: 'muted nowrap' }, fmt.mib(s.limits.memory)),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm ghost icon', title: 'Open', html: icon('chevron', 14), onclick: () => CP.app.go(`/server/${s.id}`) }),
          h('button', { class: 'btn sm ghost icon', title: 'Edit resources', html: icon('edit', 14), onclick: () => editServerModal(s, () => servers(CP.clear(root))) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delServer(s, () => servers(CP.clear(root))) })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Status'), h('th', {}, 'Owner'), h('th', {}, 'Node'), h('th', {}, 'Allocation'), h('th', {}, 'Memory'), h('th', { class: 'right' }, 'Actions'))),
        tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }

  async function createServer(done) {
    const [users, nodes, eggs] = await Promise.all([
      CP.api.get('/admin/users'), CP.api.get('/admin/nodes'), CP.api.get('/admin/eggs'),
    ]);
    const eggById = Object.fromEntries(eggs.data.map((e) => [e.id, e]));
    const name = h('input', { placeholder: 'My Server' });
    const owner = h('select', {}, ...users.data.map((u) => h('option', { value: u.id }, `${u.username} (${u.email})`)));
    const node = h('select', {}, ...nodes.data.map((n) => h('option', { value: n.id }, n.name)));

    // Egg picker grouped by category.
    const egg = h('select');
    const byCat = {};
    eggs.data.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
    Object.keys(byCat).sort().forEach((cat) => {
      const og = document.createElement('optgroup');
      og.label = cat;
      byCat[cat].forEach((e) => og.appendChild(h('option', { value: e.id }, e.name)));
      egg.appendChild(og);
    });

    const mem = h('input', { type: 'number', value: '2048' });
    const disk = h('input', { type: 'number', value: '8192' });
    const cpu = h('input', { type: 'number', value: '200' });
    const dbLimit = h('input', { type: 'number', value: '1', min: '0' });
    const backupLimit = h('input', { type: 'number', value: '1', min: '0' });

    const eggDesc = h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '8px 0 0', lineHeight: '1.55' } });
    const eggBadge = h('div', { style: { margin: '8px 0 0' } });
    const varsWrap = h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginTop: '8px' } });
    let varInputs = {};

    function renderEgg() {
      const e = eggById[egg.value];
      eggDesc.textContent = e ? e.description : '';
      CP.clear(eggBadge);
      if (e && e.installer && e.installer !== 'none')
        eggBadge.appendChild(h('span', { class: 'badge green', html: `${icon('zap', 12)} Auto-installs ${e.installer}` }));
      else eggBadge.appendChild(h('span', { class: 'badge soft' }, 'Upload your files via SFTP'));
      CP.clear(varsWrap); varInputs = {};
      (e && e.variables || []).forEach((v) => {
        const input = h('input', { value: v.default != null ? v.default : '' });
        varInputs[v.env] = input;
        varsWrap.appendChild(h('label', { class: 'field' }, h('span', {}, `${v.name} · ${v.env}`), input));
      });
    }
    egg.addEventListener('change', renderEgg);

    const ref = CP.ui.modal({
      title: 'Create Server', size: 'lg',
      body: h('div', {},
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
          h('label', { class: 'field' }, h('span', {}, 'Owner'), owner),
          h('label', { class: 'field' }, h('span', {}, 'Node'), node)),
        h('label', { class: 'field', style: { marginBottom: '2px' } }, h('span', {}, 'Egg / template'), egg),
        eggBadge, eggDesc,
        h('div', { class: 'section-title', style: { margin: '18px 0 6px' } }, 'Template variables'),
        varsWrap,
        h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Resource limits'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' } },
          h('label', { class: 'field' }, h('span', {}, 'Memory (MB)'), mem),
          h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk),
          h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu)),
        h('div', { class: 'section-title', style: { margin: '8px 0 6px' } }, 'Feature limits'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
          h('label', { class: 'field' }, h('span', {}, 'Databases'), dbLimit),
          h('label', { class: 'field' }, h('span', {}, 'Backups'), backupLimit))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          const environment = {};
          Object.entries(varInputs).forEach(([k, el]) => (environment[k] = el.value));
          try {
            const res = await CP.api.post('/admin/servers', {
              name: name.value, ownerId: owner.value, nodeId: node.value, eggId: egg.value,
              memory: +mem.value, disk: +disk.value, cpu: +cpu.value, environment,
              featureLimits: { databases: +dbLimit.value, backups: +backupLimit.value },
            });
            const e = eggById[egg.value];
            ref.close(); done();
            if (e && e.installer && e.installer !== 'none') {
              CP.ui.toast('Server created — installation started', 'ok');
              CP.app.go(`/server/${res.data.id}/console`);
            } else {
              CP.ui.toast('Server created', 'ok');
            }
          } catch (err) { CP.ui.toast(err.message, 'err'); }
        } }, 'Create')],
    });
    renderEgg();
  }
  function editServerModal(s, done) {
    const L = s.limits || {}, F = s.featureLimits || {};
    const mem = h('input', { type: 'number', value: L.memory || 0 });
    const cpu = h('input', { type: 'number', value: L.cpu || 0 });
    const disk = h('input', { type: 'number', value: L.disk || 0 });
    const dbs = h('input', { type: 'number', value: F.databases || 0, min: '0' });
    const bks = h('input', { type: 'number', value: F.backups || 0, min: '0' });
    const allo = h('input', { type: 'number', value: F.allocations || 0, min: '0' });
    const ref = CP.ui.modal({
      title: `Resources · ${s.name}`, size: 'lg',
      body: h('div', {},
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '0 0 12px' } }, 'Admins set these directly — not bound by the owner\'s quota.'),
        h('div', { class: 'section-title', style: { margin: '0 0 6px' } }, 'Resource limits'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' } },
          h('label', { class: 'field' }, h('span', {}, 'RAM (MB)'), mem),
          h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu),
          h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk)),
        h('div', { class: 'section-title', style: { margin: '8px 0 6px' } }, 'Feature limits'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' } },
          h('label', { class: 'field' }, h('span', {}, 'Databases'), dbs),
          h('label', { class: 'field' }, h('span', {}, 'Backups'), bks),
          h('label', { class: 'field' }, h('span', {}, 'Allocations'), allo))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', html: `${icon('save', 14)} Save`, onclick: async () => {
          try {
            await CP.api.request('PATCH', `/admin/servers/${s.id}`, {
              limits: { memory: +mem.value, cpu: +cpu.value, disk: +disk.value },
              featureLimits: { databases: +dbs.value, backups: +bks.value, allocations: +allo.value },
            });
            CP.ui.toast('Server resources updated', 'ok'); ref.close(); done();
          } catch (err) { CP.ui.toast(err.message, 'err'); }
        } }, 'Save')],
    });
  }

  async function delServer(s, done) {
    if (!(await CP.ui.confirm({ title: 'Delete server', message: `Delete "${s.name}" and all data?`, confirmText: 'Delete' }))) return;
    try { await CP.api.del(`/admin/servers/${s.id}`); CP.ui.toast('Deleted', 'ok'); done(); } catch (err) { CP.ui.toast(err.message, 'err'); }
  }

  /* ---------------- Users ---------------- */
  function statusBadge(u) {
    if (u.status === 'pending') return h('span', { class: 'badge', style: { background: 'rgba(251,191,36,.16)', color: '#fbbf24' } }, 'Pending');
    if (u.status === 'declined') return h('span', { class: 'badge', style: { background: 'rgba(248,113,113,.16)', color: '#f87171' } }, 'Declined');
    return h('span', { class: 'badge green' }, 'Active');
  }
  function adjustCoins(u, done) {
    const amount = h('input', { type: 'number', min: '0', value: '100' });
    async function apply(sign) {
      const n = Math.floor(Number(amount.value) || 0);
      if (n <= 0) { CP.ui.toast('Enter a positive amount', 'err'); return; }
      try {
        await CP.api.adminCoins(u.id, sign * n);
        CP.ui.toast(`${sign < 0 ? 'Removed' : 'Added'} ${n.toLocaleString()} coins`, 'ok');
        ref.close(); done();
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    }
    const ref = CP.ui.modal({
      title: `Coins · ${u.username}`,
      body: h('div', {},
        h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
          `Current balance: ${(u.coins || 0).toLocaleString()} coins`),
        h('label', { class: 'field' }, h('span', {}, 'Amount'), amount)),
      footer: [
        h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn red', html: `${icon('trash', 14)} Remove`, onclick: () => apply(-1) }),
        h('button', { class: 'btn green', html: `${icon('plus', 14)} Add`, onclick: () => apply(1) }),
      ],
    });
    setTimeout(() => amount.focus(), 50);
  }

  async function users(root) {
    const reload = () => users(CP.clear(root));
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Create User`, onclick: () => createUser(reload) })));
    const pendingHolder = h('div', {});
    const wrap = tableCard(CP.spinner());
    root.append(pendingHolder, wrap);
    try {
      const list = (await CP.api.get('/admin/users')).data;
      const pending = list.filter((u) => u.status === 'pending');

      if (pending.length) {
        const pb = h('tbody');
        pending.forEach((u) => pb.appendChild(h('tr', {},
          h('td', {}, h('b', {}, u.username)),
          h('td', { class: 'muted' }, u.email),
          h('td', { class: 'muted nowrap' }, fmt.rel(u.createdAt)),
          h('td', {}, h('div', { class: 'row-actions' },
            h('button', { class: 'btn sm green', html: `${icon('check', 14)} Approve`, onclick: async () => { try { await CP.api.adminApprove(u.id); CP.ui.toast(`Approved ${u.username}`, 'ok'); reload(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }),
            h('button', { class: 'btn sm red', html: `${icon('x', 14)} Decline`, onclick: async () => { try { await CP.api.adminDecline(u.id); CP.ui.toast(`Declined ${u.username}`, 'info'); reload(); } catch (e) { CP.ui.toast(e.message, 'err'); } } })))
        )));
        pendingHolder.append(
          h('div', { class: 'section-title', style: { marginTop: 0 }, html: `${icon('clock', 13)} Pending approval (${pending.length})` }),
          tableCard(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Email'), h('th', {}, 'Requested'), h('th', { class: 'right' }, 'Actions'))), pb)),
          h('div', { class: 'section-title' }, 'All users')
        );
      }

      CP.clear(wrap);
      const tbody = h('tbody');
      list.forEach((u) => tbody.appendChild(h('tr', {},
        h('td', {}, h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { class: 'avatar', style: { width: '30px', height: '30px', fontSize: '12px' } }, (u.username[0] || '?').toUpperCase()),
          h('b', {}, u.username))),
        h('td', { class: 'muted' }, u.email),
        h('td', {}, u.admin ? h('span', { class: 'badge admin' }, 'Admin') : statusBadge(u)),
        h('td', { class: 'mono' }, CP.app.economyEnabled ? (u.coins || 0).toLocaleString() : '—'),
        h('td', { class: 'muted nowrap', style: { fontSize: '12px' } }, u.resources ? `${u.resources.memory}MB · ${u.resources.cpu}% · ${u.resources.servers} slot(s)` : '—'),
        h('td', {}, h('div', { class: 'row-actions' },
          CP.app.economyEnabled ? h('button', { class: 'btn sm ghost icon', title: 'Add / remove coins', html: icon('coin', 14), onclick: () => adjustCoins(u, reload) }) : null,
          u.id !== CP.app.user.id ? h('button', { class: 'btn sm ghost icon', title: 'View as user', html: icon('users', 14), onclick: () => viewAsUser(u) }) : null,
          h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => editUser(u, reload) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delUser(u, reload) })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Email'), h('th', {}, 'Status'), h('th', {}, 'Coins'), h('th', {}, 'Quota'), h('th', { class: 'right' }, 'Actions'))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  async function viewAsUser(u) {
    if (u.id === CP.app.user.id) return;
    if (!(await CP.ui.confirm({ title: 'View as user', message: `Open the panel as ${u.username}? You can exit back to your admin account at any time.`, confirmText: 'View as user' }))) return;
    try {
      const r = await CP.api.adminImpersonate(u.id);
      sessionStorage.setItem('cp_imp_admin', CP.api.token); // remember the admin session
      sessionStorage.setItem('cp_imp_name', u.username);
      CP.api.token = r.data.token;
      location.href = '/'; // hard reload as the target user
    } catch (e) { CP.ui.toast(e.message, 'err'); }
  }

  // A polished "Administrator" toggle row (switch + label + helper text),
  // shared by the Create and Edit user dialogs.
  function adminToggleRow(input) {
    input.className = 'switch';
    return h('label', { class: 'switch-row', style: { marginTop: '6px', cursor: 'pointer' } },
      h('div', {},
        h('b', { html: `${icon('shield', 14)} Administrator` }),
        h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, 'Full access to every server, user, node and setting.')),
      h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center' } }, input));
  }
  const userField = (label, input, hint) =>
    h('label', { class: 'field' }, h('span', {}, label), input,
      hint ? h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '4px' } }, hint) : null);

  function userForm(u) {
    const username = h('input', { value: u ? u.username : '', placeholder: 'username', disabled: !!u });
    const email = h('input', { type: 'email', value: u ? u.email : '', placeholder: 'user@cloud.panel' });
    const first = h('input', { value: u ? u.firstName : '', placeholder: 'optional' });
    const last = h('input', { value: u ? u.lastName : '', placeholder: 'optional' });
    const password = h('input', { type: 'password', placeholder: u ? 'Leave blank to keep' : 'Set a password' });
    const admin = h('input', { type: 'checkbox' }); if (u && u.admin) admin.checked = true;
    const body = h('div', {},
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        userField('Username', username), userField('Email', email),
        userField('First name', first), userField('Last name', last)),
      userField('Password', password, u ? null : 'The user can change this after they sign in.'),
      adminToggleRow(admin));
    return { body, vals: () => ({ username: username.value, email: email.value, firstName: first.value, lastName: last.value, password: password.value, admin: admin.checked }) };
  }
  function createUser(done) {
    const f = userForm(null);
    const ref = CP.ui.modal({ title: 'Create User', body: f.body, footer: [
      h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        try { await CP.api.post('/admin/users', f.vals()); CP.ui.toast('User created', 'ok'); ref.close(); done(); }
        catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Create')] });
  }
  function editUser(u, done) {
    const r = u.resources || {};
    const email = h('input', { value: u.email });
    const first = h('input', { value: u.firstName || '' });
    const last = h('input', { value: u.lastName || '' });
    const password = h('input', { type: 'password', placeholder: 'Leave blank to keep' });
    const admin = h('input', { type: 'checkbox' }); if (u.admin) admin.checked = true;
    const status = h('select', {}, ...['active', 'pending', 'declined'].map((s) => h('option', { value: s, selected: u.status === s }, s)));
    const coins = h('input', { type: 'number', value: u.coins || 0 });
    const mem = h('input', { type: 'number', value: r.memory || 0 });
    const cpu = h('input', { type: 'number', value: r.cpu || 0 });
    const disk = h('input', { type: 'number', value: r.disk || 0 });
    const slots = h('input', { type: 'number', value: r.servers || 0 });
    const backupsQ = h('input', { type: 'number', value: r.backups || 0 });
    const databasesQ = h('input', { type: 'number', value: r.databases || 0 });

    const body = h('div', {},
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        h('label', { class: 'field' }, h('span', {}, 'Email'), email),
        h('label', { class: 'field' }, h('span', {}, 'Status'), status),
        h('label', { class: 'field' }, h('span', {}, 'First name'), first),
        h('label', { class: 'field' }, h('span', {}, 'Last name'), last),
        h('label', { class: 'field' }, h('span', {}, 'New password'), password),
        h('label', { class: 'field' }, h('span', {}, 'Coins'), coins)),
      adminToggleRow(admin),
      h('div', { class: 'switch-row' },
        h('div', {}, h('b', {}, 'Locked IP'), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, u.lockedIp || 'Not locked to an IP')),
        h('div', { style: { marginLeft: 'auto' } }, u.lockedIp
          ? h('button', { class: 'btn sm ghost', onclick: async () => { try { await CP.api.adminResetIp(u.id); CP.ui.toast('Locked IP reset', 'ok'); ref.close(); done(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }, 'Reset')
          : h('span', { class: 'faint', style: { fontSize: '12px' } }, '—'))),
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Resource quota'),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 12px' } },
        h('label', { class: 'field' }, h('span', {}, 'RAM (MB)'), mem),
        h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu),
        h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk),
        h('label', { class: 'field' }, h('span', {}, 'Slots'), slots),
        h('label', { class: 'field' }, h('span', {}, 'Backups'), backupsQ),
        h('label', { class: 'field' }, h('span', {}, 'Databases'), databasesQ)));

    const ref = CP.ui.modal({ title: `Edit ${u.username}`, size: 'lg', body, footer: [
      h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const patch = {
          email: email.value, firstName: first.value, lastName: last.value, admin: admin.checked,
          status: status.value, coins: +coins.value,
          resources: { memory: +mem.value, cpu: +cpu.value, disk: +disk.value, servers: +slots.value, backups: +backupsQ.value, databases: +databasesQ.value },
        };
        if (password.value) patch.password = password.value;
        try { await CP.api.request('PATCH', `/admin/users/${u.id}`, patch); CP.ui.toast('User updated', 'ok'); ref.close(); done(); }
        catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Save')] });
  }
  async function delUser(u, done) {
    if (!(await CP.ui.confirm({ title: 'Delete user', message: `Delete ${u.username}?`, confirmText: 'Delete' }))) return;
    try { await CP.api.del(`/admin/users/${u.id}`); CP.ui.toast('Deleted', 'ok'); done(); } catch (err) { CP.ui.toast(err.message, 'err'); }
  }

  /* ---------------- Settings (economy / access) ---------------- */
  async function settings(root) {
    loading(root);
    let s;
    try { s = (await CP.api.adminSettings()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);

    const sw = (checked) => { const i = h('input', { type: 'checkbox', class: 'switch' }); i.checked = !!checked; return i; };
    const numIn = (v) => h('input', { type: 'number', value: v, min: 0 });
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const switchRow = (label, desc, input) => h('div', { class: 'switch-row' },
      h('div', {}, h('b', {}, label), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, desc)),
      h('div', { style: { marginLeft: 'auto' } }, input));

    const econEnabled = sw(s.economy.enabled);
    const regEnabled = sw(s.registration.enabled);
    const regApproval = sw(s.registration.requireApproval);
    const force2fa = sw(s.security && s.security.force2faAdmins);
    const singleIp = sw(s.security && s.security.singleIp);
    const antiVpn = sw(s.security && s.security.antiVpn);
    const blockDc = sw(s.security && s.security.blockHosting);
    const ipApiKey = h('input', { value: (s.security && s.security.ipApiKey) || '', placeholder: 'ip-api.com Pro key (optional)' });
    const dCoins = numIn(s.defaults.coins), dMem = numIn(s.defaults.memory), dCpu = numIn(s.defaults.cpu), dDisk = numIn(s.defaults.disk), dServers = numIn(s.defaults.servers), dBackups = numIn(s.defaults.backups), dDatabases = numIn(s.defaults.databases ?? 1);
    const minMem = numIn(s.limits.minMemory), minCpu = numIn(s.limits.minCpu), minDisk = numIn(s.limits.minDisk);
    const shop = {};
    ['memory', 'cpu', 'disk', 'servers', 'backups', 'databases'].forEach((k) => { const it = s.shop[k] || { price: 0, amount: 1 }; shop[k] = { price: numIn(it.price), amount: numIn(it.amount) }; });
    const afkOn = sw(s.afk && s.afk.enabled);
    const afkCoins = numIn(s.afk ? s.afk.coins : 1);
    const afkInterval = numIn(s.afk ? s.afk.intervalSeconds : 30);

    const txtIn = (v, ph) => h('input', { value: v || '', placeholder: ph || '' });
    const areaIn = (v) => { const t = h('textarea', { rows: '2', style: { resize: 'vertical', minHeight: '40px', width: '100%' } }); t.value = v || ''; return t; };
    const selIn = (v, opts) => { const el = h('select', {}, ...opts.map((o) => h('option', { value: o[0] }, o[1]))); el.value = v; return el; };

    const drd = s.dailyReward || {};
    const drOn = sw(drd.enabled), drCoins = numIn(drd.coins ?? 100), drStreak = numIn(drd.streakBonus ?? 0), drMax = numIn(drd.maxBonus ?? 0);
    const mt = s.maintenance || {};
    const mtOn = sw(mt.enabled), mtTitle = txtIn(mt.title, "We'll be right back"), mtMsg = areaIn(mt.message);
    const mtSched = sw(mt.scheduleEnabled);
    const toLocalDT = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    const mtStart = h('input', { type: 'datetime-local', value: toLocalDT(mt.start) });
    const mtEnd = h('input', { type: 'datetime-local', value: toLocalDT(mt.end) });
    const bn = s.banner || {};
    const bnOn = sw(bn.enabled), bnText = txtIn(bn.text, 'Shown across the panel & login screen…');
    const bnStyle = selIn(bn.style || 'info', [['info', 'Info (cyan)'], ['warn', 'Warning (yellow)'], ['success', 'Success (green)'], ['danger', 'Danger (red)']]);
    const seasonalSel = selIn((s.seasonal && s.seasonal.mode) || 'off', [['off', 'Off'], ['auto', 'Auto (by date)'], ['halloween', 'Halloween 🎃'], ['winter', 'Winter ❄️'], ['christmas', 'Christmas 🎄'], ['newyear', 'New Year 🎉']]);
    const bcOn = sw(s.bragCards && s.bragCards.enabled);
    const soOn = sw(s.statusOverview && s.statusOverview.enabled);
    const soTitle = txtIn(s.statusOverview ? s.statusOverview.title : '', 'My Network');

    const shopRow = (label, unit, o) => h('div', { class: 'grid', style: { gridTemplateColumns: '120px 1fr 1fr', gap: '0 12px', alignItems: 'end' } },
      h('div', { style: { paddingBottom: '12px', fontWeight: '700' } }, label),
      field('Price (coins)', o.price), field(`Amount (${unit})`, o.amount));

    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save settings` });
    save.onclick = async () => {
      const patch = {
        economy: { enabled: econEnabled.checked },
        registration: { enabled: regEnabled.checked, requireApproval: regApproval.checked },
        defaults: { coins: +dCoins.value, memory: +dMem.value, cpu: +dCpu.value, disk: +dDisk.value, servers: +dServers.value, backups: +dBackups.value, databases: +dDatabases.value },
        limits: { minMemory: +minMem.value, minCpu: +minCpu.value, minDisk: +minDisk.value },
        shop: {
          memory: { price: +shop.memory.price.value, amount: +shop.memory.amount.value },
          cpu: { price: +shop.cpu.price.value, amount: +shop.cpu.amount.value },
          disk: { price: +shop.disk.price.value, amount: +shop.disk.amount.value },
          servers: { price: +shop.servers.price.value, amount: +shop.servers.amount.value },
          backups: { price: +shop.backups.price.value, amount: +shop.backups.amount.value },
          databases: { price: +shop.databases.price.value, amount: +shop.databases.amount.value },
        },
        afk: { enabled: afkOn.checked, coins: +afkCoins.value, intervalSeconds: +afkInterval.value },
        security: { force2faAdmins: force2fa.checked, singleIp: singleIp.checked, antiVpn: antiVpn.checked, blockHosting: blockDc.checked, ipApiKey: ipApiKey.value },
        dailyReward: { enabled: drOn.checked, coins: +drCoins.value, streakBonus: +drStreak.value, maxBonus: +drMax.value },
        maintenance: { enabled: mtOn.checked, title: mtTitle.value, message: mtMsg.value, allowAdmins: true, scheduleEnabled: mtSched.checked, start: mtStart.value ? new Date(mtStart.value).toISOString() : '', end: mtEnd.value ? new Date(mtEnd.value).toISOString() : '' },
        banner: { enabled: bnOn.checked, text: bnText.value, style: bnStyle.value },
        seasonal: { mode: seasonalSel.value },
        bragCards: { enabled: bcOn.checked },
        statusOverview: { enabled: soOn.checked, title: soTitle.value },
      };
      try { await CP.api.adminUpdateSettings(patch); CP.app.economyEnabled = patch.economy.enabled; CP.app.afkEnabled = patch.economy.enabled && patch.afk.enabled; if (CP.appearance && CP.appearance.reloadGlobal) CP.appearance.reloadGlobal(); if (CP.appearance && CP.appearance.load) CP.appearance.load(); CP.ui.toast('Settings saved', 'ok'); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };

    root.append(
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } },
        h('div', { class: 'card' },
          h('h3', { html: `${icon('shield', 16)} Access` }),
          h('div', { style: { marginTop: '8px' } },
            switchRow('Allow sign-ups', 'Show "Create account" on the login page.', regEnabled),
            switchRow('Require approval', 'New sign-ups must be approved before they can create servers.', regApproval),
            switchRow('Economy & shop', 'Enable coins and the resource shop.', econEnabled),
            switchRow('Recommend admin 2FA', 'Show a security reminder to admins without two-factor enabled.', force2fa))),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('shield', 16)} IP security` }),
          h('div', { style: { marginTop: '8px' } },
            switchRow('Lock to one IP', 'Bind each account to the first IP it signs in from (admins exempt).', singleIp),
            switchRow('Block VPNs & proxies', 'Reject sign-in/sign-up from VPN/proxy IPs (via ip-api.com).', antiVpn),
            switchRow('Also block datacenters', 'Treat hosting/datacenter IPs as VPNs too.', blockDc)),
          field('ip-api.com Pro key (optional, enables HTTPS)', ipApiKey),
          h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '6px' } }, 'Needs the real client IP — set CP_TRUST_PROXY if behind a proxy/tunnel.')),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('zap', 16)} New-user defaults` }),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Starting coins', dCoins), field('Server slots', dServers),
            field('RAM (MB)', dMem), field('CPU (%)', dCpu), field('Disk (MB)', dDisk), field('Backups', dBackups), field('Databases', dDatabases))),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('sliders', 16)} Minimum per server` }),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Min RAM (MB)', minMem), field('Min CPU (%)', minCpu), field('Min Disk (MB)', minDisk))),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('coin', 16)} AFK rewards` }),
          h('div', { style: { marginTop: '8px' } }, switchRow('Enable AFK page', 'Earn coins by staying on the AFK page.', afkOn)),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Coins per tick', afkCoins), field('Interval (seconds)', afkInterval)))),
      h('div', { class: 'card', style: { marginTop: '18px' } },
        h('h3', { html: `${icon('cart', 16)} Shop prices & amounts` }),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 14px' } }, 'Each purchase costs the price (coins) and grants the amount to the buyer\'s quota.'),
        h('div', { style: { display: 'grid', gap: '8px' } },
          shopRow('RAM', 'MB', shop.memory), shopRow('CPU', '%', shop.cpu),
          shopRow('Disk', 'MB', shop.disk), shopRow('Server Slot', 'slots', shop.servers),
          shopRow('Backup Slot', 'slots', shop.backups), shopRow('Database Slot', 'slots', shop.databases))),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', marginTop: '18px' } },
        h('div', { class: 'card' },
          h('h3', { html: `${icon('coin', 16)} Daily reward` }),
          h('div', { style: { marginTop: '8px' } }, switchRow('Enable daily reward', 'Members claim coins once per day (needs economy on).', drOn)),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Coins / day', drCoins), field('Streak bonus', drStreak), field('Max bonus', drMax))),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('alert', 16)} Maintenance & banner` }),
          h('div', { style: { marginTop: '8px' } }, switchRow('Maintenance mode', 'Lock non-admins out with a notice (admins keep access).', mtOn)),
          field('Maintenance title', mtTitle),
          field('Maintenance message', mtMsg),
          switchRow('Schedule a window', 'Auto-enable maintenance during the window below.', mtSched),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 12px' } }, field('Start', mtStart), field('End', mtEnd)),
          h('div', { style: { height: '1px', background: 'var(--border)', margin: '14px 0' } }),
          switchRow('Broadcast banner', 'Show a banner across the panel + login.', bnOn),
          h('div', { class: 'grid', style: { gridTemplateColumns: '2fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Banner text', bnText), field('Style', bnStyle)),
          h('div', { style: { height: '1px', background: 'var(--border)', margin: '14px 0' } }),
          field('Seasonal theme', seasonalSel),
          h('div', { style: { height: '1px', background: 'var(--border)', margin: '14px 0' } }),
          switchRow('Brag cards', 'Members can export a PNG of a server’s stats.', bcOn),
          switchRow('Network status page', 'Public /status overview of all servers.', soOn),
          field('Status page title', soTitle))),
      h('div', { style: { marginTop: '18px' } }, save)
    );
  }

  /* ---------------- Billing & plans ---------------- */
  async function billingTab(root) {
    loading(root);
    let d;
    try { d = (await CP.api.adminBilling()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);
    const c = d.config;
    const reload = () => billingTab(CP.clear(root));

    const sw = (v) => { const i = h('input', { type: 'checkbox', class: 'switch' }); i.checked = !!v; return i; };
    const field = (l, i, hint) => h('label', { class: 'field' }, h('span', {}, l), i, hint ? h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '2px' } }, hint) : null);
    const sel = (v, opts) => { const s = h('select', {}, ...opts.map((o) => h('option', { value: o[0] }, o[1]))); s.value = v; return s; };
    const num = (v) => h('input', { type: 'number', value: v == null ? '' : v });
    const txt = (v, ph) => h('input', { value: v || '', placeholder: ph || '' });
    const switchRow = (l, desc, i) => h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, l), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, desc)), h('div', { style: { marginLeft: 'auto' } }, i));

    const modeSel = sel(c.mode, [['free', 'Free (no billing)'], ['paid', 'Paid only'], ['trial', 'Paid + free trial']]);
    const currency = txt(c.currency, 'usd');
    const trialDays = num(c.trialDays);
    const cancelSel = sel(c.cancelBehavior, [['revert', 'Revert quota to defaults'], ['keep', 'Keep current quota']]);
    const stripeOn = sw(c.stripe.enabled);
    const pubKey = txt(c.stripe.publishableKey, 'pk_live_…');
    const secKey = txt('', c.stripe.secretKeySet ? '•••••••• set — leave blank to keep' : 'sk_live_…');
    const whSec = txt('', c.stripe.webhookSecretSet ? '•••••••• set — leave blank to keep' : 'whsec_…');
    const saveCfg = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save billing settings` });
    saveCfg.onclick = async () => {
      try {
        await CP.api.adminUpdateBilling({ mode: modeSel.value, currency: currency.value, trialDays: +trialDays.value, cancelBehavior: cancelSel.value,
          stripe: { enabled: stripeOn.checked, publishableKey: pubKey.value, secretKey: secKey.value, webhookSecret: whSec.value } });
        if (CP.app.billing) CP.app.billing.mode = modeSel.value;
        CP.ui.toast('Billing settings saved', 'ok'); reload();
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };

    root.appendChild(h('div', { class: 'card' },
      h('h3', { html: `${icon('cart', 16)} Monetization` }),
      h('div', { style: { marginTop: '8px' } }, field('Mode', modeSel, 'Free = no billing · Paid = must buy a plan · Trial = paid with a free trial first')),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' } }, field('Currency', currency), field('Free trial (days)', trialDays), field('On cancel', cancelSel)),
      h('div', { style: { height: '1px', background: 'var(--border)', margin: '14px 0' } }),
      h('h3', { html: `${icon('shield', 16)} Stripe — real payments` }),
      h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 10px' } }, 'Keys live at dashboard.stripe.com → Developers → API keys. For renewals/cancellations, add a webhook pointing at /api/billing/webhook and paste its signing secret. Free plans work without Stripe.'),
      switchRow('Enable Stripe payments', 'Required to charge real money for paid plans.', stripeOn),
      field('Publishable key', pubKey),
      field('Secret key', secKey),
      field('Webhook signing secret', whSec),
      h('div', { style: { marginTop: '14px' } }, saveCfg)));

    root.appendChild(h('div', { class: 'fm-bar', style: { marginTop: '20px' } },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Plans'),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} New plan`, onclick: () => planModal(null, c, reload) })));
    if (!d.plans.length) { root.appendChild(CP.empty('cart', 'No plans yet — create one above.')); return; }
    const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' } });
    d.plans.forEach((p) => grid.appendChild(h('div', { class: 'card' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('b', { style: { flex: 1 } }, p.name + (p.active === false ? ' (hidden)' : '')),
        h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => planModal(p, c, reload) }),
        h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delPlan(p, reload) })),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } }, (p.price ? ((p.price / 100).toFixed(2) + ' ' + (c.currency || 'usd').toUpperCase()) : 'Free') + ' · ' + p.interval + (p.featured ? ' · ★' : '')),
      h('div', { class: 'faint', style: { fontSize: '11.5px', marginTop: '4px' } }, `RAM ${p.resources.memory} · CPU ${p.resources.cpu}% · ${p.resources.servers} servers`))));
    root.appendChild(grid);
  }
  async function delPlan(p, done) {
    if (!(await CP.ui.confirm({ title: 'Delete plan', message: `Delete '${p.name}'? Members already on it keep their resources.`, confirmText: 'Delete' }))) return;
    try { await CP.api.adminDeletePlan(p.id); CP.ui.toast('Deleted', 'ok'); done(); } catch (e) { CP.ui.toast(e.message, 'err'); }
  }
  function planModal(plan, c, done) {
    const name = h('input', { value: plan ? plan.name : '', placeholder: 'Pro' });
    const desc = h('input', { value: plan ? (plan.description || '') : '', placeholder: 'Great for growing communities' });
    const price = h('input', { type: 'number', step: '0.01', min: '0', value: plan ? (plan.price / 100) : 0 });
    const interval = (() => { const s = h('select', {}, ...[['month', 'Monthly'], ['year', 'Yearly'], ['one_time', 'One-time']].map((o) => h('option', { value: o[0] }, o[1]))); s.value = plan ? plan.interval : 'month'; return s; })();
    const R = (k) => h('input', { type: 'number', min: '0', value: plan ? (plan.resources[k] || 0) : 0 });
    const mem = R('memory'), cpu = R('cpu'), disk = R('disk'), servers = R('servers'), backups = R('backups'), databases = R('databases');
    const feats = h('textarea', { rows: '3', style: { width: '100%', resize: 'vertical' } }); feats.value = plan ? (plan.features || []).join('\n') : '';
    const featured = (() => { const i = h('input', { type: 'checkbox', class: 'switch' }); if (plan && plan.featured) i.checked = true; return i; })();
    const active = (() => { const i = h('input', { type: 'checkbox', class: 'switch' }); if (!plan || plan.active !== false) i.checked = true; return i; })();
    const field = (l, i) => h('label', { class: 'field' }, h('span', {}, l), i);
    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} ${plan ? 'Save plan' : 'Create plan'}` });
    const ref = CP.ui.modal({
      title: plan ? `Edit · ${plan.name}` : 'New plan', size: 'lg',
      body: h('div', {},
        h('div', { class: 'grid', style: { gridTemplateColumns: '2fr 1fr', gap: '0 12px' } }, field('Name', name), field(`Price (${(c.currency || 'usd').toUpperCase()})`, price)),
        field('Description', desc),
        field('Billing interval', interval),
        h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Resource grant (quota)'),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3,1fr)', gap: '0 12px' } }, field('RAM (MB)', mem), field('CPU (%)', cpu), field('Disk (MB)', disk), field('Servers', servers), field('Backups', backups), field('Databases', databases)),
        field('Features (one per line)', feats),
        h('div', { style: { display: 'flex', gap: '22px', marginTop: '12px' } },
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, featured, h('span', {}, 'Featured / popular')),
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, active, h('span', {}, 'Active (visible to users)')))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'), save],
    });
    save.onclick = async () => {
      const body = {
        name: name.value, description: desc.value, price: Math.round(parseFloat(price.value || '0') * 100), interval: interval.value,
        resources: { memory: +mem.value, cpu: +cpu.value, disk: +disk.value, servers: +servers.value, backups: +backups.value, databases: +databases.value },
        features: feats.value.split('\n').map((s) => s.trim()).filter(Boolean), featured: featured.checked, active: active.checked,
      };
      try { if (plan) await CP.api.adminUpdatePlan(plan.id, body); else await CP.api.adminCreatePlan(body); CP.ui.toast(plan ? 'Plan saved' : 'Plan created', 'ok'); ref.close(); done(); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };
  }

  /* ---------------- Analytics ---------------- */
  async function analyticsTab(root) {
    loading(root);
    let d;
    try { d = (await CP.api.adminAnalytics()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);
    const t = d.totals;
    const tile = (ic, label, val, sub) => h('div', { class: 'card tile res-tile' },
      h('div', { class: 'k', html: `${icon(ic, 15)} ${label}` }),
      h('div', { class: 'v' }, String(val)),
      sub ? h('div', { class: 'faint', style: { fontSize: '11.5px' } }, sub) : null);

    root.appendChild(h('div', { class: 'grid stat-grid', style: { marginBottom: '18px' } },
      tile('users', 'Users', t.users, `${t.usersActive} active · ${t.usersPending} pending`),
      tile('server', 'Servers', t.servers, `${t.serversRunning} running`),
      tile('cpu', 'Nodes', t.nodes, `${t.allocationsUsed}/${t.allocationsTotal} allocations`),
      tile('coin', 'Coins', t.coins.toLocaleString(), 'in circulation'),
      tile('zap', 'XP awarded', t.xpAwarded.toLocaleString(), `${t.petsOwned} pets owned`),
      tile('shield', 'Admins', t.admins, '')));

    const max = Math.max(1, ...d.signups.map((s) => s.count));
    const bars = h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '120px', marginTop: '12px' } });
    d.signups.forEach((s) => bars.appendChild(h('div', { title: `${s.date}: ${s.count}`, style: { flex: 1, minHeight: '2px', height: `${Math.round((s.count / max) * 100)}%`, background: 'var(--accent-grad)', borderRadius: '4px 4px 0 0' } })));
    root.appendChild(h('div', { class: 'card' },
      h('h3', { html: `${icon('activity', 16)} Signups (last 14 days)` }),
      bars,
      h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '6px' } }, `${d.signups.reduce((a, b) => a + b.count, 0)} new accounts in 14 days`)));

    const flow = d.economyFlow || [];
    if (flow.length) {
      const fmax = Math.max(1, ...flow.map((x) => Math.max(x.earned, x.spent)));
      const fbars = h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '120px', marginTop: '12px' } });
      flow.forEach((x) => fbars.appendChild(h('div', { title: `${x.date}: +${x.earned} / -${x.spent}`, style: { flex: 1, display: 'flex', gap: '2px', alignItems: 'flex-end', height: '100%' } },
        h('div', { style: { flex: 1, height: `${Math.round((x.earned / fmax) * 100)}%`, minHeight: '2px', background: 'var(--green, #4ade80)', borderRadius: '3px 3px 0 0' } }),
        h('div', { style: { flex: 1, height: `${Math.round((x.spent / fmax) * 100)}%`, minHeight: '2px', background: 'var(--red, #f87171)', borderRadius: '3px 3px 0 0' } }))));
      root.appendChild(h('div', { class: 'card', style: { marginTop: '18px' } },
        h('h3', { html: `${icon('coin', 16)} Economy flow (14 days)` }),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, '🟢 earned · 🔴 spent'),
        fbars,
        h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '6px' } }, `Earned ${flow.reduce((a, b) => a + b.earned, 0).toLocaleString()} · Spent ${flow.reduce((a, b) => a + b.spent, 0).toLocaleString()} coins`)));
    }

    const eggMax = Math.max(1, ...d.serversByEgg.map((x) => x.count));
    const eggList = h('div', { style: { marginTop: '10px' } });
    d.serversByEgg.forEach((e) => eggList.appendChild(CP.bar(`${e.name} · ${e.count}`, e.count, eggMax, 'cpu')));
    const balList = h('div', { style: { marginTop: '6px' } });
    d.topBalances.forEach((b) => balList.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' } }, h('b', {}, b.username), h('span', { class: 'mono' }, b.coins.toLocaleString()))));
    root.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', marginTop: '18px' } },
      h('div', { class: 'card' }, h('h3', { html: `${icon('box', 16)} Servers by type` }), d.serversByEgg.length ? eggList : h('div', { class: 'muted', style: { fontSize: '13px' } }, 'No servers yet.')),
      h('div', { class: 'card' }, h('h3', { html: `${icon('coin', 16)} Top balances` }), d.topBalances.length ? balList : h('div', { class: 'muted', style: { fontSize: '13px' } }, '—'))));
  }

  /* ---------------- Achievements & Pets ---------------- */
  async function achievementsTab(root) {
    loading(root);
    let s, data;
    try { s = (await CP.api.adminSettings()).data; data = (await CP.api.adminAchievements()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);

    const sw = (c) => { const i = h('input', { type: 'checkbox', class: 'switch' }); i.checked = !!c; return i; };
    const switchRow = (label, desc, input) => h('div', { class: 'switch-row' },
      h('div', {}, h('b', {}, label), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, desc)),
      h('div', { style: { marginLeft: 'auto' } }, input));
    const field = (l, i) => h('label', { class: 'field' }, h('span', {}, l), i);

    const achOn = sw(s.achievements && s.achievements.enabled);
    const petsOn = sw(s.pets && s.pets.enabled);
    const saveToggles = async () => {
      try {
        await CP.api.adminUpdateSettings({ achievements: { enabled: achOn.checked }, pets: { enabled: petsOn.checked } });
        CP.app.achievementsEnabled = achOn.checked;
        CP.app.petsEnabled = CP.app.economyEnabled && petsOn.checked;
        CP.ui.toast('Saved', 'ok');
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };
    achOn.onchange = saveToggles; petsOn.onchange = saveToggles;

    root.appendChild(h('div', { class: 'card' },
      h('h3', { html: `${icon('zap', 16)} Features` }),
      h('div', { style: { marginTop: '8px' } },
        switchRow('Achievements & XP', 'Show the Achievements tab and award XP / badges.', achOn),
        switchRow('Server pets', 'Let members buy & equip coin-bought pets (needs the economy on).', petsOn))));

    const bgrid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', marginTop: '10px' } });
    data.builtin.forEach((a) => bgrid.appendChild(h('div', { class: 'card tile', style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
      h('div', { style: { fontSize: '22px' } }, a.icon),
      h('div', {}, h('b', {}, a.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${a.desc} · ${a.xp} XP`)))));
    root.appendChild(h('div', { class: 'card', style: { marginTop: '18px' } }, h('h3', { html: `${icon('shield', 16)} Built-in achievements` }), bgrid));

    const list = h('div', { style: { margin: '10px 0' } });
    const reload = () => achievementsTab(CP.clear(root));
    const renderList = (items) => {
      CP.clear(list);
      if (!items.length) { list.appendChild(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'No custom achievements yet.')); return; }
      items.forEach((a) => list.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' } },
        h('div', { style: { fontSize: '20px' } }, a.icon),
        h('div', { style: { flex: 1 } }, h('b', {}, a.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${a.desc || ''} · ${a.xp} XP · unlock when ${a.condition.stat} ≥ ${a.condition.value}`)),
        h('button', { class: 'btn sm red', html: icon('trash', 13), onclick: async () => { try { await CP.api.adminDeleteAchievement(a.id); CP.ui.toast('Deleted', 'ok'); reload(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }))));
    };
    renderList(data.custom);

    const fId = h('input', { placeholder: 'unique_id' }), fName = h('input', { placeholder: 'Name' }), fIcon = h('input', { placeholder: '🏅', maxlength: '4' });
    const fXp = h('input', { type: 'number', value: '100', min: '0' }), fVal = h('input', { type: 'number', value: '1', min: '1' }), fDesc = h('input', { placeholder: 'How to earn it' });
    const fStat = h('select', {}, ...data.allowedStats.map((st) => h('option', { value: st }, st)));
    const addBtn = h('button', { class: 'btn primary', html: `${icon('plus', 14)} Add achievement` });
    addBtn.onclick = async () => {
      try {
        await CP.api.adminAddAchievement({ id: fId.value, name: fName.value, desc: fDesc.value, icon: fIcon.value || '🏅', xp: +fXp.value, stat: fStat.value, value: +fVal.value });
        CP.ui.toast('Achievement added', 'ok'); reload();
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };
    root.appendChild(h('div', { class: 'card', style: { marginTop: '18px' } },
      h('h3', { html: `${icon('plus', 16)} Custom achievements` }),
      h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 6px' } }, 'Unlock automatically when a member’s stat reaches your threshold.'),
      list,
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: '0 12px' } },
        field('ID', fId), field('Name', fName), field('Icon', fIcon), field('XP', fXp), field('Unlock stat', fStat), field('≥ value', fVal), field('Description', fDesc)),
      h('div', { style: { marginTop: '12px' } }, addBtn)));
  }

  /* ---------------- Nodes ---------------- */
  async function nodes(root) {
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Create Node`, onclick: () => createNode(() => nodes(CP.clear(root))) })));
    const wrap = tableCard(CP.spinner());
    root.appendChild(wrap);
    try {
      const list = (await CP.api.get('/admin/nodes')).data;
      CP.clear(wrap);
      const pill = (n) => {
        const color = n.status === 'local' ? '#6ea8fe' : n.status === 'online' ? '#36d399' : (n.status === 'offline' ? '#f87272' : '#9aa');
        const seen = (n.status !== 'local' && n.lastSeen) ? ' · ' + new Date(n.lastSeen).toLocaleTimeString() : '';
        return h('span', { class: 'mono', style: { fontSize: '12px', color }, title: n.daemonUrl || '' }, '● ' + (n.status || 'unknown') + seen);
      };
      const tbody = h('tbody');
      list.forEach((n) => {
        const actions = [];
        if (n.status !== 'local') actions.push(h('button', { class: 'btn sm ghost icon', title: 'Setup / rotate daemon token', html: icon('refresh', 14), onclick: () => reconfigureNode(n) }));
        actions.push(h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delNode(n, () => nodes(CP.clear(root))) }));
        tbody.appendChild(h('tr', {},
          h('td', {}, h('b', {}, n.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, n.description || '')),
          h('td', {}, pill(n)),
          h('td', { class: 'mono muted' }, `${n.fqdn}:${n.daemonPort}`),
          h('td', { class: 'muted nowrap' }, fmt.mib(n.memory)),
          h('td', { class: 'muted' }, `${n.serverCount} srv · ${n.allocationsUsed}/${n.allocationCount}`),
          h('td', {}, h('div', { class: 'row-actions' }, ...actions))));
      });
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Node'), h('th', {}, 'Status'), h('th', {}, 'Daemon'), h('th', {}, 'Memory'), h('th', {}, 'Usage'), h('th', { class: 'right' }, ''))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  async function createNode(done) {
    const locs = (await CP.api.get('/admin/locations')).data;
    const name = h('input', { placeholder: 'Comet-03' });
    const desc = h('input', {});
    const loc = h('select', {}, ...locs.map((l) => h('option', { value: l.id }, l.long || l.short)));
    const fqdn = h('input', { value: location.hostname });
    const dport = h('input', { type: 'number', value: '8080' });
    const mem = h('input', { type: 'number', value: '16384' });
    const disk = h('input', { type: 'number', value: '102400' });
    const cpu = h('input', { type: 'number', value: '800' });
    const ref = CP.ui.modal({ title: 'Create Node', size: 'lg', body: h('div', {},
      h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 12px' } }, 'A node is a machine that runs servers. Leave FQDN as this host for the local node, or point it at another VPS — you\'ll get a one-line command to install the daemon there.'),
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        h('label', { class: 'field' }, h('span', {}, 'Location'), loc),
        h('label', { class: 'field' }, h('span', {}, 'FQDN / IP'), fqdn),
        h('label', { class: 'field' }, h('span', {}, 'Daemon port'), dport),
        h('label', { class: 'field' }, h('span', {}, 'Memory (MB)'), mem),
        h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk),
        h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const res = await CP.api.post('/admin/nodes', { name: name.value, description: desc.value, locationId: loc.value, fqdn: fqdn.value, daemonPort: +dport.value, memory: +mem.value, disk: +disk.value, cpu: +cpu.value });
            CP.ui.toast('Node created', 'ok'); ref.close(); done();
            showInstallModal(res); // one-time token + install command
          } catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Create')] });
  }
  // Show the (one-time) daemon install command + token for a node.
  function showInstallModal(data) {
    const cmd = data.installCommand || '';
    const ta = h('textarea', { readonly: true, rows: '4', style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' } }, cmd);
    const ref = CP.ui.modal({ title: 'Install the daemon on this node', size: 'lg', body: h('div', {},
      h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Run this on the node VPS (Docker required). The token is shown ONCE — copy it now. The panel URL must be reachable from the node, and you must open the daemon + game ports in your cloud provider\'s security group.'),
      ta,
      h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } }, 'Node token: ', h('code', {}, data.daemonToken || ''))),
      footer: [
        h('button', { class: 'btn primary', onclick: () => { try { navigator.clipboard.writeText(cmd); CP.ui.toast('Command copied', 'ok'); } catch { ta.select(); } } }, 'Copy command'),
        h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Done')] });
  }
  // Rotate a node's token and re-show the install command (re-runs the daemon).
  async function reconfigureNode(n) {
    if (!(await CP.ui.confirm({ title: 'Rotate daemon token', message: `Generate a new token for ${n.name}? The node's daemon must be re-run with the new command.`, confirmText: 'Rotate' }))) return;
    try { showInstallModal(await CP.api.post(`/admin/nodes/${n.id}/rotate-token`, {})); }
    catch (err) { CP.ui.toast(err.message, 'err'); }
  }
  async function delNode(n, done) {
    if (!(await CP.ui.confirm({ title: 'Delete node', message: `Delete ${n.name}?`, confirmText: 'Delete' }))) return;
    try { await CP.api.del(`/admin/nodes/${n.id}`); CP.ui.toast('Deleted', 'ok'); done(); } catch (err) { CP.ui.toast(err.message, 'err'); }
  }

  /* ---------------- Locations ---------------- */
  async function locations(root) {
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Create Location`, onclick: async () => {
        const short = await CP.ui.prompt({ title: 'New location', label: 'Short code', placeholder: 'us-west' });
        if (!short) return;
        try { await CP.api.post('/admin/locations', { short, long: short }); CP.ui.toast('Created', 'ok'); locations(CP.clear(root)); } catch (err) { CP.ui.toast(err.message, 'err'); }
      } })));
    const wrap = tableCard(CP.spinner());
    root.appendChild(wrap);
    try {
      const list = (await CP.api.get('/admin/locations')).data;
      CP.clear(wrap);
      const tbody = h('tbody');
      list.forEach((l) => tbody.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'badge soft' }, l.short)),
        h('td', {}, l.long || '—'),
        h('td', {}, h('div', { class: 'row-actions' }, h('button', { class: 'btn sm ghost icon', html: icon('trash', 14), onclick: async () => {
          try { await CP.api.del(`/admin/locations/${l.id}`); CP.ui.toast('Deleted', 'ok'); locations(CP.clear(root)); } catch (err) { CP.ui.toast(err.message, 'err'); }
        } })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Description'), h('th', { class: 'right' }, ''))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }

  /* ---------------- Allocations ---------------- */
  async function allocations(root) {
    const nodeList = (await CP.api.get('/admin/nodes')).data;
    if (!nodeList.length) { root.appendChild(CP.empty('cpu', 'Create a node first.')); return; }
    const select = h('select', { style: { maxWidth: '260px' } }, ...nodeList.map((n) => h('option', { value: n.id }, n.name)));
    const addBtn = h('button', { class: 'btn primary', html: `${icon('plus', 14)} Add Ports`, onclick: () => addAlloc(select.value, () => load()) });
    root.appendChild(h('div', { class: 'fm-bar' }, h('span', { class: 'muted' }, 'Node:'), select, h('div', { style: { flex: 1 } }), addBtn));
    const wrap = tableCard();
    root.appendChild(wrap);
    select.addEventListener('change', load);
    async function load() {
      CP.clear(wrap); wrap.appendChild(CP.spinner());
      try {
        const list = (await CP.api.get(`/admin/nodes/${select.value}/allocations`)).data;
        CP.clear(wrap);
        if (!list.length) { wrap.appendChild(CP.empty('network', 'No allocations on this node.')); return; }
        const tbody = h('tbody');
        list.sort((a, b) => a.port - b.port).forEach((a) => tbody.appendChild(h('tr', {},
          h('td', { class: 'mono' }, a.ip), h('td', { class: 'mono' }, String(a.port)),
          h('td', {}, a.serverId ? h('span', { class: 'badge primary' }, 'Assigned') : h('span', { class: 'badge soft' }, 'Free')),
          h('td', {}, h('div', { class: 'row-actions' }, !a.serverId ? h('button', { class: 'btn sm ghost icon', html: icon('trash', 14), onclick: async () => {
            try { await CP.api.del(`/admin/allocations/${a.id}`); load(); } catch (err) { CP.ui.toast(err.message, 'err'); }
          } }) : h('span', { class: 'faint', style: { fontSize: '12px' } }, 'in use')))
        )));
        wrap.appendChild(h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'IP'), h('th', {}, 'Port'), h('th', {}, 'Status'), h('th', { class: 'right' }, ''))), tbody));
      } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
    }
    load();
  }
  function addAlloc(nodeId, done) {
    const ip = h('input', { value: location.hostname });
    const ports = h('input', { placeholder: '25565,25570-25580' });
    const ref = CP.ui.modal({ title: 'Add Allocations', body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'IP / FQDN'), ip),
      h('label', { class: 'field' }, h('span', {}, 'Ports (comma + ranges)'), ports)),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          try { const res = await CP.api.post(`/admin/nodes/${nodeId}/allocations`, { ip: ip.value, ports: ports.value }); CP.ui.toast(`Added ${res.data.length} allocations`, 'ok'); ref.close(); done(); }
          catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Add')] });
  }

  /* ---------------- Eggs ---------------- */
  async function eggs(root) {
    const reload = () => eggs(CP.clear(root));
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Create egg`, onclick: () => eggModal(null, reload) })));
    const wrap = h('div', {}, CP.spinner());
    root.appendChild(wrap);
    try {
      const list = (await CP.api.get('/admin/eggs')).data;
      CP.clear(wrap);
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } });
      list.forEach((e) => grid.appendChild(h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('div', { class: 'glyph', style: { width: '40px', height: '40px' }, html: icon('box', 20) }),
          h('div', { style: { flex: 1 } }, h('b', {}, e.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, e.category + (e.custom ? ' · custom' : ''))),
          h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => eggModal(e, reload) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delEgg(e, reload) })),
        h('p', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.6' } }, e.description),
        h('div', { class: 'chip', html: `${icon('box', 13)} ${CP.esc(e.docker)}` }),
        h('div', { class: 'mono faint', style: { fontSize: '11px', marginTop: '10px', wordBreak: 'break-all' } }, e.startup)
      )));
      wrap.appendChild(grid);
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  async function delEgg(e, done) {
    if (!(await CP.ui.confirm({ title: 'Delete egg', message: `Delete '${e.name}'? (Built-in eggs may reappear on restart.)`, confirmText: 'Delete' }))) return;
    try { await CP.api.adminDeleteEgg(e.id); CP.ui.toast('Deleted', 'ok'); done(); } catch (err) { CP.ui.toast(err.message, 'err'); }
  }
  function eggModal(egg, done) {
    const name = h('input', { value: egg ? egg.name : '', placeholder: 'My Custom Server' });
    const category = h('input', { value: egg ? egg.category : 'Custom', placeholder: 'Custom' });
    const docker = h('input', { value: egg ? egg.docker : 'node:lts', placeholder: 'node:lts' });
    const stopCommand = h('input', { value: egg ? egg.stopCommand : 'stop', placeholder: 'stop' });
    const startup = h('input', { value: egg ? egg.startup : '', placeholder: 'java -jar {{JARFILE}}' });
    const description = h('textarea', { rows: '2', style: { width: '100%', resize: 'vertical' } }); description.value = egg ? (egg.description || '') : '';
    const varsWrap = h('div', {});
    const addVarRow = (v) => {
      const vn = h('input', { value: v ? v.name : '', placeholder: 'Label' });
      const ve = h('input', { value: v ? v.env : '', placeholder: 'ENV_VAR' });
      const vd = h('input', { value: v ? v.default : '', placeholder: 'default' });
      const ue = h('input', { type: 'checkbox' }); if (!v || v.userEditable) ue.checked = true;
      const row = h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: '0 8px', alignItems: 'center', marginBottom: '6px' } },
        vn, ve, vd, h('label', { class: 'muted', style: { fontSize: '11px', display: 'flex', gap: '4px', alignItems: 'center' } }, ue, 'edit'),
        h('button', { class: 'btn sm ghost icon', html: icon('trash', 13), onclick: () => row.remove() }));
      row._get = () => ({ name: vn.value, env: ve.value, default: vd.value, userEditable: ue.checked });
      varsWrap.appendChild(row);
    };
    ((egg && egg.variables) || []).forEach(addVarRow);

    const field = (l, i, hint) => h('label', { class: 'field' }, h('span', {}, l), i, hint ? h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '2px' } }, hint) : null);
    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} ${egg ? 'Save egg' : 'Create egg'}` });
    const ref = CP.ui.modal({
      title: egg ? `Edit egg · ${egg.name}` : 'Create egg', size: 'lg',
      body: h('div', {},
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 14px' } }, field('Name', name), field('Category', category), field('Docker image', docker), field('Stop command', stopCommand)),
        field('Startup command', startup, 'Use {{VARIABLE}} placeholders. Tokens run without a shell (passed as args).'),
        field('Description', description),
        h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Variables'),
        varsWrap,
        h('button', { class: 'btn sm ghost', html: `${icon('plus', 13)} Add variable`, onclick: () => addVarRow(null) }),
        egg && egg.installer && egg.installer !== 'none'
          ? h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } }, `Uses the built-in “${egg.installer}” auto-installer — edits keep it.`)
          : h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } }, 'Custom eggs are manual-install — members upload files via the file manager / SFTP.')),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'), save],
    });
    save.onclick = async () => {
      const variables = [...varsWrap.children].map((r) => r._get()).filter((v) => v.env);
      const body = { name: name.value, category: category.value, docker: docker.value, stopCommand: stopCommand.value, startup: startup.value, description: description.value, variables };
      try {
        if (egg) await CP.api.adminUpdateEgg(egg.id, body); else await CP.api.adminCreateEgg(body);
        CP.ui.toast(egg ? 'Egg saved' : 'Egg created', 'ok'); ref.close(); done();
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };
  }

  /* ---------------- Database hosts ---------------- */
  async function databasesTab(root) {
    const reload = () => databasesTab(CP.clear(root));
    root.appendChild(h('div', { class: 'fm-bar' }, h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', html: `${icon('plus', 14)} Add Host`, onclick: () => hostModal(null, reload) })));
    const wrap = tableCard(CP.spinner());
    root.appendChild(wrap);
    try {
      const res = await CP.api.adminDatabaseHosts();
      const hosts = res.data || [];
      CP.clear(wrap);
      if (!res.driver) {
        root.insertBefore(h('div', { class: 'note', style: { marginBottom: '14px' },
          html: `${icon('alert', 15)} The <b>mysql2</b> driver isn't installed on the panel — run <span class="mono">npm install mysql2</span> to enable real provisioning.` }), wrap);
      }
      if (!hosts.length) { wrap.appendChild(CP.empty('drive', 'No database hosts yet — add a MySQL/MariaDB host so servers can create databases.')); return; }
      const tbody = h('tbody');
      hosts.forEach((hh) => tbody.appendChild(h('tr', {},
        h('td', {}, h('b', {}, CP.esc(hh.name))),
        h('td', { class: 'mono muted' }, `${hh.host}:${hh.port}`),
        h('td', { class: 'muted' }, hh.phpMyAdminUrl ? 'phpMyAdmin ✓' : '—'),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm ghost', html: `${icon('zap', 13)} Test`, onclick: () => testHost(hh.id) }),
          h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => hostModal(hh, reload) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delHost(hh, reload) })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Address'), h('th', {}, 'phpMyAdmin'), h('th', { class: 'right' }, 'Actions'))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  async function testHost(id) {
    CP.ui.toast('Testing connection…', 'info');
    try { const r = await CP.api.adminTestDatabaseHost(id); CP.ui.toast(`Connected — server ${r.data.version || 'OK'}`, 'ok'); }
    catch (e) { CP.ui.toast(e.message, 'err'); }
  }
  function hostModal(hh, done) {
    const name = h('input', { value: hh ? hh.name : '', placeholder: 'Primary DB' });
    const host = h('input', { value: hh ? hh.host : '127.0.0.1', placeholder: '127.0.0.1' });
    const port = h('input', { type: 'number', value: hh ? hh.port : 3306 });
    const username = h('input', { value: hh ? hh.username : 'root', placeholder: 'root' });
    const password = h('input', { type: 'password', placeholder: hh ? 'Leave blank to keep' : 'admin password' });
    const pma = h('input', { value: hh ? hh.phpMyAdminUrl : '', placeholder: 'https://pma.example.com (optional)' });
    const ref = CP.ui.modal({
      title: hh ? `Edit ${hh.name}` : 'Add database host', size: 'lg',
      body: h('div', {},
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
          h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
          h('label', { class: 'field' }, h('span', {}, 'Host / IP'), host),
          h('label', { class: 'field' }, h('span', {}, 'Port'), port),
          h('label', { class: 'field' }, h('span', {}, 'Admin username'), username),
          h('label', { class: 'field' }, h('span', {}, 'Admin password'), password),
          h('label', { class: 'field' }, h('span', {}, 'phpMyAdmin URL'), pma))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          const body = { name: name.value, host: host.value, port: +port.value, username: username.value, password: password.value, phpMyAdminUrl: pma.value };
          try { if (hh) await CP.api.adminUpdateDatabaseHost(hh.id, body); else await CP.api.adminAddDatabaseHost(body); CP.ui.toast('Saved', 'ok'); ref.close(); done(); }
          catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Save')],
    });
  }
  async function delHost(hh, done) {
    if (!(await CP.ui.confirm({ title: 'Delete host', message: `Delete ${hh.name}?`, confirmText: 'Delete' }))) return;
    try { await CP.api.adminDeleteDatabaseHost(hh.id); CP.ui.toast('Deleted', 'ok'); done(); } catch (err) { CP.ui.toast(err.message, 'err'); }
  }

  /* ---------------- Login / Discord OAuth ---------------- */
  async function loginTab(root) {
    loading(root);
    let s;
    try { s = (await CP.api.adminSettings()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);
    const d = (s.oauth && s.oauth.discord) || {};
    const callback = `${location.origin}/api/auth/discord/callback`;
    const copyChip = (text) => h('span', { class: 'copy', html: `<span class="mono">${CP.esc(text)}</span> ${icon('copy', 13)}`, onclick: () => CP.copy(text) });

    const enabled = h('input', { type: 'checkbox', class: 'switch' }); enabled.checked = !!d.enabled;
    const createAcc = h('input', { type: 'checkbox', class: 'switch' }); createAcc.checked = d.createAccounts === undefined ? true : !!d.createAccounts;
    const clientId = h('input', { value: d.clientId || '', placeholder: 'e.g. 123456789012345678' });
    const clientSecret = h('input', { type: 'password', value: d.clientSecret || '', placeholder: 'Discord client secret', autocomplete: 'off' });
    const redirectUri = h('input', { value: d.redirectUri || callback, placeholder: callback });

    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save Discord login` });
    save.onclick = async () => {
      try {
        await CP.api.adminUpdateSettings({ oauth: { discord: {
          enabled: enabled.checked,
          clientId: clientId.value.trim(),
          clientSecret: clientSecret.value.trim(),
          redirectUri: redirectUri.value.trim(),
          createAccounts: createAcc.checked,
        } } });
        CP.ui.toast('Discord login saved', 'ok');
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };

    root.append(
      h('div', { class: 'note', style: { marginBottom: '18px' }, html: `${icon('info', 15)} Let people sign in with Discord. You supply your <b>own</b> Discord application — credentials stay on your panel.` }),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' } },
        h('div', { class: 'card' },
          h('h3', { html: `${icon('key', 16)} Discord login` }),
          h('div', { class: 'switch-row', style: { marginTop: '6px' } },
            h('div', {}, h('b', {}, 'Enable Discord login'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Adds a "Continue with Discord" button to the login page.')),
            h('div', { style: { marginLeft: 'auto' } }, enabled)),
          h('label', { class: 'field' }, h('span', {}, 'Client ID'), clientId),
          h('label', { class: 'field' }, h('span', {}, 'Client Secret'), clientSecret),
          h('label', { class: 'field' }, h('span', {}, 'Redirect URI'), redirectUri),
          h('div', { class: 'switch-row' },
            h('div', {}, h('b', {}, 'Allow new accounts via Discord'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Off = only existing/linked accounts can use it.')),
            h('div', { style: { marginLeft: 'auto' } }, createAcc)),
          h('div', { style: { marginTop: '16px' } }, save)),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('info', 16)} Setup` }),
          h('ol', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.8', paddingLeft: '18px', margin: '6px 0 0' } },
            h('li', { html: 'Open <b>discord.com/developers/applications</b> → <b>New Application</b>.' }),
            h('li', { html: '<b>OAuth2</b> → copy the <b>Client ID</b> + <b>Client Secret</b> into the fields.' }),
            h('li', {}, 'Under OAuth2 → Redirects, add exactly this URL:'),
            h('li', { style: { listStyle: 'none', margin: '6px 0' } }, copyChip(callback)),
            h('li', { html: 'Keep the same URL in <b>Redirect URI</b>, toggle on, and Save.' })))
      )
    );
  }

  /* ---------------- Appearance / Theming ---------------- */
  function toHex(v) {
    if (typeof v !== 'string') return '#666666';
    const s = v.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
    return '#666666';
  }

  async function appearanceTab(root) {
    // Edit/preview the GLOBAL theme without the admin's personal theme masking it.
    suspendPersonalTheme();
    loading(root);
    let payload;
    try { payload = (await CP.api.adminAppearance()).data; }
    catch (e) { CP.clear(root); return root.appendChild(CP.empty('alert', e.message)); }
    CP.clear(root);
    const hasPersonalTheme = !!(CP.app.user && CP.app.user.themePreset);

    const presets = payload.presets || [];
    const draft = payload.appearance || {};
    draft.colors = draft.colors || {};
    draft.background = draft.background || { type: 'preset', value: '', fit: 'cover', blur: 0, dim: 35, fixed: true };
    draft.effects = draft.effects || { animations: true, glass: true, radius: 16 };
    draft.brand = draft.brand || { name: '', tagline: '' };
    if (typeof draft.customCss !== 'string') draft.customCss = '';

    const presetById = Object.fromEntries(presets.map((p) => [p.id, p]));
    const palOf = (id) => (presetById[id] && presetById[id].palette) || {};
    const effColor = (key) => draft.colors[key] || palOf(draft.preset)[key] || '#000000';

    let timer;
    function schedulePreview() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { CP.appearance.preview(await CP.api.adminPreviewAppearance(draft), draft); }
        catch (e) { /* preview is best-effort */ }
      }, 140);
    }

    /* Preset gallery */
    const presetGrid = h('div', { class: 'theme-presets' });
    function renderPresets() {
      CP.clear(presetGrid);
      presets.forEach((p) => presetGrid.appendChild(h('div', {
        class: 'theme-preset' + (draft.preset === p.id ? ' active' : ''),
        onclick: () => { draft.preset = p.id; draft.colors = {}; renderPresets(); syncColors(); schedulePreview(); },
      },
        h('div', { class: 'tp-swatch', style: { background: p.bg } }, ...p.swatch.map((c) => h('i', { style: { background: c } }))),
        h('div', { class: 'tp-name' }, p.name + (p.light ? ' ☀' : '')),
        h('div', { class: 'tp-tag' }, p.tag))));
    }
    renderPresets();

    /* Colors */
    const colorKeys = [['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent'], ['bg', 'Background'], ['surface', 'Surface'], ['text', 'Text']];
    const colorInputs = {};
    function syncColors() { colorKeys.forEach(([k]) => { if (colorInputs[k]) colorInputs[k].value = toHex(effColor(k)); }); }
    const colorRows = colorKeys.map(([k, label]) => {
      const ci = h('input', { type: 'color', value: toHex(effColor(k)) });
      ci.addEventListener('input', () => { draft.colors[k] = ci.value; schedulePreview(); });
      colorInputs[k] = ci;
      return h('div', { class: 'color-row' }, ci, h('span', { class: 'cr-label' }, label),
        h('button', { class: 'btn sm ghost', title: 'Follow preset', onclick: () => { delete draft.colors[k]; ci.value = toHex(effColor(k)); schedulePreview(); } }, 'Reset'));
    });

    /* Background */
    const bgTypes = [['preset', 'Preset'], ['color', 'Solid color'], ['gradient', 'Gradient'], ['image', 'Image'], ['gif', 'GIF'], ['video', 'Video']];
    const bgType = h('select', {}, ...bgTypes.map(([v, l]) => h('option', { value: v, selected: draft.background.type === v }, l)));
    const bgControls = h('div', { class: 'bg-controls' });
    bgType.addEventListener('change', () => { draft.background.type = bgType.value; renderBg(); schedulePreview(); });

    const GRADIENTS = [
      'linear-gradient(135deg, #22d3ee, #6366f1, #a855f7)',
      'linear-gradient(135deg, #0ea5e9, #2dd4bf)',
      'linear-gradient(135deg, #f43f5e, #f59e0b)',
      'radial-gradient(80% 80% at 50% 0%, #6366f1, #070a12)',
      'conic-gradient(from 180deg at 50% 50%, #22d3ee, #a855f7, #22d3ee)',
    ];

    function slider(label, min, max, val, onInput) {
      const inp = h('input', { type: 'range', min, max, value: val });
      const out = h('b', { class: 'mono' }, String(val));
      inp.addEventListener('input', () => { out.textContent = inp.value; onInput(+inp.value); });
      return h('label', { class: 'field range-field' }, h('span', {}, label, ' ', out), inp);
    }

    function assetControls(accept) {
      const url = h('input', { value: draft.background.value || '', placeholder: 'https://…  or upload →' });
      const thumb = h('div', { class: 'bg-thumb' });
      function updateThumb() {
        if (draft.background.type === 'video') { thumb.style.backgroundImage = 'none'; thumb.style.background = '#05070d'; thumb.innerHTML = `<div class="muted" style="display:grid;place-items:center;height:100%">${icon('film', 26)}</div>`; }
        else if (draft.background.value) { thumb.innerHTML = ''; thumb.style.backgroundImage = `url("${draft.background.value}")`; }
        else { thumb.style.backgroundImage = 'none'; thumb.innerHTML = '<div class="muted" style="display:grid;place-items:center;height:100%">No image selected</div>'; }
      }
      url.addEventListener('input', () => { draft.background.value = url.value.trim(); updateThumb(); schedulePreview(); });
      const file = h('input', { type: 'file', accept, style: { display: 'none' } });
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        try { CP.ui.toast('Uploading…', 'info'); const d = await CP.api.adminUploadAppearance(f); draft.background.value = d.url; url.value = d.url; updateThumb(); schedulePreview(); CP.ui.toast('Uploaded', 'ok'); }
        catch (e) { CP.ui.toast(e.message, 'err'); }
        file.value = '';
      });
      updateThumb();
      return h('div', {}, h('div', { class: 'asset-row' }, url, file, h('button', { class: 'btn', html: `${icon('up', 14)} Upload`, onclick: () => file.click() })), thumb);
    }

    function renderBg() {
      CP.clear(bgControls);
      const b = draft.background;
      if (b.type === 'preset') { bgControls.appendChild(h('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, "Uses the preset's animated nebula background.")); return; }
      if (b.type === 'color') {
        const ci = h('input', { type: 'color', value: toHex(b.value || palOf(draft.preset).bg || '#070a12') });
        ci.addEventListener('input', () => { b.value = ci.value; schedulePreview(); });
        bgControls.appendChild(h('div', { class: 'color-row' }, ci, h('span', { class: 'cr-label' }, 'Background color')));
        return;
      }
      if (b.type === 'gradient') {
        const ta = h('input', { value: b.value || GRADIENTS[0], placeholder: 'linear-gradient(...)' });
        ta.addEventListener('input', () => { b.value = ta.value.trim(); schedulePreview(); });
        const quick = h('div', { class: 'grad-quick' }, ...GRADIENTS.map((g) => h('button', { class: 'grad-chip', style: { backgroundImage: g }, title: g, onclick: () => { b.value = g; ta.value = g; schedulePreview(); } })));
        bgControls.append(h('label', { class: 'field' }, h('span', {}, 'CSS gradient'), ta), quick);
        return;
      }
      const a = assetControls(b.type === 'video' ? 'video/*' : 'image/*');
      bgControls.appendChild(a);
      bgControls.appendChild(slider('Darken overlay (%)', 0, 90, b.dim, (v) => { b.dim = v; schedulePreview(); }));
      if (b.type !== 'video') {
        bgControls.appendChild(slider('Blur (px)', 0, 40, b.blur, (v) => { b.blur = v; schedulePreview(); }));
        const fit = h('select', {}, ...['cover', 'contain', 'tile', 'center'].map((f) => h('option', { value: f, selected: b.fit === f }, f)));
        fit.addEventListener('change', () => { b.fit = fit.value; schedulePreview(); });
        bgControls.appendChild(h('label', { class: 'field' }, h('span', {}, 'Fit'), fit));
      }
      const fixed = h('input', { type: 'checkbox', class: 'switch' }); fixed.checked = !!b.fixed;
      fixed.addEventListener('change', () => { b.fixed = fixed.checked; schedulePreview(); });
      bgControls.appendChild(h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Fixed (parallax)'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Stays put while content scrolls.')), h('div', { style: { marginLeft: 'auto' } }, fixed)));
    }
    renderBg();

    /* Effects */
    const fxAnim = h('input', { type: 'checkbox', class: 'switch' }); fxAnim.checked = !!draft.effects.animations;
    fxAnim.addEventListener('change', () => { draft.effects.animations = fxAnim.checked; schedulePreview(); });
    const fxGlass = h('input', { type: 'checkbox', class: 'switch' }); fxGlass.checked = !!draft.effects.glass;
    fxGlass.addEventListener('change', () => { draft.effects.glass = fxGlass.checked; schedulePreview(); });
    const radius = slider('Corner radius (px)', 0, 28, draft.effects.radius, (v) => { draft.effects.radius = v; schedulePreview(); });

    /* Branding */
    const brandName = h('input', { value: draft.brand.name || '', placeholder: CP.app.brand.name, maxlength: '40' });
    brandName.addEventListener('input', () => { draft.brand.name = brandName.value; });
    const brandTag = h('input', { value: draft.brand.tagline || '', placeholder: CP.app.brand.tagline, maxlength: '80' });
    brandTag.addEventListener('input', () => { draft.brand.tagline = brandTag.value; });

    /* Custom CSS */
    const customCss = h('textarea', { placeholder: '/* Anything goes, e.g. */\n.sidebar { box-shadow: 0 0 40px #a855f7; }', style: { minHeight: '120px' } });
    customCss.value = draft.customCss || '';
    customCss.addEventListener('input', () => { draft.customCss = customCss.value; schedulePreview(); });

    /* Actions */
    const dropPreview = () => { const el = document.getElementById('cp-appearance-preview'); if (el) el.remove(); };
    const saveBtn = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save theme` });
    saveBtn.onclick = async () => {
      try {
        await CP.api.adminSaveAppearance(draft);
        // Drop the live preview only once the saved global theme has loaded —
        // double-buffered reload, so there's no flash back to the base theme.
        CP.appearance.reloadGlobal(dropPreview);
        if (draft.brand.name) CP.app.brand.name = draft.brand.name;
        CP.ui.toast('Theme saved — live for everyone', 'ok');
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };
    const revertBtn = h('button', { class: 'btn ghost', html: `${icon('back', 14)} Discard`, onclick: () => { removeAppearancePreview(); appearanceTab(CP.clear(root)); } });
    const resetBtn = h('button', { class: 'btn ghost', html: `${icon('refresh', 14)} Reset to default` });
    resetBtn.onclick = async () => {
      if (!(await CP.ui.confirm({ title: 'Reset theme', message: 'Restore the default Editorial theme and clear all customizations?', confirmText: 'Reset' }))) return;
      try { await CP.api.adminResetAppearance(); CP.appearance.reloadGlobal(dropPreview); CP.ui.toast('Theme reset', 'ok'); appearanceTab(CP.clear(root)); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };

    /* Layout — Element.append() stringifies null → "null", so filter falsy children first. */
    root.append(...[
      h('div', { class: 'note', style: { marginBottom: '18px' }, html: `${icon('info', 15)} Changes preview live across the panel. Nothing changes for other users until you <b>Save</b>.` }),
      hasPersonalTheme ? h('div', { class: 'note', style: { marginBottom: '18px', borderLeftColor: 'var(--amber)', background: 'rgba(210,153,34,0.06)' }, html: `${icon('alert', 15)} You have a <b>personal theme</b> selected under <b>Account → Appearance</b>. It normally overrides the panel theme just for you — it's paused here so you can see your changes. Set it to <b>Panel default</b> in Account to use the panel theme everywhere.` }) : null,
      h('div', { class: 'card' },
        h('h3', { html: `${icon('palette', 16)} Theme presets` }),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 14px' } }, 'Pick a base palette, then fine-tune below.'),
        presetGrid),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', marginTop: '18px' } },
        h('div', { class: 'card' }, h('h3', { html: `${icon('droplet', 16)} Colors` }),
          h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 12px' } }, 'Override palette colors, or Reset to follow the preset.'),
          h('div', { class: 'color-grid' }, ...colorRows)),
        h('div', { class: 'card' }, h('h3', { html: `${icon('sliders', 16)} Effects` }),
          h('div', { style: { marginTop: '4px' } },
            h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Background animations'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Drifting starfield + glows.')), h('div', { style: { marginLeft: 'auto' } }, fxAnim)),
            h('div', { class: 'switch-row' }, h('div', {}, h('b', {}, 'Glass / blur panels'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Frosted translucent surfaces.')), h('div', { style: { marginLeft: 'auto' } }, fxGlass))),
          radius),
        h('div', { class: 'card' }, h('h3', { html: `${icon('image', 16)} Background` }),
          h('label', { class: 'field' }, h('span', {}, 'Type'), bgType), bgControls)),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', marginTop: '18px' } },
        h('div', { class: 'card' }, h('h3', { html: `${icon('rocket', 16)} Branding` }),
          h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 12px' } }, 'Optional — leave blank to use the defaults.'),
          h('label', { class: 'field' }, h('span', {}, 'Panel name'), brandName),
          h('label', { class: 'field' }, h('span', {}, 'Tagline'), brandTag)),
        h('div', { class: 'card' }, h('h3', { html: `${icon('edit', 16)} Custom CSS` }),
          h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 10px' } }, 'Advanced — injected site-wide. Make it insane.'),
          customCss)),
      h('div', { class: 'btn-row', style: { marginTop: '20px', alignItems: 'center' } }, saveBtn, revertBtn, h('div', { style: { flex: 1 } }), resetBtn)
    ].filter((n) => n != null && n !== false));
  }
})();
