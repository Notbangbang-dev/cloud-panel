/* Cloud Panel — Achievements & XP */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  CP.pages.achievements = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Achievements' }]);

    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, 'Achievements'), h('p', {}, 'Earn XP and unlock badges as you use the panel.'))));

    const wrap = h('div', {}, CP.spinner('Loading achievements…'));
    root.appendChild(wrap);

    let d;
    try { d = (await CP.api.achievements()).data; }
    catch (e) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', e.message)); return; }
    CP.clear(wrap);

    if (!d.enabled) { wrap.appendChild(CP.empty('zap', 'Achievements are turned off on this panel.')); return; }

    const lvl = d.level || { level: 1, into: 0, span: 250 };
    const unlocked = d.achievements.filter((a) => a.unlocked).length;
    const pct = Math.min(100, Math.round((lvl.into / lvl.span) * 100));

    // XP / level summary
    wrap.appendChild(h('div', { class: 'card', style: { marginBottom: '18px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' } },
        h('div', { class: 'glyph', style: { width: '54px', height: '54px', fontSize: '22px' }, html: icon('zap', 24) }),
        h('div', {},
          h('b', { style: { fontSize: '18px' } }, `Level ${lvl.level}`),
          h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${d.xp} XP total · ${unlocked}/${d.achievements.length} unlocked`)),
        h('div', { style: { flex: 1, minWidth: '160px' } },
          h('div', { class: 'bar', style: { marginTop: '6px' }, html: `<i style="width:${pct}%"></i>` }),
          h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '4px' } }, `${lvl.into} / ${lvl.span} XP to level ${lvl.level + 1}`)))));

    // Badge grid
    const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' } });
    d.achievements.forEach((a) => {
      grid.appendChild(h('div', { class: 'card' + (a.unlocked ? '' : ' tile'), style: { opacity: a.unlocked ? '1' : '0.55', display: 'flex', gap: '12px', alignItems: 'flex-start' } },
        h('div', { style: { fontSize: '30px', lineHeight: '1', filter: a.unlocked ? 'none' : 'grayscale(1)' } }, a.icon || '🏅'),
        h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('b', {}, a.name),
            a.unlocked ? h('span', { class: 'badge green', html: `${icon('check', 11)}` }) : h('span', { class: 'badge soft' }, 'Locked')),
          h('div', { class: 'muted', style: { fontSize: '12.5px', margin: '4px 0 6px' } }, a.desc),
          h('span', { class: 'chip', html: `${icon('zap', 12)} ${a.xp} XP` }))));
    });
    wrap.appendChild(grid);
  };
})();
