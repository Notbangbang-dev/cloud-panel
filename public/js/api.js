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

    /* streamed file upload with progress (XHR) */
    upload(serverId, relPath, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/servers/${serverId}/files/upload?path=${encodeURIComponent(relPath)}`);
        if (this.token) xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText || '{}')); } catch { resolve({}); } }
          else { let m = `Upload failed (${xhr.status})`; try { m = JSON.parse(xhr.responseText).error || m; } catch {} reject(new Error(m)); }
        };
        xhr.onerror = () => reject(new Error('Upload failed (network error)'));
        xhr.send(file);
      });
    },
    unzip(serverId, path) { return this.post(`/servers/${serverId}/files/unzip`, { path }); },

    /* console automations */
    serverAutomations(sid) { return this.get(`/servers/${sid}/automations`); },
    createAutomation(sid, rule) { return this.post(`/servers/${sid}/automations`, rule); },
    updateAutomation(sid, aid, rule) { return this.put(`/servers/${sid}/automations/${aid}`, rule); },
    deleteAutomation(sid, aid) { return this.del(`/servers/${sid}/automations/${aid}`); },
    testAutomation(sid, rule, line) { return this.post(`/servers/${sid}/automations/test`, { rule, line }); },

    /* backups */
    backups(serverId) { return this.get(`/servers/${serverId}/backups`); },
    createBackup(serverId, name) { return this.post(`/servers/${serverId}/backups`, { name }); },
    restoreBackup(serverId, bid) { return this.post(`/servers/${serverId}/backups/${bid}/restore`); },
    deleteBackup(serverId, bid) { return this.del(`/servers/${serverId}/backups/${bid}`); },
    backupDownloadUrl(serverId, bid) { return `/api/servers/${serverId}/backups/${bid}/download?token=${encodeURIComponent(this.token || '')}`; },

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

    /* admin appearance / theming */
    adminAppearance() { return this.get('/admin/appearance'); },
    adminSaveAppearance(appearance) { return this.put('/admin/appearance', { appearance }); },
    adminResetAppearance() { return this.post('/admin/appearance/reset'); },
    async adminPreviewAppearance(appearance) {
      const res = await fetch('/api/admin/appearance/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
        body: JSON.stringify({ appearance }),
      });
      if (!res.ok) { let m = 'Preview failed'; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      return res.text();
    },
    async adminUploadAppearance(file) {
      const res = await fetch('/api/admin/appearance/upload?filename=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
        body: file,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Upload failed (${res.status})`);
      return d.data;
    },

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
