/* Cloud Panel — Appearance runtime
   Image/gif/color/gradient themes are applied with zero JS via the
   /api/appearance.css stylesheet linked in index.html. This module adds the
   pieces CSS can't do on its own: video backgrounds + the admin live-preview. */
(function () {
  'use strict';
  const CP = (window.CP = window.CP || {});
  const A = {};
  let current = null;

  /* Inject / update / remove the fixed full-screen <video> background. */
  function applyVideo(app) {
    const bg = (app && app.background) || {};
    let v = document.getElementById('cp-bg-video');
    if (bg.type === 'video' && bg.value) {
      if (!v) {
        v = document.createElement('video');
        v.id = 'cp-bg-video';
        v.className = 'cp-bg-video';
        v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        document.body.appendChild(v);
      }
      if (v.getAttribute('src') !== bg.value) {
        v.setAttribute('src', bg.value);
        try { v.load(); v.play && v.play().catch(() => {}); } catch (e) {}
      }
    } else if (v) {
      v.remove();
    }
  }

  /* Apply a full appearance document (video is the only runtime bit). */
  A.apply = function (app) { current = app || null; applyVideo(current); };

  /* Fetch the saved, public appearance and apply it. */
  A.load = async function () {
    try {
      const r = await fetch('/api/appearance.json', { cache: 'no-store' });
      const d = await r.json();
      A.apply(d.appearance || d);
      A.applySeasonal(d.season || null);
      return d;
    } catch (e) { return null; }
  };

  /* ---- Seasonal particle overlay (snow / embers / confetti) ---- */
  const SEASON_CFG = {
    winter: { n: 80, color: '#ffffff', dir: 1, shape: 'circle', size: [1, 3], speed: [0.4, 1.4], sway: 1 },
    christmas: { n: 80, color: '#ffffff', dir: 1, shape: 'circle', size: [1, 3], speed: [0.4, 1.4], sway: 1 },
    halloween: { n: 55, color: '#fb923c', dir: -1, shape: 'circle', size: [1, 3], speed: [0.3, 1.1], sway: 0.8 },
    newyear: { n: 70, colors: ['#fde047', '#a855f7', '#22d3ee', '#f43f5e', '#4ade80'], dir: 1, shape: 'rect', size: [2, 5], speed: [1, 2.6], sway: 1.6 },
  };
  A.applySeasonal = function (season) {
    if (A._seasonRAF) { cancelAnimationFrame(A._seasonRAF); A._seasonRAF = null; }
    if (A._seasonCleanup) { A._seasonCleanup(); A._seasonCleanup = null; }
    let cv = document.getElementById('cp-seasonal');
    const cfg = season && SEASON_CFG[season];
    // Respect reduced-motion and unknown/off seasons by showing nothing.
    if (!cfg || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { if (cv) cv.remove(); return; }
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'cp-seasonal';
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:55;';
      document.body.appendChild(cv);
    }
    const ctx = cv.getContext('2d');
    let W, H;
    const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    A._seasonCleanup = () => window.removeEventListener('resize', onResize);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const parts = Array.from({ length: cfg.n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: rnd(cfg.size[0], cfg.size[1]), s: rnd(cfg.speed[0], cfg.speed[1]), a: Math.random() * Math.PI * 2,
      c: cfg.colors ? cfg.colors[Math.floor(Math.random() * cfg.colors.length)] : cfg.color,
    }));
    function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.8;
      for (const p of parts) {
        p.y += p.s * cfg.dir; p.a += 0.02; p.x += Math.sin(p.a) * cfg.sway;
        if (cfg.dir > 0 && p.y > H + 6) { p.y = -6; p.x = Math.random() * W; }
        if (cfg.dir < 0 && p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
        if (p.x < -6) p.x = W + 6; else if (p.x > W + 6) p.x = -6;
        ctx.fillStyle = p.c;
        if (cfg.shape === 'rect') ctx.fillRect(p.x, p.y, p.r, p.r * 1.6);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      A._seasonRAF = requestAnimationFrame(frame);
    }
    frame();
  };

  /* Cache-bust the global stylesheet so a freshly-saved theme shows at once. */
  A.reloadGlobal = function () {
    const link = document.getElementById('cp-appearance');
    if (link) link.setAttribute('href', '/api/appearance.css?v=' + Date.now());
  };

  /* ---- Admin live preview ---- */
  function previewStyle() {
    let el = document.getElementById('cp-appearance-preview');
    if (!el) {
      el = document.createElement('style');
      el.id = 'cp-appearance-preview';
      document.head.appendChild(el); // after #cp-appearance link → wins the cascade
    }
    return el;
  }
  /* Show an unsaved draft: css = stylesheet text, draft = doc (for video). */
  A.preview = function (css, draft) {
    previewStyle().textContent = css || '';
    applyVideo(draft);
  };
  /* Drop the preview and restore whatever is currently saved on the server. */
  A.clearPreview = function () {
    const el = document.getElementById('cp-appearance-preview');
    if (el) el.remove();
    A.load();
  };

  /* ---- Per-user theme ----
     Links a single preset's stylesheet AFTER the global theme so it wins the
     cascade. Pass a falsy id to fall back to the panel/admin theme. */
  A.applyUserPreset = function (presetId) {
    let link = document.getElementById('cp-user-theme');
    if (!presetId) { if (link) link.remove(); return; }
    if (!link) {
      link = document.createElement('link');
      link.id = 'cp-user-theme';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.setAttribute('href', '/api/appearance/preset/' + encodeURIComponent(presetId));
  };

  CP.appearance = A;
  document.addEventListener('DOMContentLoaded', () => A.load());
})();
