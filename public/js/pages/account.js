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
          const res = await CP.api.put('/account/password', { current: curPass.value, password: newPass.value });
          if (res && res.token) CP.api.token = res.token; // keep this session; others are revoked
          curPass.value = ''; newPass.value = '';
          CP.ui.toast('Password changed — other sessions signed out', 'ok');
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

    /* Two-factor authentication */
    const twofaCard = h('div', { class: 'card' }, CP.spinner('Loading 2FA…'));
    buildTwoFactor(twofaCard);

    /* Appearance — profile picture + personal theme */
    const appearanceCard = h('div', { class: 'card' }, CP.spinner('Loading appearance…'));
    buildAppearance(appearanceCard);

    root.appendChild(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } }, profile, emailCard, passCard, twofaCard, appearanceCard));

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

  async function buildAppearance(card) {
    const u = CP.app.user;
    let presets = [];
    try { presets = (await CP.api.appearancePresets()).data; } catch {}
    CP.clear(card);
    card.appendChild(h('h3', { html: `${icon('palette', 16)} Appearance` }));

    // --- Profile picture ---
    const avatarBox = h('div', { class: 'avatar', style: { width: '54px', height: '54px', fontSize: '20px', backgroundSize: 'cover', backgroundPosition: 'center' } });
    const renderAvatar = () => {
      const a = CP.app.user.avatar;
      if (a) { avatarBox.style.backgroundImage = `url("${a}")`; avatarBox.textContent = ''; }
      else { avatarBox.style.backgroundImage = 'none'; avatarBox.textContent = (u.username[0] || '?').toUpperCase(); }
    };
    renderAvatar();
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0]; if (!f) return;
      try {
        const d = await CP.api.uploadAvatar(f);
        CP.app.user.avatar = d.avatar; renderAvatar();
        if (CP.app.refreshChrome) CP.app.refreshChrome();
        CP.ui.toast('Profile picture updated', 'ok');
      } catch (e) { CP.ui.toast(e.message, 'err'); }
      fileInput.value = '';
    });
    card.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', margin: '14px 0' } },
      avatarBox,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', html: `${icon('up', 14)} Upload`, onclick: () => fileInput.click() }),
        h('button', { class: 'btn sm ghost', html: `${icon('trash', 14)} Remove`, onclick: async () => {
          try { await CP.api.deleteAvatar(); CP.app.user.avatar = null; renderAvatar(); if (CP.app.refreshChrome) CP.app.refreshChrome(); CP.ui.toast('Profile picture removed', 'info'); }
          catch (e) { CP.ui.toast(e.message, 'err'); }
        } }),
        fileInput)));

    // --- Personal theme ---
    card.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 8px' } }, 'Personal theme (only you see it)'));
    const swatchRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
    const markActive = () => {
      const cur = CP.app.user.themePreset || '';
      swatchRow.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', (b.dataset.preset || '') === cur));
    };
    const setTheme = async (id) => {
      try {
        await CP.api.accountTheme(id || 'default');
        CP.app.user.themePreset = id || null;
        if (CP.appearance) CP.appearance.applyUserPreset(id || null);
        markActive();
        CP.ui.toast(id ? 'Theme applied' : 'Back to the panel default', 'ok');
      } catch (e) { CP.ui.toast(e.message, 'err'); }
    };
    const chip = (id, label, colors) => h('button', { class: 'btn sm', dataset: { preset: id || '' }, onclick: () => setTheme(id), style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      h('span', { style: { width: '14px', height: '14px', borderRadius: '4px', display: 'inline-block', background: colors ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]}, ${colors[2]})` : 'var(--surface-2)' } }),
      label);
    swatchRow.appendChild(chip('', 'Panel default', null));
    presets.forEach((p) => swatchRow.appendChild(chip(p.id, p.name, p.swatch)));
    card.appendChild(swatchRow);
    markActive();
  }

  async function buildTwoFactor(card) {
    let info;
    try { info = (await CP.api.twoFactor()).data; }
    catch (err) { CP.clear(card); card.appendChild(CP.empty('alert', err.message)); return; }
    CP.clear(card);
    card.appendChild(h('h3', { html: `${icon('lock', 16)} Two-Factor Authentication` }));

    if (info.enabled) {
      card.append(
        h('p', { class: 'muted', style: { fontSize: '13px', margin: '8px 0 12px' } },
          `Enabled — you'll be asked for a code from your authenticator app when signing in. ${info.backupCodesRemaining} recovery code(s) left.`),
        h('span', { class: 'badge green', style: { marginBottom: '14px', display: 'inline-block' } }, 'Active'),
        h('div', {}, h('button', { class: 'btn red', html: `${icon('lock', 15)} Disable 2FA`, onclick: () => disableFlow(card) }))
      );
      return;
    }
    card.append(
      h('p', { class: 'muted', style: { fontSize: '13px', margin: '8px 0 14px' } },
        'Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password…).'),
      h('button', { class: 'btn primary', html: `${icon('shield', 15)} Enable two-factor`, onclick: () => enrollFlow(card) })
    );
  }

  async function enrollFlow(card) {
    let setup;
    try { setup = (await CP.api.twoFactorSetup()).data; }
    catch (err) { return CP.ui.toast(err.message, 'err'); }

    const svg = CP.qrSvg ? CP.qrSvg(setup.otpauth, 200) : null;
    const qrBox = svg
      ? h('div', { style: { background: '#fff', padding: '10px', borderRadius: '12px', width: 'max-content', margin: '0 auto' }, html: svg })
      : h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Enter the key below into your authenticator app.');
    const code = h('input', { placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6' });

    const ref = CP.ui.modal({
      title: 'Set up two-factor', size: 'lg',
      body: h('div', {},
        h('p', { class: 'muted', style: { fontSize: '13px', marginTop: 0 } }, 'Scan the QR code, or enter the key manually, then type the 6-digit code to confirm.'),
        qrBox,
        h('div', { style: { margin: '14px 0' } },
          h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '4px' } }, 'Manual entry key'),
          h('span', { class: 'copy', html: `<span class="mono">${CP.esc(setup.secret)}</span> ${icon('copy', 13)}`, onclick: () => CP.copy(setup.secret) })),
        h('label', { class: 'field' }, h('span', {}, 'Confirmation code'), code)),
      footer: [
        h('button', { class: 'btn ghost', onclick: () => ref.close() }, 'Cancel'),
        h('button', { class: 'btn primary', html: `${icon('check', 15)} Verify & enable`, onclick: async () => {
          try {
            const r = (await CP.api.twoFactorEnable(code.value.trim())).data;
            if (CP.app.user) CP.app.user.twoFactorEnabled = true;
            showBackupCodes(ref, r.backupCodes || [], card);
          } catch (err) { CP.ui.toast(err.message, 'err'); }
        } }),
      ],
    });
    setTimeout(() => code.focus(), 60);
  }

  function showBackupCodes(ref, codes, card) {
    const list = h('div', { class: 'mono', style: { columns: '2', fontSize: '14px', lineHeight: '2', margin: '8px 0' } },
      ...codes.map((c) => h('div', {}, c)));
    CP.clear(ref.modal.querySelector('.modal-body')).append(
      h('p', {}, h('b', {}, 'Two-factor is now enabled. ')),
      h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Save these one-time recovery codes somewhere safe — each lets you sign in once if you lose your device. They won\'t be shown again.'),
      list,
      h('button', { class: 'btn', html: `${icon('copy', 14)} Copy all`, onclick: () => CP.copy(codes.join('\n'), 'Recovery codes copied') })
    );
    const foot = ref.modal.querySelector('.modal-foot');
    if (foot) CP.clear(foot).appendChild(h('button', { class: 'btn primary', onclick: () => { ref.close(); buildTwoFactor(card); } }, 'Done'));
  }

  async function disableFlow(card) {
    const pw = await CP.ui.prompt({ title: 'Disable two-factor', label: 'Confirm with your current password', confirmText: 'Disable' });
    if (pw === null) return;
    try { await CP.api.twoFactorDisable(pw); if (CP.app.user) CP.app.user.twoFactorEnabled = false; CP.ui.toast('Two-factor disabled', 'ok'); buildTwoFactor(card); }
    catch (err) { CP.ui.toast(err.message, 'err'); }
  }
})();
