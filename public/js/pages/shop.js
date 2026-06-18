/* Cloud Panel — Shop */
(function () {
  'use strict';
  const CP = window.CP;
  const { h, icon, fmt } = CP;
  CP.pages = CP.pages || {};

  const ITEMS = [
    { key: 'memory', label: 'RAM', icon: 'drive', color: '#a855f7', fmt: (n) => fmt.mib(n) },
    { key: 'cpu', label: 'CPU', icon: 'cpu', color: '#22d3ee', fmt: (n) => `${n}%` },
    { key: 'disk', label: 'Disk', icon: 'folderOpen', color: '#34d399', fmt: (n) => fmt.mib(n) },
    { key: 'servers', label: 'Server Slot', icon: 'server', color: '#fbbf24', fmt: (n) => `${n} slot${n === 1 ? '' : 's'}` },
  ];

  CP.pages.shop = async function (root, ctx) {
    ctx.setCrumbs([{ label: 'Shop' }]);
    if (!CP.app.economyEnabled) {
      root.appendChild(CP.empty('cart', 'The shop is currently disabled.'));
      return;
    }

    let data;
    try { data = (await CP.api.shop()).data; }
    catch (err) { root.appendChild(CP.empty('alert', err.message)); return; }

    const balance = h('div', { class: 'coins-big', html: `${icon('coin', 22)} <b>${(data.coins || 0).toLocaleString()}</b> coins` });
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h2', { html: `${icon('cart', 22)} Shop` }), h('p', {}, 'Spend coins to expand your resources. Upgrades are added to your quota instantly.')),
      h('div', { class: 'grow' }), balance));

    const grid = h('div', { class: 'grid shop-grid' });
    root.appendChild(grid);

    function refreshBalance() {
      balance.innerHTML = `${icon('coin', 22)} <b>${(data.coins || 0).toLocaleString()}</b> coins`;
    }

    function shopCard(it) {
      const cfg = data.shop[it.key] || { price: 0, amount: 0 };
      const owned = (data.resources && data.resources[it.key]) || 0;
      const qty = h('input', { type: 'number', value: 1, min: 1, style: { width: '72px' } });
      const buy = h('button', { class: 'btn primary block', html: `${icon('cart', 15)} Buy` });
      const costEl = h('div', { class: 'shop-cost', html: `${icon('coin', 14)} ${cfg.price.toLocaleString()}` });

      const recalc = () => {
        const q = Math.max(1, Math.floor(+qty.value || 1));
        costEl.innerHTML = `${icon('coin', 14)} ${(cfg.price * q).toLocaleString()}`;
      };
      qty.addEventListener('input', recalc);

      buy.onclick = async () => {
        const q = Math.max(1, Math.floor(+qty.value || 1));
        buy.disabled = true;
        try {
          const r = (await CP.api.shopBuy(it.key, q)).data;
          data.coins = r.coins; data.resources = r.resources;
          CP.app.setCoins(r.coins);
          CP.ui.toast(`Bought ${it.fmt(r.bought.amount)} for ${r.bought.cost} coins`, 'ok');
          render();
        } catch (err) {
          CP.ui.toast(err.message, 'err');
          buy.disabled = false;
        }
      };

      return h('div', { class: 'card shop-card' },
        h('div', { class: 'shop-ic', style: { background: `linear-gradient(135deg, ${it.color}33, ${it.color}11)`, color: it.color }, html: icon(it.icon, 26) }),
        h('h3', {}, it.label),
        h('div', { class: 'shop-amount', html: `+${it.fmt(cfg.amount)}` }),
        h('div', { class: 'muted', style: { fontSize: '12.5px', marginBottom: '12px' } }, `You own: ${it.fmt(owned)}`),
        costEl,
        h('div', { class: 'shop-buy' },
          h('label', { class: 'shop-qty' }, h('span', { class: 'faint' }, 'Qty'), qty),
          buy)
      );
    }

    function render() {
      refreshBalance();
      CP.clear(grid);
      ITEMS.forEach((it) => grid.appendChild(shopCard(it)));
    }
    render();
  };
})();
