/* Cloud Panel — first-run setup wizard */
(function () {
  'use strict';
  const CP = window.CP;
  const { h } = CP;
  CP.pages = CP.pages || {};

  function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(s, 4);
  }
  const STRENGTH = [
    { label: 'Too short', color: '#f87171', w: '15%' },
    { label: 'Weak', color: '#fb7185', w: '30%' },
    { label: 'Fair', color: '#fbbf24', w: '55%' },
    { label: 'Good', color: '#34d399', w: '80%' },
    { label: 'Strong', color: '#22d3ee', w: '100%' },
  ];

  CP.pages.setup = function (appRoot) {
    CP.clear(appRoot);
    let step = 0;

    const card = h('form', { class: 'auth-card setup-card', onsubmit: (e) => e.preventDefault() });
    appRoot.appendChild(h('div', { class: 'auth' }, card));

    const stepper = () => h('div', { class: 'stepper' }, h('span', { class: 'sdot' + (step >= 0 ? ' on' : '') }), h('span', { class: 'sdot' + (step >= 1 ? ' on' : '') }));

    function renderWelcome() {
      CP.clear(card);
      card.append(
        h('div', { class: 'auth-brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', {}, 'Cloud Panel'))),
        h('p', { class: 'sub' }, "Let's get you set up. This panel has no accounts yet — create your administrator and you're ready to deploy."),
        h('div', { class: 'setup-feat' },
          feat('shield', 'You become the first administrator'),
          feat('server', 'Create & control real game servers'),
          feat('lock', 'No default passwords — secure by design')
        ),
        h('button', { class: 'btn primary block', onclick: () => { step = 1; renderForm(); } }, 'Get started  →'),
        stepper()
      );
    }

    function feat(ic, text) {
      return h('div', {}, h('span', { html: CP.icon(ic, 18), style: { color: 'var(--cyan)' } }), h('span', {}, text));
    }

    function renderForm() {
      CP.clear(card);
      const error = h('div', { style: { color: 'var(--red)', fontSize: '13px', minHeight: '18px', marginBottom: '8px' } });
      const username = h('input', { placeholder: 'admin', autocomplete: 'username' });
      const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
      const first = h('input', { placeholder: 'First (optional)' });
      const last = h('input', { placeholder: 'Last (optional)' });
      const password = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
      const confirm = h('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
      const meterFill = h('i');
      const meterLabel = h('span', { class: 'faint', style: { fontSize: '11px' } }, '');
      const meter = h('div', {},
        h('div', { class: 'strength' }, meterFill),
        h('div', { style: { marginTop: '4px', textAlign: 'right' } }, meterLabel));
      password.addEventListener('input', () => {
        if (!password.value) { meterFill.style.width = '0'; meterLabel.textContent = ''; return; }
        const s = strength(password.value); const m = STRENGTH[s];
        meterFill.style.width = m.w; meterFill.style.background = m.color; meterLabel.textContent = m.label; meterLabel.style.color = m.color;
      });

      const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Create account & enter');

      async function submit(e) {
        e.preventDefault();
        error.textContent = '';
        if (!username.value.trim() || !email.value.trim() || !password.value) { error.textContent = 'Username, email and password are required.'; return; }
        if (password.value.length < 8) { error.textContent = 'Password must be at least 8 characters.'; return; }
        if (password.value !== confirm.value) { error.textContent = 'Passwords do not match.'; return; }
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
          const res = await CP.api.setup({
            username: username.value.trim(), email: email.value.trim(),
            firstName: first.value.trim(), lastName: last.value.trim(), password: password.value,
          });
          CP.api.token = res.token;
          CP.app.user = res.user;
          CP.app.needsSetup = false;
          CP.ui.toast('Welcome to Cloud Panel! 🚀', 'ok');
          CP.app.go('/');
        } catch (err) {
          error.textContent = err.message;
          btn.disabled = false; btn.textContent = 'Create account & enter';
        }
      }
      card.onsubmit = submit;

      card.append(
        h('div', { class: 'auth-brand' }, h('img', { src: '/img/logo.svg', alt: '' }), h('div', {}, h('h1', {}, 'Create admin'))),
        h('p', { class: 'sub' }, 'This is the master account for your panel. Keep it safe.'),
        error,
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
          h('label', { class: 'field' }, h('span', {}, 'Username'), username),
          h('label', { class: 'field' }, h('span', {}, 'Email'), email),
          h('label', { class: 'field' }, h('span', {}, 'First name'), first),
          h('label', { class: 'field' }, h('span', {}, 'Last name'), last)),
        h('label', { class: 'field' }, h('span', {}, 'Password'), password, meter),
        h('label', { class: 'field' }, h('span', {}, 'Confirm password'), confirm),
        btn,
        h('button', { class: 'btn ghost block', style: { marginTop: '8px' }, onclick: () => { step = 0; card.onsubmit = (e) => e.preventDefault(); renderWelcome(); } }, '← Back'),
        stepper()
      );
      setTimeout(() => username.focus(), 50);
    }

    renderWelcome();
  };
})();
