/* Cloud Panel — API client */
(function () {
  'use strict';
  const CP = (window.CP = window.CP || {});
  const TOKEN_KEY = 'cp_token';

  const api = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },

    async request(method, path, body) {
      const headers = {};
      if (this.token) headers.Authorization = 'Bearer ' + this.token;
      const opts = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch('/api' + path, opts);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (res.status === 401 && path !== '/auth/login') {
        api.token = null;
        if (CP.app) CP.app.go('/login');
      }
      if (!res.ok) throw new Error(data.error || data.raw || `Request failed (${res.status})`);
      return data;
    },
    get(p) { return this.request('GET', p); },
    post(p, b) { return this.request('POST', p, b || {}); },
    put(p, b) { return this.request('PUT', p, b || {}); },
    del(p) { return this.request('DELETE', p); },

    /* raw text (file contents) */
    async text(path) {
      const res = await fetch('/api' + path, { headers: this.token ? { Authorization: 'Bearer ' + this.token } : {} });
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      return res.text();
    },

    /* auth */
    login(login, password) { return this.post('/auth/login', { login, password }); },
    me() { return this.get('/auth/me'); },

    /* first-run setup */
    setupStatus() { return this.get('/setup/status'); },
    setup(payload) { return this.post('/setup', payload); },

    /* registration / config */
    authConfig() { return this.get('/auth/config'); },
    register(payload) { return this.post('/auth/register', payload); },

    /* economy & self-service */
    accountResources() { return this.get('/account/resources'); },
    eggs() { return this.get('/eggs'); },
    createServer(payload) { return this.post('/servers', payload); },
    shop() { return this.get('/shop'); },
    shopBuy(resource, quantity) { return this.post('/shop/buy', { resource, quantity }); },
    afkInfo() { return this.get('/afk'); },
    afkHeartbeat(sid) { return this.post('/afk/heartbeat', { sid }); },

    /* admin economy/access */
    adminSettings() { return this.get('/admin/settings'); },
    adminUpdateSettings(patch) { return this.put('/admin/settings', patch); },
    adminApprove(id) { return this.post(`/admin/users/${id}/approve`); },
    adminDecline(id) { return this.post(`/admin/users/${id}/decline`); },
    adminCoins(id, amount) { return this.post(`/admin/users/${id}/coins`, { amount }); },

    /* console websocket */
    consoleSocket(serverId, onMessage) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/servers/${serverId}/ws?token=${encodeURIComponent(this.token)}`);
      ws.addEventListener('message', (ev) => {
        try { onMessage(JSON.parse(ev.data)); } catch {}
      });
      return ws;
    },
  };

  CP.api = api;
})();
