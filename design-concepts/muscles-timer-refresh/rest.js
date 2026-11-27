/* GymLift prototyp: tri varianty časovača oddychu (A limetkový dock, B kruhová karta, C kontrastný banner).
   Odpočet je skutočný lokálny deadline (createTimer v shared.js); ukážkový tréning je označená vzorka. */
(function (G) {
  'use strict';
  const { h, t, fmt } = G;

  /* Ukážkový tréning nad časovačom; po 3. sérii prvého cviku. */
  function ctxCard() {
    const rows = [['ex1', 4, 8, '60 kg', 3], ['ex2', 3, 10, '45 kg', 0], ['ex3', 3, 8, '80 kg', 0]];
    return h('section', { class: 'card ctx' }, [
      h('h2', null, [t('sampleWorkout'), h('span', { class: 'tag', text: t('sampleTag') })])
    ].concat(rows.map((r, idx) => {
      const sq = [];
      for (let i = 0; i < r[1]; i++) {
        sq.push(h('span', { class: 'sq' + (i < r[4] ? ' done' : '') + (idx === 0 && i === r[4] ? ' now' : ''), text: i < r[4] ? '✓' : String(i + 1) }));
      }
      return h('div', { class: 'ex' }, [
        h('div', null, [h('b', { text: t(r[0]) }), h('span', { class: 'meta', text: t('setsMeta', { s: r[1], r: r[2], w: r[3] }) })]),
        h('div', { class: 'sets', 'aria-hidden': 'true' }, sq)
      ]);
    })));
  }

  /* Ovládacie tlačidlá spoločné pre všetky varianty (každé ≥ 48 px). */
  function controls(timer) {
    const minus = h('button', { class: 'btn', type: 'button', text: t('minus15'), 'aria-label': t('minus15Aria'), onclick: () => timer.add(-15) });
    const plus = h('button', { class: 'btn', type: 'button', text: t('plus15'), 'aria-label': t('plus15Aria'), onclick: () => timer.add(15) });
    const toggle = h('button', { class: 'btn primary', type: 'button', onclick: () => timer.toggle() });
    const skip = h('button', { class: 'btn', type: 'button', text: t('skip'), onclick: () => timer.skip() });
    let last = '';
    return {
      minus: minus, plus: plus, toggle: toggle, skip: skip,
      update(s) {
        const key = s.state === 'running' ? 'pause' : s.state === 'paused' ? 'resume' : 'restart';
        toggle.textContent = t(key);
        skip.disabled = s.state === 'done';
        minus.disabled = s.state === 'done';
        if (s.state !== 'paused') timer.touched = true;
        if (last && last !== s.state) G.announce(t(s.state === 'running' ? 'stRunning' : s.state === 'paused' ? 'stPaused' : 'stDone'));
        last = s.state;
      }
    };
  }

  const timeText = (s) => (s.state === 'done' ? t('over') : fmt(s.sec));
  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
  function demoMark(ctx) { return ctx.P.demo ? h('p', { class: 'demo-mark', text: t('demoMark') }) : null; }
  function updateDemo(el, ctx, s) { if (el) el.hidden = !(s.state === 'paused' && !ctx.timer.touched); }
  function bar(fill, s) { fill.style.transform = 'scaleX(' + s.ratio.toFixed(4) + ')'; }

  /* A: rozbalený limetkový dock dole */
  G.views['rest-a'] = function (root, ctx) {
    const timer = ctx.timer;
    const c = controls(timer);
    let collapsed = false;
    const time = h('div', { class: 'time', role: 'timer', 'aria-live': 'off' });
    const fill = h('i');
    const next = h('p', { class: 'next' });
    const collapseBtn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'true', text: t('collapse'), onclick: () => {
      collapsed = !collapsed;
      dock.classList.toggle('collapsed', collapsed);
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseBtn.textContent = t(collapsed ? 'expand' : 'collapse');
    } });
    const dock = h('section', { class: 'dock', 'aria-label': t('rest') }, [
      h('div', { class: 'top' }, [h('span', { class: 'lbl', text: t('rest') + ' · ' + t('setProgress') }), collapseBtn]),
      time,
      h('div', { class: 'fill-track', 'aria-hidden': 'true' }, [fill]),
      next,
      h('div', { class: 'grid' }, [c.minus, c.plus, c.toggle, c.skip])
    ]);
    const demo = demoMark(ctx);
    root.append(ctxCard());
    if (demo) root.append(demo);
    root.append(dock);
    return timer.subscribe((s) => {
      c.update(s);
      dock.setAttribute('data-state', s.state);
      setText(time, timeText(s));
      time.setAttribute('aria-label', t('rest') + ' ' + fmt(s.sec));
      setText(next, s.state === 'done' ? t('goNext') : t('nextUp') + ': ' + t('nextSet'));
      bar(fill, s);
      updateDemo(demo, ctx, s);
    });
  };

  /* B: veľká karta s kruhovým ukazovateľom */
  G.views['rest-b'] = function (root, ctx) {
    const timer = ctx.timer;
    const c = controls(timer);
    const R = 108;
    const C = 2 * Math.PI * R;
    const ring = h('div', { class: 'ringwrap' });
    ring.innerHTML = '<svg viewBox="0 0 240 240" aria-hidden="true" focusable="false"><circle class="trk" cx="120" cy="120" r="' + R + '"/>'
      + '<circle class="prg" cx="120" cy="120" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="0"/></svg>';
    const prg = ring.querySelector('.prg');
    const time = h('div', { class: 'time', role: 'timer', 'aria-live': 'off' });
    const of = h('span', { class: 'of' });
    ring.append(h('div', { class: 'mid' }, [h('span', { class: 'lbl', text: t('rest') }), time, of]));
    const next = h('p', { class: 'next' });
    const card = h('section', { class: 'ringcard', 'aria-label': t('rest') }, [
      h('p', { class: 'fine', style: 'color:inherit;opacity:.85', text: t('setProgress') }),
      ring,
      next,
      h('div', { class: 'btnrow' }, [c.minus, c.plus]),
      h('div', { class: 'btnrow' }, [c.toggle, c.skip])
    ]);
    const demo = demoMark(ctx);
    root.append(card);
    if (demo) root.append(demo);
    root.append(ctxCard());
    return timer.subscribe((s) => {
      c.update(s);
      card.setAttribute('data-state', s.state);
      setText(time, timeText(s));
      time.setAttribute('aria-label', t('rest') + ' ' + fmt(s.sec));
      setText(of, s.state === 'done' ? '' : t('ofTotal', { t: fmt(Math.round(s.total / 1000)) }));
      setText(next, s.state === 'done' ? t('goNext') : t('nextUp') + ': ' + t('nextSet'));
      prg.setAttribute('stroke-dashoffset', (C * (1 - s.ratio)).toFixed(2));
      prg.style.opacity = s.ratio > 0 ? '1' : '0';
      updateDemo(demo, ctx, s);
    });
  };

  /* C: kontrastný banner prilepený hore, tréning ostáva pod ním */
  G.views['rest-c'] = function (root, ctx) {
    const timer = ctx.timer;
    const c = controls(timer);
    const time = h('div', { class: 'time', role: 'timer', 'aria-live': 'off', style: 'overflow-wrap:anywhere' });
    const fill = h('i');
    const banner = h('section', { class: 'banner', 'aria-label': t('rest') }, [
      h('div', { class: 'top' }, [h('span', { class: 'lbl', text: t('rest') }), h('span', { class: 'lbl', text: t('setProgress') })]),
      time,
      h('div', { class: 'fill-track', 'aria-hidden': 'true' }, [fill]),
      h('div', { class: 'btnrow' }, [c.minus, c.plus, c.toggle, c.skip])
    ]);
    const demo = demoMark(ctx);
    root.append(banner);
    if (demo) root.append(demo);
    root.append(ctxCard());
    return timer.subscribe((s) => {
      c.update(s);
      banner.setAttribute('data-state', s.state);
      setText(time, timeText(s));
      time.setAttribute('aria-label', t('rest') + ' ' + fmt(s.sec));
      bar(fill, s);
      updateDemo(demo, ctx, s);
    });
  };
})(window.GLProto);
