/* Cloud Panel — Server Pets */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  const EMOJI = { cat: '🐱', dog: '🐶', turtle: '🐢', fox: '🦊', penguin: '🐧', robot: '🤖', alien: '👾', dragon: '🐉', unicorn: '🦄' };

  // Mood from your fleet's health. Returns { face, mood, line }.
  function moodFor(emoji, servers) {
    const running = servers.filter((s) => s.status === 'running');
    if (!servers.length) return { mood: 'curious', line: 'Deploy a server and I’ll watch over it!' };
    if (!running.length) return { mood: 'sleeping', line: 'Zzz… all your servers are offline.' };
    let worstMem = 0;
    running.forEach((s) => {
      const lim = (s.limits && s.limits.memory ? s.limits.memory : 0) * 1024 * 1024;
      const used = (s.resources && s.resources.memory) || 0;
      if (lim) worstMem = Math.max(worstMem, (used / lim) * 100);
    });
    if (worstMem >= 90) return { mood: 'stressed', line: 'RAM is almost full — I’m sweating! 😰' };
    if (worstMem >= 70) return { mood: 'worried', line: 'Memory’s getting high… keep an eye on it.' };
    return { mood: 'happy', line: `All ${running.length} server(s) humming along. 20 TPS vibes! ✨` };
  }

  CP.pages.pets = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Pets' }]);
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, 'Server Pets'), h('p', {}, 'Adopt a companion that reacts to your servers’ health.'))));

    const wrap = h('div', {}, CP.spinner('Loading pets…'));
    root.appendChild(wrap);

    let d;
    try { d = (await CP.api.pets()).data; }
    catch (e) { CP.clear(wrap); wrap.appendChild(CP.empty('alert', e.message)); return; }
    if (!d.enabled) { CP.clear(wrap); wrap.appendChild(CP.empty('rocket', 'Pets aren’t available right now.')); return; }

    const mascotFace = h('div', { style: { fontSize: '64px', lineHeight: '1', transition: 'transform .3s' } }, d.active ? EMOJI[d.active] || '🥚' : '🥚');
    const mascotLine = h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '6px' } }, '…');
    const mascotName = h('b', {}, '');
    const mascot = h('div', { class: 'card', style: { display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '18px' } },
      h('div', { style: { textAlign: 'center', minWidth: '90px' } }, mascotFace),
      h('div', {}, mascotName, mascotLine));

    const ownedRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' } });
    const shopGrid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' } });

    function paint() {
      // active mascot name
      const active = d.catalog.find((p) => p.id === d.active);
      mascotName.textContent = active ? `${active.name}` : 'No pet selected';
      mascotFace.textContent = active ? active.emoji : '🥚';

      // owned chips
      CP.clear(ownedRow);
      ownedRow.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px', width: '100%' } }, 'Your companions'));
      if (!d.owned.length) ownedRow.appendChild(h('span', { class: 'faint', style: { fontSize: '13px' } }, 'None yet — adopt one below!'));
      const setActive = async (id) => {
        try { d = (await CP.api.petActive(id)).data; paint(); refreshMood(); }
        catch (e) { CP.ui.toast(e.message, 'err'); }
      };
      d.owned.forEach((id) => {
        const p = d.catalog.find((x) => x.id === id) || { emoji: '🐾', name: id };
        ownedRow.appendChild(h('button', { class: 'btn sm' + (d.active === id ? ' primary' : ''), onclick: () => setActive(id) }, `${p.emoji} ${p.name}`));
      });
      if (d.active) ownedRow.appendChild(h('button', { class: 'btn sm ghost', onclick: () => setActive(null) }, 'Unequip'));

      // shop
      CP.clear(shopGrid);
      d.catalog.forEach((p) => {
        const buy = h('button', { class: 'btn sm primary block', disabled: p.owned || d.coins < p.price,
          html: p.owned ? `${icon('check', 13)} Owned` : `${icon('coin', 13)} ${p.price}` });
        buy.onclick = async () => {
          buy.disabled = true;
          try {
            d = (await CP.api.petBuy(p.id)).data;
            CP.app.setCoins(d.coins);
            CP.ui.toast(`Adopted ${p.name} ${p.emoji}!`, 'ok');
            paint(); refreshMood();
          } catch (e) { CP.ui.toast(e.message, 'err'); buy.disabled = false; }
        };
        shopGrid.appendChild(h('div', { class: 'card', style: { textAlign: 'center' } },
          h('div', { style: { fontSize: '40px', lineHeight: '1', margin: '4px 0 8px' } }, p.emoji),
          h('b', {}, p.name),
          h('div', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 10px', minHeight: '32px' } }, p.desc),
          buy));
      });
    }

    async function refreshMood() {
      if (!d.active) { mascotLine.textContent = 'Pick a companion to bring them to life!'; return; }
      let servers = [];
      try { servers = (await CP.api.get('/servers')).data; } catch {}
      const m = moodFor(EMOJI[d.active], servers);
      mascotLine.textContent = m.line;
      mascotFace.style.transform = m.mood === 'happy' ? 'translateY(-4px)' : m.mood === 'stressed' ? 'rotate(-6deg)' : 'none';
    }

    CP.clear(wrap);
    wrap.append(
      mascot,
      ownedRow,
      h('div', { class: 'section-title' }, 'Pet Shop'),
      h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '-6px' } }, 'Buy with coins. Your first pet is equipped automatically.'),
      shopGrid);
    paint();
    refreshMood();
    const timer = setInterval(refreshMood, 5000);
    ctx.onCleanup(() => clearInterval(timer));
  };
})();
