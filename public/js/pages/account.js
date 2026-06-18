/* Cloud Panel — Account */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  CP.pages.account = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Account' }]);
    const u = CP.app.user;

    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, 'Account Settings'), h('p', {}, 'Manage your profile, credentials and review recent activity.'))
    ));

    /* Email */
    const emailInput = h('input', { value: u.email, type: 'email' });
    const emailPass = h('input', { type: 'password', placeholder: 'Current password' });
    const emailCard = h('div', { class: 'card' },
      h('h3', { html: `${icon('mail', 16)} Email Address` }),
      h('label', { class: 'field', style: { marginTop: '14px' } }, h('span', {}, 'Email'), emailInput),
      h('label', { class: 'field' }, h('span', {}, 'Confirm with current password'), emailPass),
      h('button', { class: 'btn primary', html: `${icon('save', 15)} Update email`, onclick: async () => {
        try {
          await CP.api.put('/account/email', { email: emailInput.value, password: emailPass.value });
          CP.app.user.email = emailInput.value; emailPass.value = '';
          CP.ui.toast('Email updated', 'ok');
        } catch (err) { CP.ui.toast(err.message, 'err'); }
      } })
    );

    /* Password */
    const curPass = h('input', { type: 'password', placeholder: 'Current password' });
    const newPass = h('input', { type: 'password', placeholder: 'New password' });
    const passCard = h('div', { class: 'card' },
      h('h3', { html: `${icon('lock', 16)} Password` }),
      h('label', { class: 'field', style: { marginTop: '14px' } }, h('span', {}, 'Current password'), curPass),
      h('label', { class: 'field' }, h('span', {}, 'New password'), newPass),
      h('button', { class: 'btn primary', html: `${icon('key', 15)} Change password`, onclick: async () => {
        try {
          await CP.api.put('/account/password', { current: curPass.value, password: newPass.value });
          curPass.value = ''; newPass.value = '';
          CP.ui.toast('Password changed', 'ok');
        } catch (err) { CP.ui.toast(err.message, 'err'); }
      } })
    );

    /* Profile summary */
    const profile = h('div', { class: 'card' },
      h('h3', { html: `${icon('shield', 16)} Profile` }),
      h('dl', { class: 'kv', style: { marginTop: '14px' } },
        h('dt', {}, 'Username'), h('dd', {}, u.username),
        h('dt', {}, 'Name'), h('dd', {}, `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—'),
        h('dt', {}, 'Role'), h('dd', {}, u.admin ? h('span', { class: 'badge admin' }, 'Administrator') : h('span', { class: 'badge soft' }, 'User')),
        h('dt', {}, 'User ID'), h('dd', { class: 'mono faint' }, u.uuid)
      )
    );

    root.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } }, profile, emailCard, passCard));

    /* Activity */
    root.appendChild(h('div', { class: 'section-title' }, 'Recent Activity'));
    const actWrap = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, CP.spinner('Loading activity…'));
    root.appendChild(actWrap);
    try {
      const res = await CP.api.get('/account/activity');
      CP.clear(actWrap);
      if (!res.data.length) { actWrap.appendChild(CP.empty('activity', 'No activity yet.')); return; }
      const tbody = h('tbody');
      res.data.forEach((a) => tbody.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'badge soft' }, a.type)),
        h('td', {}, a.message),
        h('td', { class: 'muted nowrap right' }, fmt.rel(a.createdAt))
      )));
      actWrap.appendChild(h('table', { class: 'tbl' }, tbody));
    } catch (err) {
      CP.clear(actWrap); actWrap.appendChild(CP.empty('alert', err.message));
    }
  };
})();
