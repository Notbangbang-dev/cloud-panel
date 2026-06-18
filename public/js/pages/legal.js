/* Cloud Panel — Terms of Service & Privacy Policy (standalone pages) */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  const UPDATED = 'June 18, 2026';

  const TERMS = {
    title: 'Terms of Service',
    note: 'Cloud Panel is free, open-source software (MIT). This covers this hosted instance; the person/team operating it (the "Operator") is responsible for the service.',
    sections: [
      { h: '1. Acceptance', p: ['By creating an account or using this Cloud Panel instance (the "Service"), you agree to these Terms and to the Privacy Policy. If you do not agree, do not use the Service.'] },
      { h: '2. Eligibility', p: ['You must be at least 13 (or the minimum digital age in your country). If under the age of majority, you confirm you have a parent/guardian\'s permission.'] },
      { h: '3. Accounts', p: [['You are responsible for your account, your password, and all activity under it.', 'New accounts may require Operator approval before gaining access.', 'Provide accurate info; do not impersonate others or share your account.']] },
      { h: '4. Acceptable use', p: ['You agree not to:', ['Use the Service for anything illegal or harmful, or that infringes others\' rights.', 'Host or distribute malware, phishing, spam, or content you don\'t have rights to.', 'Break, overload, reverse-engineer, or gain unauthorized access to the panel, its host, or other users\' servers.', 'Abuse or manipulate resource limits, the economy, coins, shop, AFK rewards, or backups (exploits, bots, multi-accounting).', 'Resell or sublicense access without the Operator\'s permission.']] },
      { h: '5. Resources, coins & shop', p: [['Coins, quotas, server slots and backup slots are virtual items with NO real-world monetary value and are not redeemable for cash.', 'Virtual items are generally non-refundable; the Operator may adjust or remove them at any time.', 'Items gained through bugs or abuse may be reset or revoked.']] },
      { h: '6. Your servers & content', p: [['You own the files you upload and are responsible for what you run.', 'You must comply with the licenses of software you install (e.g. the Minecraft EULA).', 'The Operator may remove content or suspend servers that violate these Terms or the law.']] },
      { h: '7. Backups', p: ['Backups are best-effort and NOT guaranteed — they may fail or be lost. Keep your own independent copies of anything important.'] },
      { h: '8. Suspension & termination', p: ['The Operator may suspend, limit, or terminate your account or servers for violations, suspected abuse, or legal reasons. You may stop using the Service and request deletion at any time.'] },
      { h: '9. Disclaimers', p: ['The Service is provided "as is" and "as available", without warranties of any kind. Uptime, security, and data preservation are not guaranteed.'] },
      { h: '10. Limitation of liability', p: ['To the maximum extent permitted by law, the Operator and the Cloud Panel authors are not liable for any indirect or consequential damages, or loss of data, profits, or servers.'] },
      { h: '11. Changes', p: ['These Terms may be updated. Continued use after changes means you accept the updated Terms.'] },
    ],
  };

  const PRIVACY = {
    title: 'Privacy Policy',
    note: 'This describes how this self-hosted instance handles your data. The Operator controls the server and is the data controller.',
    sections: [
      { h: '1. What we collect', p: [['Account info: username, email, optional name, and a securely hashed password (never stored in plain text).', 'Server content: files, configs and backups you upload.', 'Economy data: coin balance, quotas, and shop/AFK activity.', 'Activity logs: sign-ins, power actions, purchases, moderation events.', 'Technical data: your IP address (security, rate-limiting, abuse prevention).']] },
      { h: '2. How we use it', p: [['To provide and operate the Service.', 'To keep it secure and prevent abuse.', 'To provide support.']] },
      { h: '3. Cookies & local storage', p: ['The panel stores a login token in your browser\'s local storage to keep you signed in. We do NOT use third-party advertising or tracking cookies.'] },
      { h: '4. Sharing & third parties', p: [['We do NOT sell your personal information.', 'Your data stays on the Operator\'s server, except where required by law or to run the Service.', 'Installing certain server types downloads files from third parties (PaperMC, Mojang, Fabric) under their own policies.', 'The VPS/host running this instance may process data during normal operation.']] },
      { h: '5. Data retention', p: ['Data is kept while your account is active. On deletion, your personal data, servers and backups are removed (some logs may be kept briefly for security/legal reasons).'] },
      { h: '6. Security', p: ['We use bcrypt password hashing, signed session tokens (JWT), rate-limiting, and access protections. No system is 100% secure.'] },
      { h: '7. Your rights', p: ['You can view/update your details in account settings and request access to or deletion of your data from the Operator. You may have extra rights under laws like GDPR or CCPA.'] },
      { h: '8. Children', p: ['The Service is not directed to children under 13 (or your country\'s minimum digital age).'] },
      { h: '9. Changes', p: ['We may update this policy; material changes are reflected by the "Last updated" date.'] },
    ],
  };

  function renderPara(item) {
    if (Array.isArray(item)) return h('ul', {}, ...item.map((li) => h('li', {}, li)));
    return h('p', {}, item);
  }

  function render(appRoot, doc) {
    CP.clear(appRoot);
    const top = h('div', { class: 'legal-top' },
      h('a', { class: 'brand', href: '/', onclick: (e) => { e.preventDefault(); CP.app.go('/'); }, html: `<img src="/img/logo.svg" alt=""/> Cloud Panel` }),
      h('button', { class: 'btn ghost', html: `${icon('back', 16)} Back`, onclick: () => CP.app.go('/') }));
    const body = h('div', { class: 'legal-doc' },
      h('h1', {}, doc.title),
      h('div', { class: 'legal-updated' }, `Last updated: ${UPDATED}`),
      h('div', { class: 'callout', style: { marginBottom: '24px' } }, doc.note),
      ...doc.sections.map((s) => h('div', {}, h('h2', {}, s.h), ...s.p.map(renderPara))),
      h('div', { class: 'legal-foot' },
        h('a', { onclick: () => CP.app.go('/terms') }, 'Terms'), ' · ',
        h('a', { onclick: () => CP.app.go('/privacy') }, 'Privacy'), ' · ',
        h('a', { onclick: () => CP.app.go('/') }, 'Home')));
    appRoot.appendChild(h('div', { class: 'legal-wrap' }, top, body));
    window.scrollTo(0, 0);
  }

  CP.pages.terms = (appRoot) => render(appRoot, TERMS);
  CP.pages.privacy = (appRoot) => render(appRoot, PRIVACY);
})();
