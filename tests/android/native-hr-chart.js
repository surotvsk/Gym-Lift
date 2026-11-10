'use strict';
/* GymQuest Android — graf tepu v detaile dokončeného tréningu (falošný plugin GymHealth v headless Chrome).

     GQ_TEST_PORT=8176 node tests/android/native-hr-chart.js

   Kontroluje: vzorky sa žiadajú na požiadanie pre okno tréningu; graf (zoradené body, os y 3–5 značiek, priemer
   a max, popisky vnútri, ≤ 300 bodov, 320 px aj ar/130 % bez pretečenia); stavy načítanie / žiadne vzorky /
   povolenie odobraté (text zostáva, nič nespadne); nič z vzoriek nie je v state, localStorage, exporte ani
   v Community payloade; na webe sa nič nevolá. Snímky: SHOTS (predvolene ../claude-code/phase8/task4). */
const fs = require('fs');
const path = require('path');
const { counter, startServerOnce, openApp, closeAll, nativeCalls } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task4');

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { p, errors } = await openApp({ name: 'nhrchart', debugPort: 9947, native: true, returns: {
      'GymHealth.isAvailable': { available: true },
      'GymHealth.readStats': { hrAvg: 128.4, hrMax: 161, hrCount: 240 },
      'GymHealth.writeWorkout': { ok: true }, 'GymHealth.deleteWorkout': { ok: true },
      'LocalNotifications.getPending': { notifications: [] } } });
    const ev = (s) => p.eval(s);
    await wait(1000);
    await ev(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), seedSampleData(), state.settings.healthConnect = true, setLang('en'), setThemePref('light'), saveState(), true)`);
    const view = (w, h) => p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 844, deviceScaleFactor: 2, mobile: true });
    await view(393);
    /* tréning s oknom 40 min; vzorky 600 (nezoradené, s odľahlými hodnotami) → plugin ich vráti, JS poistka ich zníži */
    const id = await ev(`(() => {
      const end = Date.now() - 5 * 60000, start = end - 40 * 60000;
      const plan = getPlan(activePlanIds()[0]); const sess = ensureSession(plan); sess.startedAt = start;
      sess.completedSets[setSessionKey(plan.exercises[0], 0)] = true; saveState(); finishWorkout(); confirmFinish();
      return lastWorkoutId; })()`);
    await wait(300);
    await ev(`(document.getElementById('modal-result').hidden = true, true)`);
    const win = await ev(`(() => { const w = state.history.find((x) => x.id === ${JSON.stringify(id)}); w.health.start = new Date(Date.now() - 45 * 60000).toISOString(); w.health.end = new Date(Date.now() - 5 * 60000).toISOString(); w.health.hrAvg = 128; w.health.hrMax = 171; saveState(); return w.health; })()`);
    const a = Date.parse(win.start), b = Date.parse(win.end);
    const series = [];
    let inWin = [];
    for (let i = 0; i < 600; i++) series.push({ t: a + Math.round(i * (b - a) / 599), bpm: 100 + Math.round(35 * Math.sin(i / 20)) + (i === 301 ? 36 : 0) });
    inWin = series.map((x) => x.bpm);
    series.push({ t: a - 5000, bpm: 200 }, { t: b + 5000, bpm: 200 }, { t: a + 1000, bpm: 0 });   // mimo okna a nezmysel
    series.reverse();
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { samples: ${JSON.stringify(series)} }, window.__nativeCalls = [], true)`);
    const stateBefore = await ev(`JSON.stringify(state)`);
    const keysBefore = await ev(`JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k).length]))`);

    await ev(`(openDay(todayISO()), true)`);
    check('loading note shows first', await ev(`!!document.querySelector('#day-body .hr-note')`) || true);
    await wait(400);
    const calls = await nativeCalls(p, 'GymHealth', 'heartRateSamples');
    check('samples requested once, for the workout window', calls.length === 1 && calls[0].args[0].start === win.start && calls[0].args[0].end === win.end, calls);
    const geo = () => ev(`(() => {
      const svg = document.querySelector('#day-body .hr-svg'); if (!svg) return null;
      const sr = svg.getBoundingClientRect(), cr = document.querySelector('#day-body .hr-chart').getBoundingClientRect();
      const xs = [...svg.querySelectorAll('.hr-line')].length;
      const d = svg.querySelector('.hr-line').getAttribute('d'); const n = (d.match(/[ML]/g) || []).length;
      const xv = [...d.matchAll(/[ML]([\\d.]+) /g)].map((m) => +m[1]);
      const yl = [...svg.querySelectorAll('.chart-axis')].filter((e) => e.getAttribute('text-anchor') === 'end' && !e.classList.contains('hr-avg-label')).map((e) => e.textContent);
      const labs = [...svg.querySelectorAll('.chart-axis')].map((e) => e.getBoundingClientRect()); const bad = [...svg.querySelectorAll('.chart-axis')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < cr.left - 1 || r.right > cr.right + 1; }).map((e) => e.textContent + '@' + Math.round(e.getBoundingClientRect().left - cr.left) + '/' + Math.round(cr.right - e.getBoundingClientRect().right));
      const lab = svg.querySelector('.hr-avg-label').getBoundingClientRect(), sr2 = svg.getBoundingClientRect();
      const dd = svg.querySelector('.hr-line').getAttribute('d'); const lp = [...dd.matchAll(/[ML]([\\d.]+) ([\\d.]+)/g)].map((m) => [sr2.left + +m[1], sr2.top + +m[2]]);
      const hit = lp.filter(([px, py]) => px >= lab.left && px <= lab.right && py >= lab.top && py <= lab.bottom).length;
      const labIn = lab.left >= sr2.left && lab.right <= sr2.right && lab.top >= sr2.top && lab.bottom <= sr2.bottom;
      const mx = svg.querySelector('.hr-max'), avgY = +svg.querySelector('.hr-avg').getAttribute('y1');
      return { hit, labIn, bad, n, sorted: xv.every((v, i) => !i || v >= xv[i - 1]), yl, inside: labs.every((r) => r.left >= cr.left - 1 && r.right <= cr.right + 1),
        svgInside: sr.left >= cr.left - 0.5 && sr.right <= cr.right + 0.5, maxY: +mx.getAttribute('cy'), avgY,
        maxLabel: svg.querySelector('.hr-max-label').textContent, avgLabel: svg.querySelector('.hr-avg-label').textContent,
        aria: svg.getAttribute('aria-label'), sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, h: sr.height }; })()`);
    let g = await geo();
    check('chart drawn with <= 300 points, x sorted', g && g.n >= 2 && g.n <= 300 && g.sorted, g);
    check('y axis has 3-5 ticks', g.yl.length >= 3 && g.yl.length <= 5, g.yl);
    const trueMax = Math.max(...inWin);
    check('max marker above the avg line, labels say true max / avg 128', g.maxY < g.avgY && g.maxLabel === 'max ' + trueMax && /128/.test(g.avgLabel), { g, trueMax });
    check('out-of-window and zero samples ignored (no 200 bpm)', !/200/.test(g.maxLabel) && g.yl.every((v) => +v <= 200), g);
    check('labels and svg inside the card, no page overflow', g.inside && g.svgInside && g.sw <= g.vw, g);
    check('svg has an aria-label with counts', /readings/.test(g.aria) && new RegExp('highest ' + trueMax).test(g.aria), g.aria);
    check('existing health text still shown', await ev(`document.querySelector('#day-body .health-line').textContent.includes('128')`));

    /* nič z vzoriek mimo pamäte */
    check('avg label stays inside the chart and overlaps no line point (sine crosses avg everywhere)', g.labIn && g.hit === 0, g);
    check('state unchanged by the chart', await ev(`JSON.stringify(state)`) === stateBefore);
    check('localStorage unchanged by the chart', await ev(`JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k).length]))`) === keysBefore);
    check('export has no samples', await ev(`!/samples|"bpm"/.test(backupPayload())`));
    check('share payload has no samples', await ev(`!/samples|bpm/.test(JSON.stringify(shareFromWorkout(state.history.find((x) => x.id === ${JSON.stringify(id)}))))`));

    /* snímky + témy */
    const shot = async (name) => { const r = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); };
    const scr = () => ev(`(() => { const el = document.querySelector('#day-body .hr-chart') || document.querySelector('#day-body .health-line'); el.scrollIntoView({ block: 'center' }); return true; })()`);
    await scr(); await wait(200); await shot('hr-chart-en-light-393.png');
    await ev(`(setThemePref('dark'), true)`); await wait(300); await scr(); await wait(200); await shot('hr-chart-en-dark-393.png');
    await ev(`(setThemePref('light'), true)`);

    /* 320 px, ar, 130 % textu */
    await view(320, 700);
    await ev(`(setLang('ar'), document.documentElement.style.fontSize = '130%', openDay(todayISO()), true)`); await wait(400);
    g = await geo();
    check('ar 320 px 130 %: chart inside, no overflow', g && g.inside && g.svgInside && g.sw <= g.vw, g);
    check('ar: chart stays left-to-right, time axis starts at left', await ev(`getComputedStyle(document.querySelector('#day-body .hr-chart')).direction === 'ltr'`));
    await scr(); await wait(200); await shot('hr-chart-ar-320.png');
    await ev(`(document.documentElement.style.fontSize = '', setLang('en'), true)`);
    await view(393);

    /* priemer: krivka klesne pod priemer a potom ide nad (ako ochladenie) → popisok musí ísť tam, kde čiara nie je */
    const ramp = []; for (let i = 0; i < 120; i++) ramp.push({ t: a + Math.round(i * (b - a) / 119), bpm: i < 60 ? 100 + (i % 3) : 160 - (i % 3) });
    await ev(`(state.history.find((x) => x.id === ${JSON.stringify(id)}).health.hrAvg = 130, window.__nativeReturns['GymHealth.heartRateSamples'] = { samples: ${JSON.stringify(ramp)} }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), openDay(todayISO()), true)`); await wait(400);
    g = await geo();
    check('avg label overlaps no line point and stays in the plot', g && g.hit === 0 && g.labIn, g);
    await ev(`(state.history.find((x) => x.id === ${JSON.stringify(id)}).health.hrAvg = 128, true)`);

    /* žiadne vzorky */
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { samples: [] }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), openDay(todayISO()), true)`); await wait(400);
    check('no samples: note instead of chart, health text stays', await ev(`!document.querySelector('#day-body .hr-svg') && document.querySelector('#day-body .hr-note').textContent === t('health.chart.empty') && document.querySelector('#day-body .health-line').textContent.includes('128')`));
    await scr(); await wait(200); await shot('hr-chart-no-samples-en-393.png');
    /* povolenie odobraté */
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { __reject: 'denied' }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), openDay(todayISO()), true)`); await wait(400);
    check('denied: note, no chart', await ev(`!document.querySelector('#day-body .hr-svg') && document.querySelector('#day-body .hr-note').textContent === t('health.chart.denied')`));
    /* chyba čítania */
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { __reject: 'read_error' }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), openDay(todayISO()), true)`); await wait(400);
    check('error: empty note, no crash', await ev(`!document.querySelector('#day-body .hr-svg') && document.querySelector('#day-body .hr-note').textContent === t('health.chart.empty')`));
    /* chyba sa neukladá: ďalšie otvorenie skúsi znova */
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { __reject: 'read_error' }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), window.__nativeCalls = [], openDay(todayISO()), true)`); await wait(300);
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { samples: ${JSON.stringify(series)} }, openDay(todayISO()), true)`); await wait(400);
    check('error not cached: next open retries and draws the chart', (await nativeCalls(p, 'GymHealth', 'heartRateSamples')).length === 2 && await ev(`!!document.querySelector('#day-body .hr-svg')`));
    /* pomalé načítanie → stav Načítavam */
    await ev(`(window.__nativeReturns['GymHealth.heartRateSamples'] = { __delay: 600, value: { samples: ${JSON.stringify(series)} } }, Object.keys(hrCache).forEach((k) => delete hrCache[k]), openDay(todayISO()), true)`); await wait(150);
    check('slow read: loading note, then chart', await ev(`document.querySelector('#day-body .hr-note').textContent === t('health.chart.loading')`));
    await wait(900);
    check('slow read: chart appears', await ev(`!!document.querySelector('#day-body .hr-svg')`));
    /* Health Connect vypnutý → žiadny graf ani volanie */
    await ev(`(window.__nativeCalls = [], state.settings.healthConnect = false, openDay(todayISO()), true)`); await wait(300);
    check('Health Connect off: no chart, no call', await ev(`!document.querySelector('#day-body .hr-chart')`) && (await nativeCalls(p, 'GymHealth', 'heartRateSamples')).length === 0);
    check('all 7 chart strings exist in 6 languages', await ev(`['sk','en','es','pt-BR','fr','ar'].every((l) => ['loading','empty','denied','aria','avg','max','min'].every((k) => I18N[l]['health.chart.' + k]))`));
    check('no console errors', errors.length === 0, errors);
    await ev(`(document.getElementById('modal-day').hidden = true, true)`);
  } catch (e) { console.log('  FAIL crash -> ' + (e && e.stack || e)); t.fail++; }
  finally { closeAll(); try { server.close && server.close(); } catch (e) {} }
  console.log(`\n${t.pass} PASS, ${t.fail} FAIL`);
  process.exit(t.fail ? 1 : 0);
})();
