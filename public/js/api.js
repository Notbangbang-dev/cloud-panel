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
    /* short-lived scoped ticket for URL-based auth (WS console / downloads) */
    async ticket(scope) { return (await this.post('/tickets', { scope })).ticket; },
    async downloadBackup(serverId, bid) {
      const t = await this.ticket('download');
      window.open(`/api/dl/backups/${encodeURIComponent(serverId)}/${encodeURIComponent(bid)}?ticket=${encodeURIComponent(t)}`, '_blank');
    },

    /* subusers */
    serverSubusers(sid) { return this.get(`/servers/${sid}/subusers`); },
    addSubuser(sid, identifier, permissions) { return this.post(`/servers/${sid}/subusers`, { identifier, permissions }); },
    updateSubuser(sid, suid, permissions) { return this.put(`/servers/${sid}/subusers/${suid}`, { permissions }); },
    deleteSubuser(sid, suid) { return this.del(`/servers/${sid}/subusers/${suid}`); },

    /* scheduled tasks (cron) */
    schedules(sid) { return this.get(`/servers/${sid}/schedules`); },
    createSchedule(sid, body) { return this.post(`/servers/${sid}/schedules`, body); },
    updateSchedule(sid, scid, body) { return this.put(`/servers/${sid}/schedules/${scid}`, body); },
    deleteSchedule(sid, scid) { return this.del(`/servers/${sid}/schedules/${scid}`); },

    /* per-server databases */
    databases(sid) { return this.get(`/servers/${sid}/databases`); },
    createDatabase(sid, body) { return this.post(`/servers/${sid}/databases`, body); },
    rotateDatabase(sid, dbid) { return this.post(`/servers/${sid}/databases/${dbid}/rotate`); },
    deleteDatabase(sid, dbid) { return this.del(`/servers/${sid}/databases/${dbid}`); },

    /* plugin / mod browser (Modrinth) */
    pluginSearch(sid, q, version) { return this.get(`/servers/${sid}/plugins/search?q=${encodeURIComponent(q || '')}${version ? `&version=${encodeURIComponent(version)}` : ''}`); },
    pluginVersions(sid, project, version) { return this.get(`/servers/${sid}/plugins/versions/${encodeURIComponent(project)}${version ? `?version=${encodeURIComponent(version)}` : ''}`); },
    pluginInstalled(sid) { return this.get(`/servers/${sid}/plugins/installed`); },
    pluginInstall(sid, projectId, versionId) { return this.post(`/servers/${sid}/plugins/install`, { projectId, versionId }); },

    /* live player list */
    players(sid) { return this.get(`/servers/${sid}/players`); },
    playersRefresh(sid) { return this.post(`/servers/${sid}/players/refresh`); },
    kickPlayer(sid, name, reason) { return this.post(`/servers/${sid}/players/${encodeURIComponent(name)}/kick`, { reason }); },
    banPlayer(sid, name, reason) { return this.post(`/servers/${sid}/players/${encodeURIComponent(name)}/ban`, { reason }); },

    /* historical metrics */
    serverMetrics(sid, range) { return this.get(`/servers/${sid}/metrics?range=${range || 86400}`); },

    /* per-server console appearance */
    saveConsole(sid, cfg) { return this.put(`/servers/${sid}/console`, cfg); },

    /* public status page (config) */
    statusPageConfig(sid) { return this.get(`/servers/${sid}/statuspage`); },
    saveStatusPage(sid, body) { return this.put(`/servers/${sid}/statuspage`, body); },

    /* two-factor authentication */
    twoFactor() { return this.get('/account/2fa'); },
    twoFactorSetup() { return this.post('/account/2fa/setup'); },
    twoFactorEnable(token) { return this.post('/account/2fa/enable', { token }); },
    twoFactorDisable(password) { return this.post('/account/2fa/disable', { password }); },
    login2fa(ticket, token) { return this.post('/auth/2fa', { ticket, token }); },

    /* admin: database hosts */
    adminDatabaseHosts() { return this.get('/admin/database-hosts'); },
    adminAddDatabaseHost(body) { return this.post('/admin/database-hosts', body); },
    adminUpdateDatabaseHost(id, body) { return this.put(`/admin/database-hosts/${id}`, body); },
    adminDeleteDatabaseHost(id) { return this.del(`/admin/database-hosts/${id}`); },
    adminTestDatabaseHost(id) { return this.post(`/admin/database-hosts/${id}/test`); },

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
    buildServer(sid, body) { return this.put(`/servers/${sid}/build`, body); },
    shop() { return this.get('/shop'); },
    shopBuy(resource, quantity) { return this.post('/shop/buy', { resource, quantity }); },
    afkInfo() { return this.get('/afk'); },
    afkHeartbeat(sid) { return this.post('/afk/heartbeat', { sid }); },
    dailyInfo() { return this.get('/account/daily'); },
    dailyClaim() { return this.post('/account/daily/claim'); },

    /* per-user theme + profile picture */
    appearancePresets() { return this.get('/appearance/presets'); },
    accountTheme(preset) { return this.put('/account/theme', { preset }); },
    deleteAvatar() { return this.del('/account/avatar'); },
    async uploadAvatar(file) {
      const res = await fetch('/api/account/avatar?filename=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
        body: file,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Upload failed (${res.status})`);
      return d.data;
    },

    /* achievements & pets */
    achievements() { return this.get('/achievements'); },
    pets() { return this.get('/pets'); },
    petBuy(petId) { return this.post('/pets/buy', { petId }); },
    petActive(petId) { return this.put('/pets/active', { petId }); },

    /* billing / paid plans */
    billing() { return this.get('/billing'); },
    billingCheckout(planId) { return this.post('/billing/checkout', { planId, origin: location.origin }); },
    billingConfirm(sessionId) { return this.post('/billing/confirm', { sessionId }); },
    billingTrial(planId) { return this.post('/billing/trial', { planId }); },

    /* friends & presence */
    friends() { return this.get('/friends'); },
    friendRequest(username) { return this.post('/friends/request', { username }); },
    friendAccept(id) { return this.post('/friends/accept', { id }); },
    friendDecline(id) { return this.post('/friends/decline', { id }); },
    friendRemove(id) { return this.del(`/friends/${id}`); },
    presencePing() { return this.post('/presence/ping'); },

    /* admin economy/access */
    adminSettings() { return this.get('/admin/settings'); },
    adminAchievements() { return this.get('/admin/achievements'); },
    adminAddAchievement(body) { return this.post('/admin/achievements', body); },
    adminDeleteAchievement(id) { return this.del(`/admin/achievements/${id}`); },
    adminAnalytics() { return this.get('/admin/analytics'); },
    adminImpersonate(id) { return this.post(`/admin/users/${id}/impersonate`); },
    adminResetIp(id) { return this.post(`/admin/users/${id}/reset-ip`); },
    adminCreateEgg(body) { return this.post('/admin/eggs', body); },
    adminUpdateEgg(id, body) { return this.put(`/admin/eggs/${id}`, body); },
    adminDeleteEgg(id) { return this.del(`/admin/eggs/${id}`); },
    adminBilling() { return this.get('/admin/billing'); },
    adminUpdateBilling(cfg) { return this.put('/admin/billing', cfg); },
    adminCreatePlan(body) { return this.post('/admin/plans', body); },
    adminUpdatePlan(id, body) { return this.put(`/admin/plans/${id}`, body); },
    adminDeletePlan(id) { return this.del(`/admin/plans/${id}`); },
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

    /* console websocket — authed with a short-lived 'console' ticket (fetched
       first), never the session token. Returns a wrapper with close(). */
    consoleSocket(serverId, onMessage) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws = null;
      let closed = false;
      this.ticket('console')
        .then((t) => {
          if (closed) return;
          ws = new WebSocket(`${proto}://${location.host}/api/servers/${serverId}/ws?ticket=${encodeURIComponent(t)}`);
          ws.addEventListener('message', (ev) => { try { onMessage(JSON.parse(ev.data)); } catch {} });
        })
        .catch(() => { try { onMessage({ event: 'error', message: 'Could not authorize the console.' }); } catch {} });
      return { close() { closed = true; if (ws) { try { ws.close(); } catch {} } } };
    },
  };

  CP.api = api;
})();
