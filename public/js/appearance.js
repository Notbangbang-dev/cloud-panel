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
      return d;
    } catch (e) { return null; }
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

  CP.appearance = A;
  document.addEventListener('DOMContentLoaded', () => A.load());
})();
