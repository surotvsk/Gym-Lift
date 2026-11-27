/* GymLift prototyp: tri varianty svalovej mapy (A prepínač predok/chrbát, B dvojica postáv, C zameranie na chrbát).
   Kreslenie tela a farby sú spoločné v shared.js a body-rear.svg; tu je len rozloženie a výber svalu. */
(function (G) {
  'use strict';
  const { h, t, mountBody, paint, muscleName, recoveryClass, statusKey, RECOVERY, FRONT_MUSCLES, REAR_MUSCLES, ALL_MUSCLES } = G;

  function legend() {
    return h('ul', { class: 'legend', 'aria-label': t('legend') },
      [0, 1, 2, 3].map((i) => h('li', null, [h('span', { class: 'sw rec-' + i }), t('rec' + i)])));
  }

  /* Karta s detailom vybraného svalu. */
  function infoCard() {
    const el = h('section', { class: 'card', 'aria-live': 'polite' });
    function update(m, view) {
      el.replaceChildren();
      if (!m) {
        el.append(h('p', { class: 'hint', text: t('tapHint') }), h('p', { class: 'fine', text: t('fixtureNote') }));
        return;
      }
      const v = RECOVERY[m];
      el.append(
        h('div', { class: 'row-head' }, [
          h('h2', { text: muscleName(m, view) }),
          h('span', { class: 'pill', text: t(statusKey(v)) })
        ]),
        h('div', { class: 'bar ' + recoveryClass(v), role: 'img', 'aria-label': t('recovered', { n: v }) }, [h('i', { style: 'width:' + v + '%' })]),
        h('p', { class: 'hint', text: t('recovered', { n: v }) })
      );
      if (view && (view === 'front' ? FRONT_MUSCLES : REAR_MUSCLES).indexOf(m) < 0) {
        el.append(h('p', { class: 'hint', text: t('notThisSide') }));
      }
      el.append(h('p', { class: 'fine', text: t('fixtureNote') }));
    }
    return { el: el, update: update };
  }

  /* Zoznam čipov so svalmi; sync() prepne stav bez prestavby (zachová fokus). */
  function chips(list, view, onPick) {
    const btns = list.map((m) => {
      const v = RECOVERY[m];
      return h('button', { class: 'chip', type: 'button', 'data-chip': m, 'aria-pressed': 'false', onclick: () => onPick(m) }, [
        h('span', { class: 'dot ' + recoveryClass(v) }), muscleName(m, view), h('small', { text: v + '%' })
      ]);
    });
    const el = h('div', { class: 'chips', role: 'group', 'aria-label': t('muscles') }, btns);
    return {
      el: el,
      sync(sel) { btns.forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-chip') === sel ? 'true' : 'false')); }
    };
  }

  function cap(text) { return h('span', { class: 'cap', text: text }); }

  /* A: jedna veľká postava a prepínač Predok / Chrbát */
  G.views['muscles-a'] = function (root, ctx) {
    let view = ctx.P.view;
    let sel = ctx.P.select || null;
    let svg = null;
    let chipSet = null;
    const tabs = ['front', 'back'].map((v) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': 'false', text: t(v),
      onclick: () => { view = v; build(); }
    }));
    const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': t('side') }, tabs);
    const plate = h('div', { class: 'plate', role: 'tabpanel' });
    const chipHost = h('div');
    const card = infoCard();

    function pick(m) { sel = sel === m ? null : m; refresh(); }
    function refresh() {
      tabs.forEach((b, i) => b.setAttribute('aria-selected', (i === 0 ? 'front' : 'back') === view ? 'true' : 'false'));
      if (svg) paint(svg, RECOVERY, sel, view);
      if (chipSet) chipSet.sync(sel);
      card.update(sel, view);
    }
    function build() {
      svg = mountBody(plate, view, RECOVERY, { selected: sel, onSelect: pick });
      chipSet = chips(view === 'back' ? REAR_MUSCLES : FRONT_MUSCLES, view, pick);
      chipHost.replaceChildren(chipSet.el);
      refresh();
    }
    root.append(seg, plate, legend(), chipHost, card.el);
    build();
  };

  /* B: predok a chrbát vedľa seba, výber sa zvýrazní na oboch */
  G.views['muscles-b'] = function (root, ctx) {
    let sel = ctx.P.select || null;
    const hostF = h('div', { class: 'plate half' });
    const hostB = h('div', { class: 'plate half' });
    const figs = [];
    const card = infoCard();
    const chipSet = chips(ALL_MUSCLES, null, pick);

    function pick(m) { sel = sel === m ? null : m; refresh(); }
    function refresh() {
      figs.forEach((f) => paint(f, RECOVERY, sel));
      chipSet.sync(sel);
      card.update(sel, null);
    }
    root.append(h('div', { class: 'pair' }, [hostF, hostB]), legend(), chipSet.el, card.el);
    [[hostF, 'front'], [hostB, 'back']].forEach(([host, v]) => {
      const f = mountBody(host, v, RECOVERY, { selected: sel, onSelect: pick });
      if (f) { figs.push(f); host.append(cap(t(v))); }
    });
    refresh();
  };

  /* C: veľký pohľad zozadu, predok ako malý náhľad, ktorý sa dá prehodiť */
  G.views['muscles-c'] = function (root, ctx) {
    let main = 'back';
    let sel = ctx.P.select || null;
    let svg = null;
    const plate = h('div', { class: 'plate focus' });
    const figHost = h('div', { style: 'display:contents' });
    const thumbHost = h('div', { style: 'display:contents' });
    const thumb = h('button', { class: 'thumb', type: 'button', onclick: () => { main = other(); build(); } }, [thumbHost, h('span', { 'data-lbl': '1' })]);
    const chain = h('div', { class: 'chain', role: 'group' });
    const chainTitle = h('h2', { class: 'view-sub', style: 'margin:0' });
    const card = infoCard();
    plate.append(figHost, thumb);

    function other() { return main === 'back' ? 'front' : 'back'; }
    function pick(m) { sel = sel === m ? null : m; refresh(); }
    function refresh() {
      if (svg) paint(svg, RECOVERY, sel, main);
      chain.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-chip') === sel ? 'true' : 'false'));
      card.update(sel, main);
    }
    function build() {
      svg = mountBody(figHost, main, RECOVERY, { selected: sel, onSelect: pick });
      mountBody(thumbHost, other(), RECOVERY, { thumb: true });
      thumb.setAttribute('aria-label', t(other() === 'front' ? 'showFront' : 'showBack'));
      thumb.querySelector('[data-lbl]').textContent = t(other());
      plate.querySelectorAll('.cap').forEach((n) => n.remove());
      plate.append(cap(t(main)));
      chainTitle.textContent = t(main === 'back' ? 'chainBack' : 'chainFront');
      chain.replaceChildren();
      const list = (main === 'back' ? REAR_MUSCLES : FRONT_MUSCLES).slice().sort((a, b) => RECOVERY[a] - RECOVERY[b]);
      list.forEach((m) => {
        const v = RECOVERY[m];
        chain.append(h('button', { type: 'button', 'data-chip': m, 'aria-pressed': 'false', onclick: () => pick(m) }, [
          h('span', { class: 'row-head' }, [h('span', { text: muscleName(m, main) }), h('span', { text: t(statusKey(v)) + ' · ' + v + '%' })]),
          h('span', { class: 'bar ' + recoveryClass(v) }, [h('i', { style: 'width:' + v + '%' })])
        ]));
      });
      refresh();
    }
    root.append(plate, legend(), chainTitle, chain, card.el);
    build();
  };
})(window.GLProto);
