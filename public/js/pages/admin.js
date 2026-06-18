/* Cloud Panel — Admin console */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const SUBS = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'servers', label: 'Servers', icon: 'server' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'nodes', label: 'Nodes', icon: 'cpu' },
    { id: 'locations', label: 'Locations', icon: 'pin' },
    { id: 'allocations', label: 'Allocations', icon: 'network' },
    { id: 'eggs', label: 'Eggs', icon: 'box' },
    { id: 'settings', label: 'Settings', icon: 'sliders' },
  ];

  CP.pages.admin = async function (root, ctx) {
    if (!CP.app.user.admin) { root.appendChild(CP.empty('shield', 'Administrator access required.')); return; }
    ctx.setCrumbs([{ label: 'Admin' }]);

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
      CP.clear(content);
      ({ overview, servers, users, nodes, locations, allocations, eggs, settings }[active])(content);
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
      html: `${icon('info', 15)} Panel running on PufferPanel ports — <b>Web</b> <span class="mono">${d.ports.web}</span> · <b>SFTP</b> <span class="mono">${d.ports.sftp}</span>. Version ${d.version}.` }));

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
          h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          const environment = {};
          Object.entries(varInputs).forEach(([k, el]) => (environment[k] = el.value));
          try {
            const res = await CP.api.post('/admin/servers', {
              name: name.value, ownerId: owner.value, nodeId: node.value, eggId: egg.value,
              memory: +mem.value, disk: +disk.value, cpu: +cpu.value, environment,
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
  async function giveCoins(u, done) {
    const v = await CP.ui.prompt({ title: `Coins for ${u.username}`, label: 'Amount to add (use a negative number to remove)', value: '100' });
    if (v === null) return;
    try { await CP.api.adminCoins(u.id, Math.floor(Number(v) || 0)); CP.ui.toast('Coins updated', 'ok'); done(); }
    catch (e) { CP.ui.toast(e.message, 'err'); }
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
          h('div', { class: 'section-title', style: { marginTop: 0 } }, `${icon('clock', 13)} Pending approval (${pending.length})`),
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
          CP.app.economyEnabled ? h('button', { class: 'btn sm ghost icon', title: 'Give coins', html: icon('coin', 14), onclick: () => giveCoins(u, reload) }) : null,
          h('button', { class: 'btn sm ghost icon', title: 'Edit', html: icon('edit', 14), onclick: () => editUser(u, reload) }),
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delUser(u, reload) })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Email'), h('th', {}, 'Status'), h('th', {}, 'Coins'), h('th', {}, 'Quota'), h('th', { class: 'right' }, 'Actions'))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  function userForm(u) {
    const username = h('input', { value: u ? u.username : '', placeholder: 'username', disabled: !!u });
    const email = h('input', { value: u ? u.email : '', placeholder: 'user@cloud.panel' });
    const first = h('input', { value: u ? u.firstName : '' });
    const last = h('input', { value: u ? u.lastName : '' });
    const password = h('input', { type: 'password', placeholder: u ? 'Leave blank to keep' : 'password' });
    const admin = h('input', { type: 'checkbox' }); if (u && u.admin) admin.checked = true;
    const body = h('div', {},
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        h('label', { class: 'field' }, h('span', {}, 'Username'), username),
        h('label', { class: 'field' }, h('span', {}, 'Email'), email),
        h('label', { class: 'field' }, h('span', {}, 'First name'), first),
        h('label', { class: 'field' }, h('span', {}, 'Last name'), last),
        h('label', { class: 'field' }, h('span', {}, 'Password'), password)),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', cursor: 'pointer' } }, admin, h('span', { class: 'muted' }, 'Administrator (full access)')));
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

    const body = h('div', {},
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        h('label', { class: 'field' }, h('span', {}, 'Email'), email),
        h('label', { class: 'field' }, h('span', {}, 'Status'), status),
        h('label', { class: 'field' }, h('span', {}, 'First name'), first),
        h('label', { class: 'field' }, h('span', {}, 'Last name'), last),
        h('label', { class: 'field' }, h('span', {}, 'New password'), password),
        h('label', { class: 'field' }, h('span', {}, 'Coins'), coins)),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0 8px', cursor: 'pointer' } }, admin, h('span', { class: 'muted' }, 'Administrator (full access)')),
      h('div', { class: 'section-title', style: { margin: '10px 0 6px' } }, 'Resource quota'),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '0 12px' } },
        h('label', { class: 'field' }, h('span', {}, 'RAM (MB)'), mem),
        h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu),
        h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk),
        h('label', { class: 'field' }, h('span', {}, 'Slots'), slots),
        h('label', { class: 'field' }, h('span', {}, 'Backups'), backupsQ)));

    const ref = CP.ui.modal({ title: `Edit ${u.username}`, size: 'lg', body, footer: [
      h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const patch = {
          email: email.value, firstName: first.value, lastName: last.value, admin: admin.checked,
          status: status.value, coins: +coins.value,
          resources: { memory: +mem.value, cpu: +cpu.value, disk: +disk.value, servers: +slots.value, backups: +backupsQ.value },
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
    const dCoins = numIn(s.defaults.coins), dMem = numIn(s.defaults.memory), dCpu = numIn(s.defaults.cpu), dDisk = numIn(s.defaults.disk), dServers = numIn(s.defaults.servers), dBackups = numIn(s.defaults.backups);
    const minMem = numIn(s.limits.minMemory), minCpu = numIn(s.limits.minCpu), minDisk = numIn(s.limits.minDisk);
    const shop = {};
    ['memory', 'cpu', 'disk', 'servers', 'backups'].forEach((k) => { shop[k] = { price: numIn(s.shop[k].price), amount: numIn(s.shop[k].amount) }; });
    const afkOn = sw(s.afk && s.afk.enabled);
    const afkCoins = numIn(s.afk ? s.afk.coins : 1);
    const afkInterval = numIn(s.afk ? s.afk.intervalSeconds : 30);

    const shopRow = (label, unit, o) => h('div', { class: 'grid', style: { gridTemplateColumns: '120px 1fr 1fr', gap: '0 12px', alignItems: 'end' } },
      h('div', { style: { paddingBottom: '12px', fontWeight: '700' } }, label),
      field('Price (coins)', o.price), field(`Amount (${unit})`, o.amount));

    const save = h('button', { class: 'btn primary', html: `${icon('save', 15)} Save settings` });
    save.onclick = async () => {
      const patch = {
        economy: { enabled: econEnabled.checked },
        registration: { enabled: regEnabled.checked, requireApproval: regApproval.checked },
        defaults: { coins: +dCoins.value, memory: +dMem.value, cpu: +dCpu.value, disk: +dDisk.value, servers: +dServers.value, backups: +dBackups.value },
        limits: { minMemory: +minMem.value, minCpu: +minCpu.value, minDisk: +minDisk.value },
        shop: {
          memory: { price: +shop.memory.price.value, amount: +shop.memory.amount.value },
          cpu: { price: +shop.cpu.price.value, amount: +shop.cpu.amount.value },
          disk: { price: +shop.disk.price.value, amount: +shop.disk.amount.value },
          servers: { price: +shop.servers.price.value, amount: +shop.servers.amount.value },
          backups: { price: +shop.backups.price.value, amount: +shop.backups.amount.value },
        },
        afk: { enabled: afkOn.checked, coins: +afkCoins.value, intervalSeconds: +afkInterval.value },
      };
      try { await CP.api.adminUpdateSettings(patch); CP.app.economyEnabled = patch.economy.enabled; CP.app.afkEnabled = patch.economy.enabled && patch.afk.enabled; CP.ui.toast('Settings saved', 'ok'); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };

    root.append(
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } },
        h('div', { class: 'card' },
          h('h3', { html: `${icon('shield', 16)} Access` }),
          h('div', { style: { marginTop: '8px' } },
            switchRow('Allow sign-ups', 'Show "Create account" on the login page.', regEnabled),
            switchRow('Require approval', 'New sign-ups must be approved before they can create servers.', regApproval),
            switchRow('Economy & shop', 'Enable coins and the resource shop.', econEnabled))),
        h('div', { class: 'card' },
          h('h3', { html: `${icon('zap', 16)} New-user defaults` }),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: '8px' } },
            field('Starting coins', dCoins), field('Server slots', dServers),
            field('RAM (MB)', dMem), field('CPU (%)', dCpu), field('Disk (MB)', dDisk), field('Backups', dBackups))),
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
          shopRow('Backup Slot', 'slots', shop.backups))),
      h('div', { style: { marginTop: '18px' } }, save)
    );
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
      const tbody = h('tbody');
      list.forEach((n) => tbody.appendChild(h('tr', {},
        h('td', {}, h('b', {}, n.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, n.description || '')),
        h('td', { class: 'muted' }, n.location ? n.location.long : '—'),
        h('td', { class: 'mono muted' }, n.fqdn),
        h('td', { class: 'muted nowrap' }, fmt.mib(n.memory)),
        h('td', { class: 'muted' }, `${n.serverCount} srv · ${n.allocationsUsed}/${n.allocationCount}`),
        h('td', {}, h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm ghost icon', title: 'Delete', html: icon('trash', 14), onclick: () => delNode(n, () => nodes(CP.clear(root))) })))
      )));
      wrap.appendChild(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Node'), h('th', {}, 'Location'), h('th', {}, 'FQDN'), h('th', {}, 'Memory'), h('th', {}, 'Usage'), h('th', { class: 'right' }, ''))), tbody));
    } catch (err) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', err.message)); }
  }
  async function createNode(done) {
    const locs = (await CP.api.get('/admin/locations')).data;
    const name = h('input', { placeholder: 'Comet-03' });
    const desc = h('input', {});
    const loc = h('select', {}, ...locs.map((l) => h('option', { value: l.id }, l.long || l.short)));
    const fqdn = h('input', { value: location.hostname });
    const mem = h('input', { type: 'number', value: '16384' });
    const disk = h('input', { type: 'number', value: '102400' });
    const cpu = h('input', { type: 'number', value: '800' });
    const ref = CP.ui.modal({ title: 'Create Node', size: 'lg', body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 16px' } },
        h('label', { class: 'field' }, h('span', {}, 'Location'), loc),
        h('label', { class: 'field' }, h('span', {}, 'FQDN / IP'), fqdn),
        h('label', { class: 'field' }, h('span', {}, 'Memory (MB)'), mem),
        h('label', { class: 'field' }, h('span', {}, 'Disk (MB)'), disk),
        h('label', { class: 'field' }, h('span', {}, 'CPU (%)'), cpu))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          try { await CP.api.post('/admin/nodes', { name: name.value, description: desc.value, locationId: loc.value, fqdn: fqdn.value, memory: +mem.value, disk: +disk.value, cpu: +cpu.value }); CP.ui.toast('Node created', 'ok'); ref.close(); done(); }
          catch (err) { CP.ui.toast(err.message, 'err'); } } }, 'Create')] });
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
    loading(root);
    try {
      const list = (await CP.api.get('/admin/eggs')).data;
      CP.clear(root);
      const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } });
      list.forEach((e) => grid.appendChild(h('div', { class: 'card' },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('div', { class: 'glyph', style: { width: '40px', height: '40px' }, html: icon('box', 20) }),
          h('div', {}, h('b', {}, e.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, e.category))),
        h('p', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.6' } }, e.description),
        h('div', { class: 'chip', html: `${icon('box', 13)} ${CP.esc(e.docker)}` }),
        h('div', { class: 'mono faint', style: { fontSize: '11px', marginTop: '10px', wordBreak: 'break-all' } }, e.startup)
      )));
      root.appendChild(grid);
    } catch (err) { CP.clear(root); root.appendChild(CP.empty('alert', err.message)); }
  }
})();
