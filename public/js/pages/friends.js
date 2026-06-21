/* Cloud Panel — Friends */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  function dot(online) {
    return h('span', { title: online ? 'Online' : 'Offline', style: { width: '9px', height: '9px', borderRadius: '50%', display: 'inline-block', background: online ? 'var(--green,#4ade80)' : '#5c6788', boxShadow: online ? '0 0 8px var(--green,#4ade80)' : 'none' } });
  }
  function avatarNode(f) {
    return f.avatar
      ? h('img', { class: 'avatar', src: f.avatar, alt: '', style: { width: '34px', height: '34px', objectFit: 'cover' } })
      : h('div', { class: 'avatar', style: { width: '34px', height: '34px', fontSize: '13px' } }, (f.username[0] || '?').toUpperCase());
  }

  async function shareModal(friend) {
    let servers = [];
    try { servers = (await CP.api.get('/servers')).data; } catch (e) { return CP.ui.toast(e.message, 'err'); }
    if (!servers.length) return CP.ui.toast('You have no servers to share.', 'info');
    const sel = h('select', {}, ...servers.map((s) => h('option', { value: s.id }, s.name)));
    const perms = [['control.console', 'Console'], ['control.command', 'Commands'], ['control.power', 'Power'], ['file', 'Files'], ['backup', 'Backups']];
    const defaults = ['control.console', 'control.command', 'control.power', 'file'];
    const checks = perms.map(([p, l]) => { const i = h('input', { type: 'checkbox' }); if (defaults.includes(p)) i.checked = true; return { p, l, i }; });
    const save = h('button', { class: 'btn primary', html: `${icon('users', 15)} Share` });
    const ref = CP.ui.modal({
      title: `Share a server with ${friend.username}`, size: 'md',
      body: h('div', {},
        h('label', { class: 'field' }, h('span', {}, 'Server'), sel),
        h('div', { class: 'muted', style: { fontSize: '12px', margin: '10px 0 4px' } }, 'Permissions'),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } }, ...checks.map((c) => h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, c.i, c.l)))),
      footer: [h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'), save],
    });
    save.onclick = async () => {
      const permissions = checks.filter((c) => c.i.checked).map((c) => c.p);
      try { await CP.api.addSubuser(sel.value, friend.username, permissions); CP.ui.toast(`Shared with ${friend.username}`, 'ok'); ref.close(); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };
  }

  CP.pages.friends = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Friends' }]);
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, 'Friends'), h('p', {}, 'See who’s online and grow your crew.'))));

    const addInput = h('input', { placeholder: 'Add a friend by username…' });
    const addBtn = h('button', { class: 'btn primary', html: `${icon('plus', 15)} Send request` });
    root.appendChild(h('div', { class: 'card', style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '18px' } },
      h('div', { style: { flex: 1 } }, addInput), addBtn));

    const wrap = h('div', {}, CP.spinner('Loading friends…'));
    root.appendChild(wrap);

    async function load() {
      let d;
      try { d = (await CP.api.friends()).data; }
      catch (e) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', e.message)); return; }
      CP.clear(wrap);

      if (d.incoming.length) {
        const ib = h('div', {});
        d.incoming.forEach((f) => ib.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' } },
          avatarNode(f), h('b', { style: { flex: 1 } }, f.username),
          h('button', { class: 'btn sm green', html: `${icon('check', 13)} Accept`, onclick: async () => { try { await CP.api.friendAccept(f.id); CP.ui.toast(`You're now friends with ${f.username}`, 'ok'); load(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }),
          h('button', { class: 'btn sm ghost', html: `${icon('x', 13)}`, onclick: async () => { try { await CP.api.friendDecline(f.id); load(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }))));
        wrap.appendChild(h('div', { class: 'card', style: { marginBottom: '18px' } }, h('h3', { html: `${icon('clock', 16)} Friend requests (${d.incoming.length})` }, ), ib));
      }

      const fb = h('div', {});
      if (!d.friends.length) fb.appendChild(CP.empty('users', 'No friends yet — send a request above!'));
      else d.friends.sort((a, b) => (b.online - a.online)).forEach((f) => fb.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' } },
        avatarNode(f),
        h('div', { style: { flex: 1 } }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, dot(f.online), h('b', {}, f.username)),
          h('div', { class: 'faint', style: { fontSize: '12px' } }, f.online ? 'Online now' : 'Offline')),
        h('button', { class: 'btn sm ghost', title: 'Share a server', html: `${icon('server', 13)} Share`, onclick: () => shareModal(f) }),
        h('button', { class: 'btn sm ghost icon', title: 'Remove friend', html: icon('trash', 13), onclick: async () => { if (!(await CP.ui.confirm({ title: 'Remove friend', message: `Remove ${f.username}?`, confirmText: 'Remove' }))) return; try { await CP.api.friendRemove(f.id); load(); } catch (e) { CP.ui.toast(e.message, 'err'); } } }))));
      const onlineN = d.friends.filter((f) => f.online).length;
      wrap.appendChild(h('div', { class: 'card' }, h('h3', { html: `${icon('users', 16)} Your friends — ${onlineN}/${d.friends.length} online` }), fb));

      if (d.outgoing.length) wrap.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '12px' } }, `Pending sent: ${d.outgoing.map((f) => f.username).join(', ')}`));
    }

    addBtn.onclick = async () => {
      const u = addInput.value.trim(); if (!u) return;
      try { await CP.api.friendRequest(u); addInput.value = ''; CP.ui.toast('Request sent', 'ok'); load(); }
      catch (e) { CP.ui.toast(e.message, 'err'); }
    };
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });

    await load();
    const timer = setInterval(load, 20000); // refresh online status
    ctx.onCleanup(() => clearInterval(timer));
  };
})();
