/* Cloud Panel — Awaiting-approval / declined screen */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  CP.pages.pending = function (appRoot) {
    CP.clear(appRoot);
    const u = CP.app.user || {};
    const declined = u.status === 'declined';

    const card = h('div', { class: 'auth-card', style: { textAlign: 'center', maxWidth: '460px' } },
      h('div', { class: 'pending-icon ' + (declined ? 'bad' : ''), html: icon(declined ? 'x' : 'clock', 34) }),
      h('h1', { style: { margin: '14px 0 6px', fontSize: '22px' } }, declined ? 'Account declined' : 'Awaiting approval'),
      h('p', { class: 'sub', style: { margin: '0 auto 22px' } },
        declined
          ? 'Your account request was declined. If you think this is a mistake, contact an administrator.'
          : `Thanks for signing up, ${u.firstName || u.username || 'there'}! An administrator needs to approve your account before you can create and manage servers. Check back soon.`),
      !declined ? h('button', { class: 'btn block', html: `${icon('refresh', 16)} Check status`, onclick: async () => {
        try {
          const me = await CP.api.me();
          CP.app.user = me.user; CP.app.economyEnabled = !!me.economyEnabled;
          if (me.user.status === 'active') { CP.ui.toast('You\'re approved! Welcome 🎉', 'ok'); CP.app.go('/'); }
          else CP.ui.toast('Still awaiting approval — hang tight.', 'info');
        } catch (err) { CP.ui.toast(err.message, 'err'); }
      } }) : null,
      h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, html: `${icon('logout', 16)} Sign out`, onclick: () => CP.app.logout() })
    );
    appRoot.appendChild(h('div', { class: 'auth' }, card));
  };
})();
