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
      CP.ui.toast('Signed out', 'info');
      this.go('/login');
    },

    runCleanups() {
      this._cleanups.forEach((fn) => { try { fn(); } catch {} });
      this._cleanups = [];
    },

    async start() {
      try {
        const health = await fetch('/api/health').then((r) => r.json());
        if (health.ports) this.ports = health.ports;
        if (health.brand) this.brand = health.brand;
      } catch {}

      try {
        const s = await CP.api.setupStatus();
        this.needsSetup = !!s.needsSetup;
      } catch {}

      if (CP.api.token) {
        try {
          const me = await CP.api.me();
          this.user = me.user;
          this.economyEnabled = !!me.economyEnabled;
          this.afkEnabled = !!me.afkEnabled;
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
      if (head === 'terms') return { route: 'terms', params: {} };
      if (head === 'privacy') return { route: 'privacy', params: {} };
      if (head === 'login') return { route: 'login', params: {} };
      return { route: 'dashboard', params: {} };
    },

    async render() {
      this.runCleanups();
      const appRoot = document.getElementById('app');
      const r = this.parse();

      // Legal pages are public (work signed-in or out, no shell).
      if ((r.route === 'terms' || r.route === 'privacy') && CP.pages[r.route]) {
        this.shell = null;
        CP.pages[r.route](appRoot);
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

      // Awaiting-approval / declined users get a dedicated screen (no panel).
      if (!this.user.admin && (this.user.status === 'pending' || this.user.status === 'declined') && CP.pages.pending) {
        this.shell = null;
        CP.pages.pending(appRoot);
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
      const initials = ((u.firstName || u.username || '?')[0] + (u.lastName || '')[0] || (u.username || '?')[0]).toUpperCase();

      const navDefs = [{ route: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/' }];
      if (this.economyEnabled) navDefs.push({ route: 'shop', label: 'Shop', icon: 'cart', path: '/shop' });
      if (this.afkEnabled) navDefs.push({ route: 'afk', label: 'AFK', icon: 'coin', path: '/afk' });
      navDefs.push({ route: 'account', label: 'Account', icon: 'settings', path: '/account' });
      const navItems = navDefs.map((n) =>
        h('div', { class: 'nav-item', dataset: { route: n.route }, html: `${icon(n.icon, 18)}<span>${n.label}</span>`, onclick: () => this.go(n.path) }));
      if (u.admin)
        navItems.push(h('div', { class: 'nav-item', dataset: { route: 'admin' }, html: `${icon(ADMIN_NAV.icon, 18)}<span>${ADMIN_NAV.label}</span>`, onclick: () => this.go(ADMIN_NAV.path) }));

      const coinsEl = h('div', { class: 'coins-chip', onclick: () => this.go('/shop') });
      const renderCoins = () => { coinsEl.innerHTML = `${icon('coin', 16)} <b>${(this.user.coins || 0).toLocaleString()}</b> <span>coins</span>`; };
      renderCoins();

      const sidebar = h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' },
          h('img', { src: '/img/logo.svg', alt: '' }),
          h('div', {}, h('div', { class: 'name' }, this.brand.name), h('div', { class: 'tag' }, 'Control Panel'))),
        h('div', { class: 'nav-label' }, 'Navigation'),
        ...navItems,
        h('div', { class: 'spacer' }),
        this.economyEnabled ? coinsEl : null,
        h('div', { class: 'side-user', onclick: () => this.go('/account') },
          h('div', { class: 'avatar' }, initials),
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
