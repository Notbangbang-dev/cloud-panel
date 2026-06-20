/* Cloud Panel — UI helpers (global: window.CP) */
(function () {
  'use strict';
  const CP = (window.CP = window.CP || {});

  /* ---- Hyperscript ---- */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function')
          el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  CP.h = h;
  CP.clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  CP.esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---- Icons (feather-style, 24x24 stroke) ---- */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    server: '<rect x="2" y="3" width="20" height="6" rx="1.5"/><rect x="2" y="13" width="20" height="6" rx="1.5"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="16" x2="6.01" y2="16"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><line x1="12" y1="12" x2="12" y2="8"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
    drive: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    restart: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    folderOpen: '<path d="M6 14l1.5-2.5h11L17 14"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.7c0-1 1.1-1.7 2.4-1.7s2.4.7 2.4 1.7M14.4 14.3c0 1-1.1 1.7-2.4 1.7s-2.4-.7-2.4-1.7M12 6.6v10.8"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0z"/><path d="M12 15l-3-3a22 22 0 0 1 8-10c3 0 5 2 5 5a22 22 0 0 1-10 8z"/><path d="M9 12H4s.5-3 2-4 5 0 5 0"/><path d="M12 15v5s3-.5 4-2 0-5 0-5"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.7 0 3-1.3 3-3 0-.8-.3-1.4-.8-2-.5-.5-.8-1.2-.8-2 0-1.7 1.3-3 3-3h1.8c2.2 0 3.8-1.8 3.8-4 0-4.4-4.5-8-10-8z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  };
  CP.icon = (name, size = 20, cls = '') =>
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;

  /* ---- Formatters ---- */
  CP.fmt = {
    bytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return n + ' B';
      const u = ['KB', 'MB', 'GB', 'TB'];
      let i = -1;
      do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
      return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
    },
    mib(mb) { return CP.fmt.bytes((Number(mb) || 0) * 1024 * 1024); },
    duration(ms) {
      let s = Math.floor((Number(ms) || 0) / 1000);
      if (s <= 0) return '0s';
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      return [d && d + 'd', h && h + 'h', m && m + 'm', (s || (!d && !h && !m)) && s + 's'].filter(Boolean).slice(0, 2).join(' ');
    },
    date(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } },
    rel(iso) {
      const diff = Date.now() - new Date(iso).getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    },
  };

  /* ---- ANSI → HTML ---- */
  const ANSI = { 30: '#5c6788', 31: '#fca5a5', 32: '#86efac', 33: '#fde047', 34: '#93c5fd', 35: '#d8b4fe', 36: '#67e8f9', 37: '#e7ecf6', 90: '#8a97b4', 91: '#fca5a5', 92: '#86efac', 93: '#fde047', 94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff' };
  CP.ansiToHtml = function (text) {
    let out = '';
    let color = null, bold = false, open = false;
    const re = /\u001b\[([0-9;]*)m/g;
    let last = 0, m;
    const seg = (t) => {
      if (!t) return;
      let safe = CP.esc(t);
      if (color || bold) {
        out += `<span style="${color ? 'color:' + color + ';' : ''}${bold ? 'font-weight:700;' : ''}">${safe}</span>`;
      } else out += safe;
    };
    while ((m = re.exec(text))) {
      seg(text.slice(last, m.index));
      last = re.lastIndex;
      for (const codeStr of m[1].split(';')) {
        const code = parseInt(codeStr || '0', 10);
        if (code === 0) { color = null; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (ANSI[code]) color = ANSI[code];
      }
    }
    seg(text.slice(last));
    return out;
  };

  /* ---- Sparkline ---- */
  CP.sparkline = function (canvas, data, color) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 160, hgt = canvas.clientHeight || 40;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    if (!data.length) return;
    const max = Math.max(...data, 1), min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = w / Math.max(data.length - 1, 1);
    const y = (v) => hgt - 3 - ((v - min) / range) * (hgt - 6);
    const grad = ctx.createLinearGradient(0, 0, 0, hgt);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    data.forEach((v, i) => { const px = i * step, py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.lineTo((data.length - 1) * step, hgt); ctx.lineTo(0, hgt); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => { const px = i * step, py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  };

  /* ---- Area chart (historical metrics) ---- */
  CP.areaChart = function (canvas, points, opts) {
    opts = opts || {};
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width || canvas.clientWidth || 600));
    const hgt = Math.max(2, Math.round(rect.height || canvas.clientHeight || 170));
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const padL = 8, padR = 10, padT = 12, padB = 14;
    const innerH = hgt - padT - padB, innerW = w - padL - padR;
    const color = opts.color || '#22d3ee';

    // gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const gy = padT + innerH * i / 3; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke(); }

    const vals = (points || []).map((p) => (opts.value ? opts.value(p) : p)).filter((v) => typeof v === 'number' && !isNaN(v));
    if (!vals.length) {
      ctx.fillStyle = 'rgba(160,170,200,0.55)';
      ctx.font = '13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.empty || 'No data yet', w / 2, hgt / 2);
      return;
    }
    const max = opts.max != null ? opts.max : Math.max(...vals, 1);
    const range = max || 1;
    const X = (i) => padL + (vals.length === 1 ? innerW / 2 : innerW * i / (vals.length - 1));
    const Y = (v) => padT + innerH - Math.max(0, Math.min(1, v / range)) * innerH;

    const grad = ctx.createLinearGradient(0, padT, 0, hgt - padB);
    grad.addColorStop(0, color + '66'); grad.addColorStop(1, color + '05');
    ctx.beginPath();
    vals.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(X(vals.length - 1), hgt - padB); ctx.lineTo(X(0), hgt - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    vals.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    if (vals.length === 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(0), Y(vals[0]), 3, 0, Math.PI * 2); ctx.fill(); }

    if (opts.fmtMax) {
      ctx.fillStyle = 'rgba(170,180,205,0.7)'; ctx.font = '11px var(--mono, monospace)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(opts.fmtMax(max), padL + 2, padT);
    }
  };

  /* ---- Toasts ---- */
  CP.ui = CP.ui || {};
  CP.ui.toast = function (message, type = 'info', ms = 3600) {
    const root = document.getElementById('toasts');
    const ico = { ok: 'check', err: 'alert', info: 'info' }[type] || 'info';
    const t = h('div', { class: `toast ${type}` },
      h('span', { class: 'ic', html: CP.icon(ico, 20) }),
      h('div', {}, message)
    );
    root.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
  };

  /* ---- Modal ---- */
  CP.ui.modal = function ({ title, body, footer, size }) {
    const root = document.getElementById('modal-root');
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const modal = h('div', { class: 'modal' + (size === 'lg' ? ' lg' : '') },
      h('div', { class: 'modal-head' },
        h('h3', {}, title || ''),
        h('span', { class: 'x', html: CP.icon('x', 20), onclick: close })
      ),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null
    );
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, modal);
    root.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    return { close, modal, backdrop };
  };

  CP.ui.confirm = function ({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = true }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; ref.close(); resolve(v); };
      const ref = CP.ui.modal({
        title,
        body: h('p', { class: 'muted', style: { margin: 0, lineHeight: '1.6' } }, message),
        footer: [
          h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'red' : 'primary'), onclick: () => finish(true) }, confirmText),
        ],
      });
      ref.backdrop.addEventListener('click', (e) => { if (e.target === ref.backdrop) finish(false); });
    });
  };

  CP.ui.prompt = function ({ title = 'Input', label = '', value = '', placeholder = '', confirmText = 'Save' }) {
    return new Promise((resolve) => {
      const input = h('input', { value, placeholder });
      const finish = (v) => { ref.close(); resolve(v); };
      const ref = CP.ui.modal({
        title,
        body: h('label', { class: 'field' }, h('span', {}, label), input),
        footer: [
          h('button', { class: 'btn ghost', onclick: () => finish(null) }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => finish(input.value) }, confirmText),
        ],
      });
      setTimeout(() => input.focus(), 50);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(input.value); });
    });
  };

  CP.copy = function (text, msg = 'Copied to clipboard') {
    navigator.clipboard?.writeText(text).then(
      () => CP.ui.toast(msg, 'ok'),
      () => CP.ui.toast('Copy failed', 'err')
    );
  };

  CP.bar = (label, used, max, cls) => {
    const pct = max ? Math.min(100, (used / max) * 100) : 0;
    return h('div', { class: 'metric' },
      h('div', { class: 'lab' }, h('span', {}, label), h('b', {}, typeof used === 'string' ? used : `${Math.round(pct)}%`)),
      h('div', { class: 'bar ' + (cls || ''), html: `<i style="width:${pct}%"></i>` })
    );
  };

  CP.statusPill = (status) =>
    h('span', { class: 'status ' + status, html: `<span class="dot"></span>${status}` });

  CP.spinner = (text = 'Loading…') =>
    h('div', { class: 'loading-row' }, h('div', { class: 'spinner' }), text);

  CP.empty = (icon, text) =>
    h('div', { class: 'empty' }, h('div', { html: CP.icon(icon, 46) }), h('div', {}, text));
})();
