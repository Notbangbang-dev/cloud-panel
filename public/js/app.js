/* Cloud Panel — App shell & router */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;

  const NAV = [
    { route: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/' },
    { route: 'account', label: 'Account', icon: 'settings', path: '/account' },
  ];
  const ADMIN_NAV = { route: 'admin', label: 'Admin Console', icon: 'shield', path: '/admin' };

  const app = {
    user: null,
    needsSetup: false,
    economyEnabled: false,
    afkEnabled: false,
    achievementsEnabled: false,
    petsEnabled: false,
    bragCardsEnabled: false,
    billing: null,
    needsPlan: false,
    banner: null,
    maintenance: null,
    dailyReward: null,
    ports: { web: 8080, sftp: 5657 },
    brand: { name: 'Cloud Panel', tagline: 'Deploy. Scale. Dominate.' },
    _cleanups: [],
    shell: null,

    go(path) {
      history.pushState({}, '', path);
      this.render();
    },

    logout() {
      CP.api.token = null;
      this.user = null;
      this.shell = null;
      if (CP.appearance && CP.appearance.applyUserPreset) CP.appearance.applyUserPreset(null);
      CP.ui.toast('Signed out', 'info');
      this.go('/login');
    },

    /** Rebuild the shell chrome (sidebar avatar, coins…) after a profile change. */
    refreshChrome() { this.shell = null; this.render(); },

    runCleanups() {
      this._cleanups.forEach((fn) => { try { fn(); } catch {} });
      this._cleanups = [];
    },

    async start() {
      // Discord OAuth redirect lands here with the session token in the URL
      // hash (not the query string — hashes aren't sent to servers or logged).
      try {
        const hash = location.hash || '';
        const tok = hash.match(/(?:^#|&)login_token=([^&]+)/);
        const err = hash.match(/(?:^#|&)login_error=([^&]+)/);
        if (tok) {
          CP.api.token = decodeURIComponent(tok[1]);
          history.replaceState({}, '', location.pathname + location.search);
        } else if (err) {
          history.replaceState({}, '', location.pathname + location.search);
          setTimeout(() => CP.ui.toast(decodeURIComponent(err[1]), 'err', 6000), 200);
        }
      } catch {}

      try {
        const health = await fetch('/api/health').then((r) => r.json());
        if (health.ports) this.ports = health.ports;
        if (health.brand) this.brand = health.brand;
      } catch {}

      try {
        const s = await CP.api.setupStatus();
        this.needsSetup = !!s.needsSetup;
      } catch {}

      // Public banner / maintenance state (works signed-out too).
      try {
        const cfg = await CP.api.authConfig();
        this.banner = cfg.banner || null;
        this.maintenance = cfg.maintenance || null;
      } catch {}

      if (CP.api.token) {
        try {
          const me = await CP.api.me();
          this.user = me.user;
          this.economyEnabled = !!me.economyEnabled;
          this.afkEnabled = !!me.afkEnabled;
          this.achievementsEnabled = !!me.achievementsEnabled;
          this.petsEnabled = !!me.petsEnabled;
          this.bragCardsEnabled = !!me.bragCardsEnabled;
          this.billing = me.billing || null;
          this.needsPlan = !!me.needsPlan;
          this.dailyReward = me.dailyReward || null;
          if (me.banner) this.banner = me.banner;
          if (me.maintenance) this.maintenance = me.maintenance;
          if (CP.appearance && CP.appearance.applyUserPreset) CP.appearance.applyUserPreset(this.user.themePreset);
          // Keep presence fresh (in-memory on the server).
          if (!this._presenceTimer) {
            CP.api.presencePing().catch(() => {});
            this._presenceTimer = setInterval(() => CP.api.presencePing().catch(() => {}), 60000);
          }
        } catch { CP.api.token = null; }
      }

      window.addEventListener('popstate', () => this.render());
      document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-link]');
        if (a) { e.preventDefault(); this.go(a.getAttribute('href')); }
      });
      this.render();
    },

    parse() {
      const segs = location.pathname.split('/').filter(Boolean);
      if (!segs.length) return { route: 'dashboard', params: {} };
      const [head, ...rest] = segs;
      if (head === 'server') return { route: 'server', params: { id: rest[0], tab: rest[1] } };
      if (head === 'admin') return { route: 'admin', params: { tab: rest[0] } };
      if (head === 'account') return { route: 'account', params: {} };
      if (head === 'shop') return { route: 'shop', params: {} };
      if (head === 'afk') return { route: 'afk', params: {} };
      if (head === 'achievements') return { route: 'achievements', params: {} };
      if (head === 'pets') return { route: 'pets', params: {} };
      if (head === 'friends') return { route: 'friends', params: {} };
      if (head === 'billing') return { route: 'billing', params: {} };
      if (head === 'terms') return { route: 'terms', params: {} };
      if (head === 'privacy') return { route: 'privacy', params: {} };
      if (head === 'status') return { route: 'status', params: { slug: rest[0] } };
      if (head === 'login') return { route: 'login', params: {} };
      return { route: 'dashboard', params: {} };
    },

    async render() {
      this.runCleanups();
      this.renderImpersonate();
      this.renderBanner();
      const appRoot = document.getElementById('app');
      const r = this.parse();

      // Public pages — legal + status pages (work signed-in or out, no shell).
      if ((r.route === 'terms' || r.route === 'privacy' || r.route === 'status') && CP.pages[r.route]) {
        this.shell = null;
        const ctx = { params: r.params, onCleanup: (fn) => this._cleanups.push(fn) };
        CP.pages[r.route](appRoot, ctx);
        return;
      }

      // Auth gating
      if (!this.user) {
        this.shell = null;
        if (this.needsSetup && CP.pages.setup) CP.pages.setup(appRoot);
        else CP.pages.login(appRoot);
        return;
      }
      if (r.route === 'login') { this.go('/'); return; }

      // Maintenance mode — non-admins see a notice instead of the panel.
      if (!this.user.admin && this.maintenance && this.maintenance.enabled && CP.pages.maintenance) {
        this.shell = null;
        CP.pages.maintenance(appRoot);
        return;
      }

      // Awaiting-approval / declined users get a dedicated screen (no panel).
      if (!this.user.admin && (this.user.status === 'pending' || this.user.status === 'declined') && CP.pages.pending) {
        this.shell = null;
        CP.pages.pending(appRoot);
        return;
      }

      // Paywall — members must hold a plan (or trial) before using the panel.
      if (this.needsPlan && CP.pages.paywall) {
        this.shell = null;
        CP.pages.paywall(appRoot);
        return;
      }

      if (!this.shell) this.buildShell(appRoot);
      this.setActiveNav(r.route);

      const content = this.shell.content;
      CP.clear(content);
      const ctx = {
        params: r.params,
        onCleanup: (fn) => this._cleanups.push(fn),
        setCrumbs: (list) => this.setCrumbs(list),
      };
      const page = CP.pages[r.route] || CP.pages.dashboard;
      try {
        await page(content, ctx);
      } catch (err) {
        CP.clear(content);
        content.appendChild(CP.empty('alert', err.message || 'Failed to render page'));
      }
      content.parentElement.scrollTop = 0;
    },

    buildShell(appRoot) {
      const u = this.user;

      const navDefs = [{ route: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/' }];
      if (this.economyEnabled) navDefs.push({ route: 'shop', label: 'Shop', icon: 'cart', path: '/shop' });
      if (this.afkEnabled) navDefs.push({ route: 'afk', label: 'AFK', icon: 'coin', path: '/afk' });
      if (this.achievementsEnabled) navDefs.push({ route: 'achievements', label: 'Achievements', icon: 'zap', path: '/achievements' });
      if (this.petsEnabled) navDefs.push({ route: 'pets', label: 'Pets', icon: 'rocket', path: '/pets' });
      if (this.billing && this.billing.mode !== 'free') navDefs.push({ route: 'billing', label: 'Plans', icon: 'cart', path: '/billing' });
      navDefs.push({ route: 'friends', label: 'Friends', icon: 'users', path: '/friends' });
      navDefs.push({ route: 'account', label: 'Account', icon: 'settings', path: '/account' });
      const navItems = navDefs.map((n) =>
        h('div', { class: 'nav-item', dataset: { route: n.route }, html: `${icon(n.icon, 18)}<span>${n.label}</span>`, onclick: () => this.go(n.path) }));
      if (u.admin)
        navItems.push(h('div', { class: 'nav-item', dataset: { route: 'admin' }, html: `${icon(ADMIN_NAV.icon, 18)}<span>${ADMIN_NAV.label}</span>`, onclick: () => this.go(ADMIN_NAV.path) }));

      const coinsEl = h('div', { class: 'coins-chip', onclick: () => this.go('/shop') });
      const renderCoins = () => { coinsEl.innerHTML = `${icon('coin', 16)} <b>${(this.user.coins || 0).toLocaleString()}</b> <span>coins</span>`; };
      renderCoins();

      const sidebar = h('aside', { class: 'sidebar' },
        h('div', { class: 'brand', style: { cursor: 'pointer' }, title: 'Go to Dashboard', role: 'button', tabindex: '0',
          onclick: () => this.go('/'),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.go('/'); } } },
          h('img', { src: '/img/logo.svg', alt: '' }),
          h('div', {}, h('div', { class: 'name' }, this.brand.name), h('div', { class: 'tag' }, 'Control Panel'))),
        h('div', { class: 'nav-label' }, 'Navigation'),
        ...navItems,
        h('div', { class: 'spacer' }),
        this.economyEnabled ? coinsEl : null,
        h('div', { class: 'side-user', onclick: () => this.go('/account') },
          u.avatar
            ? h('img', { class: 'avatar', src: u.avatar, alt: '', style: { objectFit: 'cover' } })
            : h('div', { class: 'avatar', style: { background: 'var(--surface-2)', color: 'var(--muted)' }, html: icon('user', 20) }),
          h('div', { class: 'meta' }, h('b', {}, u.username), h('span', {}, u.email)),
          h('span', { class: 'btn ghost icon', title: 'Sign out', html: icon('logout', 16), onclick: (e) => { e.stopPropagation(); this.logout(); } }))
      );

      const crumbs = h('div', { class: 'crumbs' });
      const search = h('input', { placeholder: 'Jump to a server…' });
      search.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || !search.value.trim()) return;
        try {
          const list = (await CP.api.get('/servers')).data;
          const q = search.value.toLowerCase();
          const hit = list.find((s) => s.name.toLowerCase().includes(q) || (s.allocation && s.allocation.notation.includes(q)));
          if (hit) { search.value = ''; this.go(`/server/${hit.id}`); }
          else CP.ui.toast('No matching server', 'err');
        } catch (err) { CP.ui.toast(err.message, 'err'); }
      });

      const menuBtn = h('button', { class: 'btn ghost icon menu-btn', html: icon('menu', 18), onclick: () => sidebar.classList.toggle('open') });

      const topbar = h('header', { class: 'topbar' },
        menuBtn, crumbs, h('div', { class: 'grow' }),
        h('div', { class: 'search' }, h('span', { html: icon('search', 16) }), search));

      const content = h('div', { class: 'content' });
      const main = h('main', { class: 'main' }, topbar, content);
      const shellEl = h('div', { class: 'shell' }, sidebar, main);

      CP.clear(appRoot).appendChild(shellEl);
      this.shell = { sidebar, content, crumbs, navItems: sidebar.querySelectorAll('.nav-item'), renderCoins };
    },

    /** Update the cached coin balance + sidebar chip (called by shop/dashboard). */
    setCoins(n) {
      if (this.user) this.user.coins = n;
      if (this.shell && this.shell.renderCoins) this.shell.renderCoins();
    },

    /** Admin "view as user" bar — restores the admin session on exit. */
    renderImpersonate() {
      const el = document.getElementById('cp-impersonate');
      if (!el) return;
      const adminTok = sessionStorage.getItem('cp_imp_admin');
      if (!adminTok) { el.style.display = 'none'; CP.clear(el); return; }
      const name = sessionStorage.getItem('cp_imp_name') || 'user';
      CP.clear(el);
      el.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 16px;font-size:13px;font-weight:600;background:rgba(248,113,113,.16);color:#fca5a5;border-bottom:1px solid rgba(248,113,113,.5);position:relative;z-index:61;';
      el.appendChild(h('span', {}, `👁 Viewing as ${name}`));
      el.appendChild(h('button', { class: 'btn sm', onclick: () => this.exitImpersonation() }, 'Exit'));
    },

    exitImpersonation() {
      const adminTok = sessionStorage.getItem('cp_imp_admin');
      sessionStorage.removeItem('cp_imp_admin');
      sessionStorage.removeItem('cp_imp_name');
      if (adminTok) CP.api.token = adminTok;
      location.href = '/admin/users';
    },

    /** Render (or hide) the global broadcast banner above everything. */
    renderBanner() {
      const el = document.getElementById('cp-banner');
      if (!el) return;
      const b = this.banner;
      if (!b || !b.enabled || !b.text) { el.style.display = 'none'; el.textContent = ''; return; }
      const palette = {
        info: { bg: 'rgba(34,211,238,.12)', fg: '#a5f3fc', bd: 'rgba(34,211,238,.35)' },
        warn: { bg: 'rgba(253,224,71,.12)', fg: '#fde68a', bd: 'rgba(253,224,71,.4)' },
        success: { bg: 'rgba(52,211,153,.12)', fg: '#86efac', bd: 'rgba(52,211,153,.35)' },
        danger: { bg: 'rgba(248,113,113,.12)', fg: '#fca5a5', bd: 'rgba(248,113,113,.45)' },
      };
      const p = palette[b.style] || palette.info;
      el.textContent = b.text; // text node — safe from HTML injection
      el.style.cssText =
        'display:block;text-align:center;padding:9px 18px;font-size:13px;font-weight:600;' +
        `background:${p.bg};color:${p.fg};border-bottom:1px solid ${p.bd};position:relative;z-index:60;`;
    },

    setActiveNav(route) {
      if (!this.shell) return;
      this.shell.navItems.forEach((el) =>
        el.classList.toggle('active', el.dataset.route === route || (route === 'server' && el.dataset.route === 'dashboard')));
      this.shell.sidebar.classList.remove('open');
    },

    setCrumbs(list) {
      const c = this.shell.crumbs;
      CP.clear(c);
      c.appendChild(h('span', { html: icon('chevron', 0) }));
      list.forEach((item, i) => {
        if (i) c.appendChild(h('span', { class: 'sep' }, '/'));
        if (item.href) c.appendChild(h('a', { style: { cursor: 'pointer', color: 'var(--cyan)' }, onclick: () => this.go(item.href) }, item.label));
        else c.appendChild(h('b', {}, item.label));
      });
    },
  };

  CP.app = app;
  document.addEventListener('DOMContentLoaded', () => app.start());
})();
