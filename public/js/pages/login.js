/* Cloud Panel — Login / Sign-up page */
(function () {
  'use strict';
  const CP = window.CP;
  const { h } = CP;

  CP.pages = CP.pages || {};

  async function adoptSession(res) {
    CP.api.token = res.token;
    try {
      const me = await CP.api.me();
      CP.app.user = me.user;
      CP.app.economyEnabled = !!me.economyEnabled;
    } catch {
      CP.app.user = res.user;
    }
  }

  CP.pages.login = async function (appRoot) {
    CP.clear(appRoot);
    let cfg = { registrationEnabled: false, requireApproval: false };
    try { cfg = await CP.api.authConfig(); } catch {}

    const wrap = h('div', { class: 'auth' });
    const card = h('form', { class: 'auth-card' });
    wrap.appendChild(card);
    appRoot.appendChild(wrap);

    const brand = () => h('div', { class: 'auth-brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', {}, 'Cloud Panel')));

    function renderLogin() {
      card.onsubmit = doLogin;
      CP.clear(card);
      const error = h('div', { class: 'auth-error' });
      const loginInput = h('input', { placeholder: 'username or email', autocomplete: 'username' });
      const passInput = h('input', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
      const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
      card._fields = { error, btn, loginInput, passInput };
      card.append(
        brand(),
        h('p', { class: 'sub' }, 'Deploy. Scale. Dominate. Sign in to your control panel.'),
        error,
        h('label', { class: 'field' }, h('span', {}, 'Username or email'), loginInput),
        h('label', { class: 'field' }, h('span', {}, 'Password'), passInput),
        btn,
        cfg.registrationEnabled
          ? h('div', { class: 'hint' }, h('span', {}, "Don't have an account? "),
              h('a', { class: 'auth-link', onclick: renderSignup }, 'Create one'))
          : null
      );
      setTimeout(() => loginInput.focus(), 60);
    }

    async function doLogin(e) {
      e.preventDefault();
      const { error, btn, loginInput, passInput } = card._fields;
      error.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await CP.api.login(loginInput.value.trim(), passInput.value);
        await adoptSession(res);
        CP.ui.toast(`Welcome back, ${CP.app.user.firstName || CP.app.user.username}`, 'ok');
        CP.app.go('/');
      } catch (err) {
        error.textContent = err.message; btn.disabled = false; btn.textContent = 'Sign in';
      }
    }

    function renderSignup() {
      card.onsubmit = doSignup;
      CP.clear(card);
      const error = h('div', { class: 'auth-error' });
      const username = h('input', { placeholder: 'username', autocomplete: 'username' });
      const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
      const password = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
      const confirm = h('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
      const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Create account');
      card._fields = { error, btn, username, email, password, confirm };
      card.append(
        brand(),
        h('p', { class: 'sub' }, cfg.requireApproval
          ? 'Create an account — an admin will approve it before you can deploy servers.'
          : 'Create your account and start deploying servers.'),
        error,
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
          h('label', { class: 'field' }, h('span', {}, 'Username'), username),
          h('label', { class: 'field' }, h('span', {}, 'Email'), email)),
        h('label', { class: 'field' }, h('span', {}, 'Password'), password),
        h('label', { class: 'field' }, h('span', {}, 'Confirm password'), confirm),
        btn,
        h('div', { class: 'hint' }, h('span', {}, 'Already have an account? '),
          h('a', { class: 'auth-link', onclick: renderLogin }, 'Sign in'))
      );
      setTimeout(() => username.focus(), 60);
    }

    async function doSignup(e) {
      e.preventDefault();
      const { error, btn, username, email, password, confirm } = card._fields;
      error.textContent = '';
      if (password.value.length < 8) { error.textContent = 'Password must be at least 8 characters.'; return; }
      if (password.value !== confirm.value) { error.textContent = 'Passwords do not match.'; return; }
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const res = await CP.api.register({ username: username.value.trim(), email: email.value.trim(), password: password.value });
        await adoptSession(res);
        if (res.status === 'pending') CP.ui.toast('Account created — awaiting admin approval', 'info', 5000);
        else CP.ui.toast('Welcome to Cloud Panel! 🚀', 'ok');
        CP.app.go('/');
      } catch (err) {
        error.textContent = err.message; btn.disabled = false; btn.textContent = 'Create account';
      }
    }

    renderLogin();
  };
})();
