'use strict';
/* Google Play snímky grafu tepu (1080×1920, svetlý a tmavý režim, en).
   Skutočné UI appky (História → dokončený tréning) v headless Chrome s falošným pluginom GymHealth.
   Ukážková krivka tepu žije LEN v tomto skripte – nikdy nie v appke.

     GQ_TEST_PORT=8179 node tools/play-listing/hr-shots.js [výstupný priečinok]
   Predvolený výstup: ../claude-code/play-listing/heart-rate/ */
const fs = require('fs');
const path = require('path');
const { startServerOnce, openApp, closeAll } = require('../../tests/android/lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || path.resolve(__dirname, '../../../claude-code/play-listing/heart-rate');

/* 55 min: rozcvička, 5 cvikov × 3 série (série ~45 s = tep ide hore, pauza ~90 s = klesá), schladenie. Deterministický šum. */
function demoSeries(startMs) {
  const out = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let sec = 0; sec <= 55 * 60; sec += 10) {
    const m = sec / 60; let hr;
    if (m < 6) hr = 96 + (m / 6) * 14;                                  // rozcvička
    else if (m < 49) {
      const cyc = (m - 6) % 2.6, setNo = Math.floor((m - 6) / 2.6);   // 2,6 min = séria + pauza
      const ramp = Math.min(1, 0.55 + setNo * 0.03), peak = 128 + 37 * ramp * (0.85 + 0.15 * Math.sin(setNo * 1.7));
      hr = cyc < 0.8 ? 118 + (peak - 118) * (cyc / 0.8) : peak - (peak - 116) * Math.min(1, (cyc - 0.8) / 1.8);
    } else hr = 128 - (m - 49) * 5;                                       // schladenie
    out.push({ t: startMs + sec * 1000, bpm: Math.max(60, Math.min(168, Math.round(hr + (rnd() - 0.5) * 5))) });
  }
  return out;
}

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const { p } = await openApp({ name: 'hrshots', debugPort: 9951, native: true, returns: {
      'GymHealth.isAvailable': { available: true }, 'GymHealth.writeWorkout': { ok: true }, 'GymHealth.deleteWorkout': { ok: true },
      'LocalNotifications.getPending': { notifications: [] } } });
    await wait(1000);
    await p.eval(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), seedSampleData(), state.settings.healthConnect = true, setLang('en'), saveState(), true)`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
    const id = await p.eval(`(() => {
      const plan = getPlan(activePlanIds()[0]); const sess = ensureSession(plan); sess.startedAt = Date.now() - 55 * 60000;
      plan.exercises.forEach((ex) => { for (let i = 0; i < 3; i++) sess.completedSets[setSessionKey(ex, i)] = true; });
      saveState(); finishWorkout(); confirmFinish(); return lastWorkoutId; })()`);
    await wait(400);
    await p.eval(`(document.getElementById('modal-result').hidden = true, true)`);
    const end = Date.now() - 3 * 60000, start = end - 55 * 60000;
    const series = demoSeries(start);
    const avg = Math.round(series.reduce((a, s) => a + s.bpm, 0) / series.length), max = Math.max(...series.map((s) => s.bpm));
    await p.eval(`(() => { const w = state.history.find((x) => x.id === ${JSON.stringify(id)});
      w.health = { start: new Date(${start}).toISOString(), end: new Date(${end}).toISOString(), hrAvg: ${avg}, hrMax: ${max}, kcal: 342, readAt: new Date().toISOString() };
      saveState(); window.__nativeReturns['GymHealth.heartRateSamples'] = { samples: ${JSON.stringify(series)} }; return true; })()`);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(setThemePref(${JSON.stringify(theme)}), openDay(todayISO()), true)`);
      await wait(600);
      await p.eval(`(() => { const b = document.getElementById('day-body'); const el = b.querySelector('.hr-chart'); const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top; b.scrollTop += top - 150; return true; })()`);
      await wait(250);
      const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUT, `heart-rate-chart-en-${theme}-1080x1920.png`);
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('saved', f, 'avg', avg, 'max', max);
    }
  } finally { closeAll(); try { server.close && server.close(); } catch (e) {} }
  process.exit(0);
})();
