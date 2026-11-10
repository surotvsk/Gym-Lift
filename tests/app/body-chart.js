'use strict';
/* GymQuest — graf mier s dátumovou osou + porovnanie dvoch dátumov. Headless Chrome, bez siete.

     GQ_TEST_PORT=8172 node tests/app/body-chart.js

   Kontroluje: geometriu (body zoradené podľa dátumu, 3–5 značiek osi y, popisky osi x vnútri karty a bez
   prekrytia pri 320 px, ar/fr pri 130 % textu bez pretečenia), tooltip, rozsah (všetko / 3 / 1 mesiac),
   prázdne a jednobodové stavy, tabuľku porovnania (hodnoty, znamienka, farby, dni) a jednotky kg/lb, cm/in.
   Snímky: SHOTS (predvolene ../claude-code/phase8/task3). */
const fs = require('fs');
const path = require('path');
const { counter, startServerOnce, openApp, closeAll } = require('../android/lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task3');

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { p, errors } = await openApp({ name: 'bodychart', debugPort: 9939, native: false, lang: 'en' });
    const ev = (s) => p.eval(s);
    await ev(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), true)`);
    const view = (w, h) => p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 900, deviceScaleFactor: 2, mobile: true });
    await view(393);
    await p.c.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    /* 8 záznamov za ~4 mesiace (dni dozadu od dneška); pás klesá, váha kolíše. */
    const OFFS = [120, 100, 85, 60, 40, 20, 8, 1];
    const WAIST = [92, 91, 90.5, 89, 88, 87.5, 86, 85];
    const WEIGHT = [88, 87.2, 87.5, 86.1, 85.4, 85.9, 84.6, 84];
    await ev(`(() => {
      const pad = (n) => String(n).padStart(2, '0');
      const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
      const O = ${JSON.stringify(OFFS)}, W = ${JSON.stringify(WAIST)}, K = ${JSON.stringify(WEIGHT)};
      state.measurements = O.map((o, i) => cleanMeasurement({ id: 'm' + i, date: iso(o), waistCm: W[i], weightKg: K[i], neckCm: i === 0 || i === 7 ? 38 - i / 7 : null, bodyFatPct: i === 0 || i === 7 ? 22 - i : null, note: '' }));
      measureExtraRestore(state, true); saveState();
      switchTab('pokrok'); setPokrokView('body'); setThemePref('light'); setLang('en'); setBodyUnits('metric'); return true; })()`);
    await wait(400);
    /* Skutočný ťuk myšou na x-ovú pozíciu bodky (cez box handler, nie cez udalosť na bodke). */
    const tapDot = async (i, dy) => {
      const c = await ev(`(() => { const r = document.querySelectorAll('#body-chart .chart-dot')[${i}].getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`).then(JSON.parse);
      await p.c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1] + (dy || 0), button: 'left', clickCount: 1 });
      await p.c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1] + (dy || 0), button: 'left', clickCount: 1 });
      await wait(30);
    };
    const chip = (field) => ev(`(document.querySelector('#body-metric-chips [data-field="${field}"]').click(), true)`);
    const geo = () => ev(`(() => {
      const svg = document.querySelector('#body-chart svg'); if (!svg) return null;
      const sr = svg.getBoundingClientRect(), cr = document.getElementById('body-chart-card').getBoundingClientRect();
      const dots = [...svg.querySelectorAll('.chart-dot')].map((d) => +d.getAttribute('cx'));
      const xl = [...svg.querySelectorAll('.chart-axis')].filter((e) => e.getAttribute('text-anchor') === 'middle').map((e) => e.getBoundingClientRect());
      const yl = [...svg.querySelectorAll('.chart-axis')].filter((e) => e.getAttribute('text-anchor') === 'end').map((e) => e.textContent);
      const all = [...svg.querySelectorAll('.chart-axis')].map((e) => e.getBoundingClientRect());
      const overlap = xl.some((a, i) => xl.some((b, j) => j > i && a.right + 1 > b.left && b.right + 1 > a.left));
      return { dots, yl, nx: xl.length, overlap, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
        inside: all.every((r) => r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5), svgInside: sr.left >= cr.left - 0.5 && sr.right <= cr.right + 0.5, svgW: sr.width }; })()`);

    /* --- geometria: pás, všetko --- */
    await chip('waistCm'); await wait(150);
    let g = await geo();
    check('chart draws one dot per entry (8 waist points)', g && g.dots.length === 8, g);
    check('dots are ordered by date (x strictly increasing)', g.dots.every((x, i) => !i || x > g.dots[i - 1]), g.dots);
    const gaps = g.dots.slice(1).map((x, i) => x - g.dots[i]);
    check('x position is proportional to time (gap 20->8 days > gap 8->1 days)', gaps[5] > gaps[6] * 1.5, gaps);
    check('y axis has 3-5 nice ticks', g.yl.length >= 3 && g.yl.length <= 5, g.yl);
    check('y ticks are evenly spaced "nice" numbers', (() => { const v = g.yl.map(Number); const d = v[1] - v[0]; return v.every((x, i) => !i || Math.abs(x - v[i - 1] - d) < 1e-6) && [1, 2, 5].includes(+(d / Math.pow(10, Math.floor(Math.log10(d)))).toFixed(6)); })(), g.yl);
    check('x axis has date labels, none overlapping, all inside the card', g.nx >= 2 && !g.overlap && g.inside && g.svgInside, g);
    check('chart is not wider than the card (no page overflow)', g.sw <= g.vw, g);
    check('range note lists lowest/highest', /Lowest 85\.0 · highest 92\.0 cm/.test(await ev(`document.getElementById('body-chart-range').textContent`)), await ev(`document.getElementById('body-chart-range').textContent`));

    /* --- tooltip --- */
    await ev(`(document.querySelector('#body-chart-card').scrollIntoView({ block: 'center' }), true)`); await wait(150);
    await tapDot(7); await wait(70);
    const lastDate = await ev(`formatDate(state.measurements[7].date)`);
    check('tooltip shows date + value of the tapped dot', await ev(`!document.querySelector('.chart-tip').hidden && document.querySelector('.chart-tip').textContent`) === lastDate + ' · 85.0 cm', await ev(`document.querySelector('.chart-tip').textContent`));
    check('tooltip stays inside the card', await ev(`(() => { const a = document.querySelector('.chart-tip').getBoundingClientRect(), c = document.getElementById('body-chart').getBoundingClientRect(); return a.left >= c.left - 0.5 && a.right <= c.right + 0.5; })()`));
    check('dots are keyboard-focusable with an aria-label', await ev(`[...document.querySelectorAll('#body-chart .chart-pt')].every((e) => e.tabIndex === 0 && /,/.test(e.getAttribute('aria-label')))`));
    await ev(`(document.querySelectorAll('#body-chart .chart-pt')[0].focus(), true)`); await wait(100);
    check('focusing a dot shows its tooltip', (await ev(`document.querySelector('.chart-tip').textContent`)).endsWith('92.0 cm'));
    check('hit area gives a >= 44 px target', await ev(`document.querySelector('#body-chart .chart-hit').getBoundingClientRect().width >= 44`));
    await ev(`(document.querySelector('#body-chart-card').scrollIntoView({ block: 'start' }), true)`); await wait(150);
    const shot = async (name) => { const r = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); };
    const scrollTo = (id) => ev(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.scrollIntoView({ block: 'start' }); for (let e = el.parentElement; e; e = e.parentElement) { if (e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY)) { e.scrollTop -= 70; return true; } } window.scrollBy(0, -70); return true; })()`);
    await scrollTo('body-chart-card'); await wait(200);
    await shot('chart-tooltip-open-en-light-393.png');
    await ev(`(document.activeElement.blur(), document.getElementById('body-chart').dispatchEvent(new Event('click')), true)`); await wait(100);
    check('tapping outside a dot closes the tooltip', await ev(`document.querySelector('.chart-tip').hidden`));
    await shot('chart-en-light-393.png');

    /* --- rozsah --- */
    const rng = (r) => ev(`(document.querySelector('#body-range-chips [data-range="${r}"]').click(), document.querySelectorAll('#body-chart .chart-dot').length)`);
    check('range chips: All / 3 months / 1 month', await ev(`[...document.querySelectorAll('#body-range-chips .metric-chip')].map((c) => c.textContent).join('|')`) === 'All|3 months|1 month');
    check('3 months keeps entries <= ~92 days old (6 of 8)', await rng('3m') === 6);
    check('1 month keeps entries <= ~1 month old (3 of 8)', await rng('1m') === 3);
    check('active range chip has aria-pressed', await ev(`document.querySelector('#body-range-chips [data-range="1m"]').getAttribute('aria-pressed') === 'true'`));
    check('all restores 8', await rng('all') === 8);
    /* neck: len 2 záznamy; v 1 mesiaci 1 záznam; v inom poli 0 */
    await chip('neckCm'); await rng('1m'); await wait(100);
    check('one point in range: dot + readable note, no line', await ev(`document.querySelectorAll('#body-chart .chart-dot').length === 1 && !document.querySelector('#body-chart .chart-line') && /Add another entry/.test(document.getElementById('body-chart-range').textContent)`), await ev(`document.getElementById('body-chart-range').textContent`));
    g = await geo();
    check('one point: label inside card, 3+ y ticks', g.inside && g.yl.length >= 3 && g.nx === 1, g);
    await ev(`(state.measurements.forEach((m) => { if (m.date >= (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })()) m.neckCm = null; }), measureExtraRestore(state, true), saveState(), renderPokrok(), true)`); await wait(150);
    check('no entries in range: message, no svg', await ev(`!document.querySelector('#body-chart svg') && document.getElementById('body-chart-range').textContent === 'No entries in this period.'`), await ev(`document.getElementById('body-chart-range').textContent`));
    await ev(`(state.measurements[7].neckCm = 37, measureExtraRestore(state, true), saveState(), renderPokrok(), true)`);
    await rng('all');

    /* --- porovnanie --- */
    check('compare card visible with 2 selects defaulting first vs latest', await ev(`!document.getElementById('body-compare-card').hidden && document.getElementById('cmp-a').value === 'm0' && document.getElementById('cmp-b').value === 'm7' && document.getElementById('cmp-a').options.length === 8`));
    const table = () => ev(`(() => { const o = {}; document.querySelectorAll('#cmp-table tbody tr').forEach((r) => { const c = [...r.children].map((x) => x.textContent); o[r.dataset.field] = { a: c[1], b: c[2], d: c[3], cls: r.querySelector('.cmp-diff').className.replace('cmp-diff', '').trim(), aria: r.querySelector('.cmp-diff').getAttribute('aria-label') }; }); return JSON.stringify(o); })()`).then(JSON.parse);
    let tb = await table();
    check('compare lists exactly the measurements present in both (weight, waist, neck, body fat)', Object.keys(tb).sort().join() === 'bodyFatPct,neckCm,waistCm,weightKg', Object.keys(tb));
    check('waist 92.0 -> 85.0: -7.0 cm, green (improvement)', tb.waistCm.a === '92.0' && tb.waistCm.b === '85.0' && tb.waistCm.d === '−7.0 cm' && tb.waistCm.cls === 'cmp-good' && /improvement/.test(tb.waistCm.aria), tb.waistCm);
    check('body fat 22.0 -> 15.0: −7.0 %, green', tb.bodyFatPct.d === '−7.0 %' && tb.bodyFatPct.cls === 'cmp-good', tb.bodyFatPct);
    check('weight -4.0 kg and neck -1.0 cm are neutral (no colour class)', tb.weightKg.d === '−4.0 kg' && tb.weightKg.cls === '' && tb.neckCm.d === '−1.0 cm' && tb.neckCm.cls === '', [tb.weightKg, tb.neckCm]);
    const dayDiff = await ev(`Math.round((Date.parse(state.measurements[7].date) - Date.parse(state.measurements[0].date)) / 86400000)`);
    check('days between = ' + dayDiff, (await ev(`document.getElementById('cmp-days').textContent`)) === 'Days between: ' + dayDiff, await ev(`document.getElementById('cmp-days').textContent`));
    /* prehodené dátumy: znamienko a farba sa obrátia */
    await ev(`(document.getElementById('cmp-a').value = 'm7', document.getElementById('cmp-a').dispatchEvent(new Event('change')), document.getElementById('cmp-b').value = 'm0', document.getElementById('cmp-b').dispatchEvent(new Event('change')), true)`); await wait(100);
    tb = await table();
    check('swapped dates: waist +7.0 cm in red (worse), weight +4.0 kg neutral', tb.waistCm.d === '+7.0 cm' && tb.waistCm.cls === 'cmp-bad' && /worse/.test(tb.waistCm.aria) && tb.weightKg.d === '+4.0 kg' && tb.weightKg.cls === '', tb);
    check('days between stays positive when swapped', (await ev(`document.getElementById('cmp-days').textContent`)) === 'Days between: ' + dayDiff);
    /* iba spoločné miery: m3 má pás+váhu, bez krku/tuku */
    await ev(`(document.getElementById('cmp-a').value = 'm1', document.getElementById('cmp-a').dispatchEvent(new Event('change')), document.getElementById('cmp-b').value = 'm3', document.getElementById('cmp-b').dispatchEvent(new Event('change')), true)`); await wait(100);
    tb = await table();
    check('only shared measurements: waist + weight', Object.keys(tb).sort().join() === 'waistCm,weightKg' && tb.waistCm.d === '−2.0 cm', tb);
    check('select keeps focus after change', await ev(`document.activeElement.id === 'cmp-b'`));
    await ev(`(state.measurements[1].weightKg = null, state.measurements[1].chestCm = 100, state.measurements[1].waistCm = null, measureExtraRestore(state, true), saveState(), renderPokrok(), true)`); await wait(100);
    check('no shared measurements: readable message (no table)', await ev(`!document.getElementById('cmp-table') && /No measurement is recorded on both dates/.test(document.getElementById('cmp-none').textContent)`), await ev(`document.getElementById('body-compare').textContent`));
    await ev(`(state.measurements[1].waistCm = 91, state.measurements[1].weightKg = 87.2, state.measurements[1].chestCm = null, measureExtraRestore(state, true), saveState(), renderPokrok(), true)`);
    await ev(`(document.getElementById('cmp-a').value = 'm0', document.getElementById('cmp-a').dispatchEvent(new Event('change')), document.getElementById('cmp-b').value = 'm7', document.getElementById('cmp-b').dispatchEvent(new Event('change')), true)`); await wait(100);

    /* --- jednotky --- */
    await ev(`(setBodyUnits('imperial'), true)`); await wait(250);
    tb = await table();
    check('imperial: weight 194.0 -> 185.2 lb (−8.8), waist 36.2 -> 33.5 in (−2.7, from the shown values), body fat stays in %', tb.weightKg.a === '194.0' && tb.weightKg.b === '185.2' && tb.weightKg.d === '−8.8 lb' && tb.waistCm.a === '36.2' && tb.waistCm.b === '33.5' && tb.waistCm.d === '−2.7 in' && tb.bodyFatPct.a === '22.0' && tb.bodyFatPct.d === '−7.0 %', tb);
    await chip('weightKg'); await wait(100);
    g = await geo();
    check('imperial chart: lb ticks (~185-195) and note in lb', g.yl.every((v) => +v > 180 && +v < 200) && /lb/.test(await ev(`document.getElementById('body-chart-range').textContent`)), [g.yl, await ev(`document.getElementById('body-chart-range').textContent`)]);
    await ev(`(document.querySelector('#body-chart-card').scrollIntoView({ block: 'center' }), true)`); await wait(150);
    await tapDot(0);
    check('imperial tooltip shows lb', /194\.0 lb$/.test(await ev(`document.querySelector('.chart-tip').textContent`)), await ev(`document.querySelector('.chart-tip').textContent`));
    await ev(`(setBodyUnits('metric'), true)`);
    check('stored values were never converted', await ev(`state.measurements[0].weightKg === 88 && state.measurements[7].waistCm === 85`));

    /* --- husté body (52 týždňov): ťuk na x každej bodky vyberie práve ju; jediný handler --- */
    await ev(`(window.__mm = JSON.stringify(state.measurements), true)`);
    await ev(`(() => {
      const pad = (n) => String(n).padStart(2, '0');
      const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
      state.measurements = Array.from({ length: 52 }, (_, i) => cleanMeasurement({ id: 'w' + i, date: iso((51 - i) * 7), waistCm: 90 - i * 0.1, note: '' }));
      measureExtraRestore(state, true); saveState(); renderPokrok(); return true; })()`);
    await chip('waistCm'); await rng('all'); await wait(150);
    await ev(`(document.querySelector('#body-chart-card').scrollIntoView({ block: 'center' }), true)`); await wait(150);
    check('52 weekly entries: 52 dots', await ev(`document.querySelectorAll('#body-chart .chart-dot').length`) === 52);
    let bad = [];
    for (let i = 0; i < 52; i++) {
      await tapDot(i);
      const r = await ev(`(() => { const a = [...document.querySelectorAll('#body-chart .chart-dot')].map((d, j) => d.classList.contains('active') ? j : -1).filter((j) => j >= 0); return JSON.stringify([a, document.querySelector('.chart-tip').hidden]); })()`).then(JSON.parse);
      if (r[0].length !== 1 || r[0][0] !== i || r[1]) bad.push([i, r]);
    }
    check('dense chart: a tap at each dot x selects exactly that dot (52/52)', bad.length === 0, bad.slice(0, 5));
    await ev(`(() => { for (let i = 0; i < 10; i++) renderBodyChart(); return true; })()`); await wait(100);
    await ev(`(window.__rc = 0, (() => { const o = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { if (this.classList && this.classList.contains('chart-svg')) window.__rc++; return o.call(this); }; window.__origRect = o; })(), true)`);
    await tapDot(20);
    const calls = await ev(`window.__rc`);
    check('after 10 re-renders a tap runs exactly one handler (not one per render)', calls >= 1 && calls <= 2 && await ev(`document.querySelectorAll('#body-chart .chart-dot.active').length`) === 1, calls);
    await ev(`(Element.prototype.getBoundingClientRect = window.__origRect, true)`);
    await ev(`(document.getElementById('body-chart').dispatchEvent(new Event('click')), true)`);
    check('tooltip toggles once: tap outside hides it after 10 re-renders', await ev(`document.querySelector('.chart-tip').hidden && document.querySelectorAll('#body-chart .chart-dot.active').length === 0`));

    /* --- 3 mesiace / 1 mesiac: deň sa orezá na posledný deň cieľového mesiaca --- */
    const cut = (dates, r, y, m, d) => ev(`JSON.stringify(chartRangeSeries(${JSON.stringify(dates.map((x) => ({ date: x })))}, '${r}', new Date(${y}, ${m}, ${d})).map((x) => x.date))`).then(JSON.parse);
    check('31 Mar 2026 - 1 month = 28 Feb (not 3 Mar)', JSON.stringify(await cut(['2026-02-27', '2026-02-28', '2026-03-03'], '1m', 2026, 2, 31)) === '["2026-02-28","2026-03-03"]');
    check('31 Mar 2028 - 1 month = 29 Feb (leap year)', JSON.stringify(await cut(['2028-02-28', '2028-02-29'], '1m', 2028, 2, 31)) === '["2028-02-29"]');
    check('31 May 2026 - 1 month = 30 Apr', JSON.stringify(await cut(['2026-04-29', '2026-04-30'], '1m', 2026, 4, 31)) === '["2026-04-30"]');
    check('31 May 2026 - 3 months = 28 Feb', JSON.stringify(await cut(['2026-02-27', '2026-02-28'], '3m', 2026, 4, 31)) === '["2026-02-28"]');
    check('15 Jan 2026 - 3 months = 15 Oct 2025', JSON.stringify(await cut(['2025-10-14', '2025-10-15'], '3m', 2026, 0, 15)) === '["2025-10-15"]');

    /* --- porovnanie: rozdiel z hodnôt zaokrúhlených na 1 desatinu, ako sú v A a B --- */
    await ev(`(state.measurements = JSON.parse(window.__mm), state.measurements[0].weightKg = 80.04, state.measurements[7].weightKg = 80.06, measureExtraRestore(state, true), saveState(), setBodyUnits('metric'), renderPokrok(), true)`); await wait(150);
    await ev(`(document.getElementById('cmp-a').value = 'm0', document.getElementById('cmp-a').dispatchEvent(new Event('change')), document.getElementById('cmp-b').value = 'm7', document.getElementById('cmp-b').dispatchEvent(new Event('change')), true)`); await wait(100);
    let cw = (await table()).weightKg;
    check('80.04 / 80.06 kg shows 80.0 / 80.1 and +0.1 kg', cw.a === '80.0' && cw.b === '80.1' && cw.d === '+0.1 kg', cw);
    await ev(`(setBodyUnits('imperial'), true)`); await wait(250);
    cw = (await table()).weightKg;
    const expD = Math.round((parseFloat(cw.b) - parseFloat(cw.a)) * 10) / 10;
    check('lb: diff equals shown B minus shown A', cw.d === (expD > 0 ? '+' : expD < 0 ? '−' : '±') + Math.abs(expD).toFixed(1) + ' lb', cw);
    await ev(`(state.measurements[0].weightKg = 80.00, state.measurements[7].weightKg = 80.03, measureExtraRestore(state, true), saveState(), renderPokrok(), true)`); await wait(150);
    await ev(`(setBodyUnits('imperial'), true)`); await wait(150);
    cw = (await table()).weightKg;
    const expL = Math.round((parseFloat(cw.b) - parseFloat(cw.a)) * 10) / 10;
    check('lb (second case): diff equals shown B minus shown A', cw.d === (expL > 0 ? '+' : expL < 0 ? '−' : '±') + Math.abs(expL).toFixed(1) + ' lb', cw);
    await ev(`(state.measurements = JSON.parse(window.__mm), measureExtraRestore(state, true), saveState(), setBodyUnits('metric'), renderPokrok(), true)`); await wait(150);
    await ev(`(document.getElementById('cmp-a').value = 'm0', document.getElementById('cmp-a').dispatchEvent(new Event('change')), document.getElementById('cmp-b').value = 'm7', document.getElementById('cmp-b').dispatchEvent(new Event('change')), true)`); await wait(100);

    /* --- 6 jazykov, rozloženie, 320 px, 130 % text, ar RTL --- */
    const keys = ['rangeAria', 'range.all', 'range.3m', 'range.1m', 'chartNone', 'cmpTitle', 'cmpFrom', 'cmpTo', 'cmpMeasure', 'cmpChange', 'cmpDays', 'cmpNone', 'cmpNote', 'cmpBetter', 'cmpWorse', 'cmpTableAria'].map((k) => 'body.' + k);
    const titles = new Set();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${JSON.stringify(lang)}), true)`);
      const strs = JSON.parse(await ev(`JSON.stringify(${JSON.stringify(keys)}.map((k) => t(k, { n: 3 })))`));
      check(lang + ': all ' + keys.length + ' new strings exist', strs.every((x, i) => x && x !== keys[i]), strs);
      titles.add(strs[5]);
    }
    check('compare title differs in all 6 languages', titles.size === 6, [...titles]);
    const layoutAll = async (tag) => {
      await chip('waistCm');
      const gg = await geo();
      const cmp = await ev(`(() => { const c = document.getElementById('body-compare-card').getBoundingClientRect(), tb = document.getElementById('cmp-table');
        const r = tb.getBoundingClientRect(); const bad = [...tb.querySelectorAll('th, td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
        return { inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5, bad, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
          small: [...document.querySelectorAll('#body-range-chips button, #body-metric-chips button, #cmp-a, #cmp-b')].filter((e) => e.getBoundingClientRect().height < 44).length }; })()`);
      check(tag + ': chart labels inside card, no overlap, no page overflow', gg.inside && gg.svgInside && !gg.overlap && gg.sw <= gg.vw, gg);
      check(tag + ': compare table inside card, cells not clipped, targets >= 44 px', cmp.inside && cmp.bad === 0 && cmp.sw <= cmp.vw && cmp.small === 0, cmp);
    };
    for (const [lang, theme, w, pct, file, what] of [
      ['sk', 'dark', 393, '', 'compare-table-sk-dark-393.png', 'cmp'], ['ar', 'light', 320, '', 'chart-ar-320.png', 'chart'],
      ['ar', 'light', 320, '130%', null, ''], ['fr', 'light', 320, '130%', null, ''], ['fr', 'dark', 320, '', null, ''], ['en', 'light', 393, '', null, ''],
    ]) {
      await view(w, 900);
      await ev(`(document.documentElement.style.fontSize = ${JSON.stringify(pct)}, setLang(${JSON.stringify(lang)}), setThemePref(${JSON.stringify(theme)}), switchTab('pokrok'), setPokrokView('body'), true)`); await wait(300);
      const tag = lang + '/' + theme + '/' + w + (pct ? '/' + pct : '');
      await layoutAll(tag);
      check(tag + ': dir ' + (lang === 'ar' ? 'rtl' : 'ltr') + ', chart time flows left to right', await ev(`document.documentElement.dir === ${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')} && getComputedStyle(document.getElementById('body-chart')).direction === 'ltr'`));
      if (file) { await scrollTo(what === 'cmp' ? 'body-compare-card' : 'body-chart-card'); await wait(200); await shot(file); }
    }
    await ev(`(document.documentElement.style.fontSize = '', true)`);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('suite ran without exception', false, String(e && e.stack || e)); }
  finally { closeAll(); server.close && server.close(); }
  console.log('\nPASS ' + t.pass + '  FAIL ' + t.fail);
  process.exit(t.fail ? 1 : 0);
})();
