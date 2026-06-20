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
    wrap.appendChild(h('div', { class: 'auth-legal' },
      h('a', { onclick: () => CP.app.go('/terms') }, 'Terms'),
      h('span', {}, ' · '),
      h('a', { onclick: () => CP.app.go('/privacy') }, 'Privacy')));
    appRoot.appendChild(wrap);

    const brand = () => h('div', { class: 'auth-brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', {}, 'Cloud Panel')));

    const DISCORD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:-4px;margin-right:8px"><path d="M19.27 5.33A16.9 16.9 0 0 0 15.1 4l-.21.42c1.5.36 2.74.92 3.9 1.7a13.6 13.6 0 0 0-11.58 0c1.16-.78 2.4-1.34 3.9-1.7L10.9 4a16.9 16.9 0 0 0-4.17 1.33C3.5 9.36 2.6 13.3 3 17.18A17 17 0 0 0 8.2 19.8l.74-1.27c-.7-.26-1.34-.59-1.95-1l.16-.12a9.7 9.7 0 0 0 9.7 0l.16.12c-.6.41-1.25.74-1.95 1l.74 1.27a17 17 0 0 0 5.2-2.62c.46-4.43-.86-8.33-2.73-11.85zM9.3 14.94c-.82 0-1.5-.75-1.5-1.67 0-.92.66-1.67 1.5-1.67.83 0 1.5.76 1.5 1.67 0 .92-.67 1.67-1.5 1.67zm5.4 0c-.82 0-1.5-.75-1.5-1.67 0-.92.67-1.67 1.5-1.67.84 0 1.5.76 1.5 1.67 0 .92-.66 1.67-1.5 1.67z"/></svg>';
    const discordBlock = () => cfg.discordEnabled
      ? h('div', {},
          h('div', { class: 'auth-or' }, h('span', {}, 'or')),
          h('a', { class: 'btn block discord', href: '/api/auth/discord/login', html: DISCORD_SVG + 'Continue with Discord' }))
      : null;

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
        discordBlock(),
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
        if (res.twoFactorRequired) { renderTwoFactor(res.ticket); return; }
        await adoptSession(res);
        CP.ui.toast(`Welcome back, ${CP.app.user.firstName || CP.app.user.username}`, 'ok');
        CP.app.go('/');
      } catch (err) {
        error.textContent = err.message; btn.disabled = false; btn.textContent = 'Sign in';
      }
    }

    function renderTwoFactor(ticket) {
      card.onsubmit = (e) => { e.preventDefault(); verify(); };
      CP.clear(card);
      const error = h('div', { class: 'auth-error' });
      const codeInput = h('input', { placeholder: '6-digit code or recovery code', autocomplete: 'one-time-code', inputmode: 'numeric' });
      const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Verify');
      card.append(
        brand(),
        h('p', { class: 'sub' }, 'Two-factor authentication — enter the code from your authenticator app.'),
        error,
        h('label', { class: 'field' }, h('span', {}, 'Authentication code'), codeInput),
        btn,
        h('div', { class: 'hint' }, h('a', { class: 'auth-link', onclick: renderLogin }, 'Back to sign in'))
      );
      setTimeout(() => codeInput.focus(), 60);

      async function verify() {
        error.textContent = ''; btn.disabled = true; btn.textContent = 'Verifying…';
        try {
          const res = await CP.api.login2fa(ticket, codeInput.value.trim());
          await adoptSession(res);
          CP.ui.toast(`Welcome back, ${CP.app.user.firstName || CP.app.user.username}`, 'ok');
          CP.app.go('/');
        } catch (err) {
          error.textContent = err.message; btn.disabled = false; btn.textContent = 'Verify';
        }
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
        discordBlock(),
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
