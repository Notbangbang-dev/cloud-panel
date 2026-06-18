/* Cloud Panel — Login page */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;

  CP.pages = CP.pages || {};
  CP.pages.login = function (appRoot) {
    CP.clear(appRoot);

    const error = h('div', { style: { color: 'var(--red)', fontSize: '13px', minHeight: '18px', marginBottom: '10px' } });
    const loginInput = h('input', { value: '', placeholder: 'admin@cloud.panel', autocomplete: 'username' });
    const passInput = h('input', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');

    async function submit(e) {
      e.preventDefault();
      error.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const res = await CP.api.login(loginInput.value.trim(), passInput.value);
        CP.api.token = res.token;
        CP.app.user = res.user;
        CP.ui.toast(`Welcome back, ${res.user.firstName || res.user.username}`, 'ok');
        CP.app.go('/');
      } catch (err) {
        error.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }

    const form = h('form', { class: 'auth-card', onsubmit: submit },
      h('div', { class: 'auth-brand' },
        h('img', { src: '/img/logo.svg', alt: '' }),
        h('div', {},
          h('h1', {}, 'Cloud Panel'),
        )
      ),
      h('p', { class: 'sub' }, 'Deploy. Scale. Dominate. Sign in to your control panel.'),
      error,
      h('label', { class: 'field' }, h('span', {}, 'Username or email'), loginInput),
      h('label', { class: 'field' }, h('span', {}, 'Password'), passInput),
      btn,
      h('div', { class: 'hint' },
        h('div', {}, 'Demo credentials'),
        h('div', { html: '<code>admin@cloud.panel</code> / <code>password</code>' }),
        h('div', { html: '<code>demo@cloud.panel</code> / <code>demo1234</code>' })
      )
    );

    appRoot.appendChild(h('div', { class: 'auth' }, form));
    setTimeout(() => loginInput.focus(), 60);
  };
})();
