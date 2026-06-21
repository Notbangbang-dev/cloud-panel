/* Cloud Panel — maintenance notice (shown to non-admins while maintenance mode is on) */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  CP.pages.maintenance = function (appRoot) {
    CP.clear(appRoot);
    const m = (CP.app && CP.app.maintenance) || {};

    const card = h('div', { class: 'auth-card', style: { maxWidth: '460px', textAlign: 'center' } },
      h('div', { style: { color: 'var(--amber, #fbbf24)', margin: '4px auto 10px', display: 'flex', justifyContent: 'center' }, html: icon('alert', 44) }),
      h('h1', { style: { fontSize: '22px', margin: '6px 0' } }, m.title || "We'll be right back"),
      h('p', { class: 'muted', style: { lineHeight: '1.6', margin: '6px 0 0' } },
        m.message || 'Cloud Panel is undergoing scheduled maintenance. Please check back soon.'),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' } },
        h('button', { class: 'btn primary', html: `${icon('refresh', 15)} Retry`, onclick: () => location.reload() }),
        h('button', { class: 'btn ghost', html: `${icon('logout', 15)} Sign out`, onclick: () => CP.app.logout() }))
    );

    appRoot.appendChild(h('div', { class: 'auth' }, card,
      h('div', { class: 'auth-legal' }, h('span', {}, (CP.app && CP.app.brand && CP.app.brand.name) || 'Cloud Panel'))));
  };
})();
