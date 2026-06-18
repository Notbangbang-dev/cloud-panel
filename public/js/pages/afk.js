/* Cloud Panel — AFK coin earner */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon } = CP;
  CP.pages = CP.pages || {};

  CP.pages.afk = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'AFK' }]);
    if (!CP.app.afkEnabled) {
      root.appendChild(CP.empty('coin', 'AFK rewards are currently disabled.'));
      return;
    }

    let info;
    try { info = (await CP.api.afkInfo()).data; }
    catch (err) { root.appendChild(CP.empty('alert', err.message)); return; }

    let balance = info.coins || 0;
    let perInterval = info.perInterval || 1;
    let interval = info.intervalSeconds || 30;
    let sessionEarned = 0;
    let remaining = interval;
    let stopped = false;
    let locked = false;
    const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);

    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', { html: `${icon('coin', 22)} AFK Rewards` }),
        h('p', {}, 'Keep this page open to earn coins automatically. No clicking required!'))));

    const ring = h('div', { class: 'afk-ring' });
    const ringInner = h('div', { class: 'afk-ring-inner' });
    ring.appendChild(ringInner);
    const moon = h('div', { class: 'afk-moon' }, '🌙');
    const countdown = h('div', { class: 'afk-count' }, `${remaining}s`);
    const countLabel = h('div', { class: 'afk-count-label' }, 'until next coin');
    ringInner.append(moon, countdown, countLabel);

    const balEl = h('div', { class: 'afk-balance' });
    const earnedEl = h('div', { class: 'afk-earned' });
    const rateEl = h('div', { class: 'muted', style: { fontSize: '13px' } });

    const renderBalance = () => { balEl.innerHTML = `${icon('coin', 20)} <b>${balance.toLocaleString()}</b> coins`; };
    const renderEarned = () => { earnedEl.textContent = `+${sessionEarned.toLocaleString()} earned this session`; };
    const renderRate = () => { rateEl.textContent = `Earning +${perInterval} coin${perInterval === 1 ? '' : 's'} every ${interval}s`; };
    const updateRing = () => {
      const pct = Math.max(0, Math.min(1, 1 - remaining / interval));
      ring.style.background = `conic-gradient(var(--cyan) ${pct * 360}deg, rgba(255,255,255,0.08) 0)`;
      countdown.textContent = `${remaining}s`;
    };
    renderBalance(); renderEarned(); renderRate(); updateRing();

    root.appendChild(h('div', { class: 'card afk-card' },
      ring,
      h('div', { class: 'afk-info' },
        balEl,
        h('div', { class: 'afk-earned-wrap' }, earnedEl),
        rateEl,
        h('div', { class: 'note', style: { marginTop: '14px' },
          html: `${icon('info', 14)} Coins are credited on the server by real elapsed time — leaving the tab open is all it takes.` }))
    ));

    const flash = () => {
      moon.textContent = '✨';
      earnedEl.classList.add('pop');
      setTimeout(() => { moon.textContent = '🌙'; earnedEl.classList.remove('pop'); }, 800);
    };

    const setLocked = (on) => {
      if (locked === on) return;
      locked = on;
      ring.classList.toggle('locked', on);
      if (on) {
        moon.textContent = '🔒';
        countdown.textContent = '—';
        countLabel.textContent = 'open in another tab';
        ring.style.background = 'conic-gradient(var(--faint) 360deg, var(--faint) 0)';
      } else {
        moon.textContent = '🌙';
        countLabel.textContent = 'until next coin';
      }
    };

    // Local 1s countdown (re-synced from the server on each heartbeat).
    const countdownTimer = setInterval(() => {
      if (stopped || locked) return;
      remaining = Math.max(0, remaining - 1);
      updateRing();
    }, 1000);

    async function beat() {
      if (stopped) return;
      try {
        const d = (await CP.api.afkHeartbeat(sid)).data;
        if (d.locked) { setLocked(true); return; } // another tab is earning
        setLocked(false);
        perInterval = d.perInterval; interval = d.intervalSeconds;
        balance = d.coins;
        if (d.earned > 0) { sessionEarned += d.earned; flash(); CP.app.setCoins(balance); CP.ui.toast(`+${d.earned} coin${d.earned === 1 ? '' : 's'} 🪙`, 'ok', 1500); }
        remaining = d.nextInSeconds || interval;
        renderBalance(); renderEarned(); renderRate(); updateRing();
      } catch (err) {
        stopped = true;
        CP.ui.toast(err.message || 'AFK earning stopped', 'err');
      }
    }

    await beat(); // starts the server-side clock
    const beatTimer = setInterval(beat, Math.min(5, interval) * 1000);
    ctx.onCleanup(() => { stopped = true; clearInterval(beatTimer); clearInterval(countdownTimer); });
  };
})();
