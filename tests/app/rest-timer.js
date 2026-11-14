'use strict';
/* GymQuest — karta časovača oddychu (v97): Pozastaviť/Pokračovať, +15 s, Znova, Zastaviť, nahradenie,
   zvýraznená predvoľba a starý uložený formát. Reálny headless Chrome, bez účtov a siete.

     GQ_TEST_PORT=8190 node tests/app/rest-timer.js

   Screenshoty (GQ_SHOTS=<dir>): beží / pozastavené / dlaždica Dnes / hláška "Nahradené", en+ar, light+dark, 393 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-resttimer');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('resttimer-' + Date.now().toString(36), 9891, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ev = (x) => p.eval(x);
  const time = () => ev(`document.getElementById('timer-time').textContent`);
  const secs = async () => { const [m, s] = (await time()).split(':').map(Number); return m * 60 + s; };
  const cardVisible = () => ev(`(() => { const c = document.getElementById('timer-bar'); return !c.hidden && c.getClientRects().length > 0; })()`);
  const pressed = () => ev(`Array.from(document.querySelectorAll('#timer-presets .timer-preset')).filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)`);
  const click = (id) => ev(`(document.getElementById(${J(id)}).click(), true)`);
  const preset = (sec) => ev(`(startPreset(state.settings.restPresets.find((x) => x.seconds === ${sec}).id), true)`);
  const shot = async (name) => {
    if (process.env.GQ_SCREENSHOTS === '0' || !SHOTS) return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.data, 'base64'));
  };
  try {
    await p.navigate(BASE);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await ev(`(state.plans['rt'] = { id: 'rt', builtin: false, customName: 'Rest test', location: null,
      exercises: [{ id: 'cx-r1', name: 'Bench test', sets: 12, reps: 8, weight: 60 }] },
      state.planOrder.includes('rt') || state.planOrder.push('rt'), selectedPlan = 'rt', ensureSession(), saveState(), switchTab('trening'), renderTrening(), true)`);
    await wait(300);
    await ev(`(openRestSheet(), true)`);

    console.log('== start 90, then replace by 120');
    check('card hidden before any timer', !(await cardVisible()));
    await preset(90); await wait(100);
    check('card visible, ~1:30', (await cardVisible()) && Math.abs((await secs()) - 90) <= 2, await time());
    check('time font >= 36 px', (await ev(`parseFloat(getComputedStyle(document.getElementById('timer-time')).fontSize)`)) >= 36);
    check('90 s chip pressed', J(await pressed()) === J(['90 s']), await pressed());
    check('no replaced message for the first timer', await ev(`document.getElementById('timer-note').hidden`));
    await preset(120); await wait(100);
    check('"Replaced 90 s with 120 s" shown', (await ev(`document.getElementById('timer-note').textContent`)) === 'Replaced 90 s with 120 s', await ev(`document.getElementById('timer-note').textContent`));
    check('pressed chip moved to 120 s', J(await pressed()) === J(['120 s']), await pressed());
    check('stored value is v2 JSON with totalMs and presetId', await ev(`(() => { const v = JSON.parse(localStorage.gymquest_resttimer); return v.v === 2 && v.totalMs === 120000 && !!v.presetId && v.pausedLeftMs === null; })()`));
    check('stored value is not in state', !(await ev(`JSON.stringify(state).includes('gymquest_resttimer') || JSON.stringify(state).includes('pausedLeftMs')`)));
    await shot('01-replaced');
    check('buttons >= 44 px (incl. round Stop)', await ev(`Array.from(document.querySelectorAll('#timer-bar .timer-btn')).every((x) => x.getBoundingClientRect().height >= 44 && x.getBoundingClientRect().width >= 44)`));
    check('card height <= 112 px at 393 px (with the Replaced note showing)', (await ev(`document.getElementById('timer-bar').getBoundingClientRect().height`)) <= 112, await ev(`document.getElementById('timer-bar').getBoundingClientRect().height`));
    check('Replaced note replaces the label (label hidden, note visible)', await ev(`getComputedStyle(document.getElementById('timer-label')).display === 'none' && !document.getElementById('timer-note').hidden`));

    console.log('== +15, pause, resume, restart');
    const before = await secs();
    await click('timer-add'); await wait(100);
    check('+15 s adds 15', Math.abs((await secs()) - (before + 15)) <= 1, [before, await secs()]);
    await click('timer-pause'); await wait(100);
    const frozen = await secs();
    check('paused: label Paused, button Resume, Today tile text', await ev(`document.getElementById('timer-label').textContent === 'Paused' && document.getElementById('timer-pause').textContent === 'Resume'`));
    await wait(2200);
    check('time frozen across 2 s', (await secs()) === frozen, [frozen, await secs()]);
    await shot('02-paused');
    await p.reload();
    await ev(`(switchTab('trening'), true)`); await wait(300);
    check('paused survives reload: visible and still frozen', (await cardVisible()) && (await secs()) === frozen && (await ev(`document.getElementById('timer-pause').textContent`)) === 'Resume', [frozen, await secs()]);
    check('+15 while paused adds 15', await (async () => { await click('timer-add'); return (await secs()) === frozen + 15; })());
    await click('timer-pause'); await wait(1200);
    const resumed = await secs();
    check('resume continues counting down', resumed <= frozen + 15 - 1 && resumed >= frozen + 15 - 3, [frozen, resumed]);
    check('after reload the preset chip is still marked', J(await ev(`(openRestSheet(), Array.from(document.querySelectorAll('#timer-presets .timer-preset')).filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent))`)) === J(['120 s']));
    await click('timer-restart'); await wait(100);
    check('restart = full preset again (2:00), no replaced note', Math.abs((await secs()) - 120) <= 2 && (await ev(`document.getElementById('timer-note').hidden`)), await time());

    console.log('== one tap: preset starts the countdown and closes the sheet (real UI)');
    await click('timer-stop'); await wait(100);
    const sheetOpen = () => ev(`!document.getElementById('modal-rest').hidden`);
    const chip = (sec) => ev(`(() => { const p = state.settings.restPresets.find((x) => x.seconds === ${sec}); document.querySelector('#timer-presets .timer-preset[data-preset-id="' + p.id + '"]').click(); return true; })()`);
    await click('btn-open-rest'); await wait(150);
    check('Rest button opens the sheet', await sheetOpen());
    await chip(60); await wait(150);
    check('tapping 60 s closes the sheet and its dimmed overlay', !(await sheetOpen()) && (await ev(`getComputedStyle(document.getElementById('modal-rest')).display`)) === 'none');
    check('countdown card shows "Rest" and mm:ss ~01:00 right away', (await cardVisible()) && /^\d\d:\d\d$/.test(await time()) && Math.abs((await secs()) - 60) <= 2
      && (await ev(`document.getElementById('timer-note').hidden ? document.getElementById('timer-label').textContent : 'Rest'`)) === 'Rest', await time());
    check('countdown is running (time decreases)', await (async () => { const a = await secs(); await wait(1300); return (await secs()) < a; })());
    check('card does not cover the focused set input', await ev(`(() => { const i = document.querySelector('#exercise-list input.set-weight'); i.focus(); i.scrollIntoView({ block: 'center' }); const a = i.getBoundingClientRect(), c = document.getElementById('timer-bar').getBoundingClientRect(); return a.bottom <= c.top || a.top >= c.bottom; })()`));
    const sid0 = await ev(`timerSessionId`);
    await click('btn-open-rest'); await wait(150);
    await chip(120); await wait(150);
    check('second preset replaces the running timer: one new timer, sheet closed, ~02:00, "Replaced 60 s with 120 s"',
      (await ev('timerSessionId')) === sid0 + 1 && !(await sheetOpen()) && Math.abs((await secs()) - 120) <= 2
      && (await ev(`document.getElementById('timer-note').textContent`)) === 'Replaced 60 s with 120 s', [await ev(`timerSessionId`) - sid0, await time()]);
    check('only one countdown card exists', (await ev(`document.querySelectorAll('#timer-bar, .timer-bar').length`)) === 1);
    console.log('== Custom: closes after confirming the duration');
    await click('btn-open-rest'); await wait(150);
    await click('btn-custom-timer'); await wait(150);
    check('opening Custom keeps the sheet open (no timer change yet)', (await sheetOpen()) && Math.abs((await secs()) - 120) <= 3);
    await ev(`(document.getElementById('ct-minutes').value = '1', document.getElementById('ct-seconds').value = '15', document.getElementById('ct-seconds').dispatchEvent(new Event('input')), true)`);
    await click('btn-start-custom'); await wait(150);
    check('Start once closes the sheet and runs ~01:15, replacing the old timer', !(await sheetOpen()) && Math.abs((await secs()) - 75) <= 2 && (await ev('timerSessionId')) === sid0 + 2, await time());
    await click('btn-open-rest'); await wait(150);
    await click('btn-custom-timer'); await wait(150);
    await ev(`(document.getElementById('ct-minutes').value = '', document.getElementById('ct-seconds').value = '', true)`);
    await click('btn-start-custom'); await wait(150);
    check('an invalid custom time shows the error and keeps the sheet open and the timer unchanged', (await sheetOpen()) && !(await ev(`document.getElementById('ct-error').hidden`)) && (await ev('timerSessionId')) === sid0 + 2);
    await ev(`(closeRestSheet(), true)`);
    await ev(`(openRestSheet(), true)`);

    console.log('== stop');
    await click('timer-stop'); await wait(100);
    check('stop hides the card, clears storage and chip', !(await cardVisible()) && (await ev(`localStorage.getItem('gymquest_resttimer')`)) === null && (await pressed()).length === 0);

    console.log('== a paused timer never completes');
    await ev(`(startTimer(2, null), true)`); await wait(300);
    await click('timer-pause'); await wait(2800);
    check('2 s timer paused for 2.8 s is not done', await ev(`!document.getElementById('timer-bar').classList.contains('done') && timerCompletedId !== timerSessionId`));
    await click('timer-pause'); await wait(2600);
    check('after resume it completes (done card, Restart offered, no Pause)', await ev(`document.getElementById('timer-bar').classList.contains('done') && !document.getElementById('timer-restart').hidden && document.getElementById('timer-pause').hidden`));
    await click('timer-stop');

    console.log('== legacy v96 key (plain number)');
    await ev(`(localStorage.gymquest_resttimer = String(Date.now() + 60000), true)`);
    await p.reload();
    await ev(`(switchTab('trening'), true)`); await wait(300);
    check('card shows ~1:00', (await cardVisible()) && Math.abs((await secs()) - 60) <= 2, await time());
    check('legacy: no preset marked, pause works', (await pressed()).length === 0 && (await click('timer-pause'), (await ev(`timerPausedLeft !== null`))));
    await click('timer-stop');
    await ev(`(localStorage.gymquest_resttimer = String(Date.now() - 5000), true)`);
    await p.reload(); await wait(300);
    check('legacy expired key: done card without crash', await ev(`document.getElementById('timer-bar').classList.contains('done')`));
    await click('timer-stop');

    console.log('== Today tile and layout');
    await preset(90);
    await ev(`(switchTab('dnes'), true)`); await wait(300);
    check('Today tile shows countdown and the card is visible there', /^\d\d:\d\d$/.test(await ev(`document.getElementById('bt-rest-line').textContent`)) && (await cardVisible()));
    await ev(`(document.getElementById('bt-rest').scrollIntoView({ block: 'center' }), true)`); await wait(200);
    await shot('03-today-running');
    await click('timer-pause'); await wait(200);
    check('Today tile shows Paused', /^\d\d:\d\d\nPaused$/.test(await ev(`document.getElementById('bt-rest-line').textContent`)), await ev(`document.getElementById('bt-rest-line').textContent`));
    await shot('04-today-paused');
    await click('timer-pause');
    await ev(`(switchTab('trening'), renderTrening(), true)`); await wait(300);
    const lay = await ev(`(() => { const f = document.getElementById('finish-bar').getBoundingClientRect(), c = document.getElementById('timer-bar').getBoundingClientRect();
      const tb = document.querySelector('.tab-bar').getBoundingClientRect();
      return { fTop: f.top, cBottom: c.bottom, cTop: c.top, tbTop: tb.top, sticky: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom')), ih: innerHeight, over: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
    check('card sits above the finish bar, no overlap', lay.cBottom <= lay.fTop + 0.5 && lay.fTop < lay.tbTop, lay);
    check('--sticky-bottom covers finish bar + card', Math.abs(lay.sticky - (lay.ih - lay.cTop)) <= 1, lay);
    check('no horizontal overflow', !lay.over, lay);
    await shot('05-workout-running');
    const cover = await ev(`(() => { const inputs = Array.from(document.querySelectorAll('input.set-reps')); const el = inputs[inputs.length - 1];
      el.focus(); el.scrollIntoView({ block: 'nearest' }); return new Promise((res) => setTimeout(() => { const r = el.getBoundingClientRect(), c = document.getElementById('timer-bar').getBoundingClientRect();
        res({ bottom: r.bottom, cardTop: c.top }); }, 400)); })()`);
    check('focused last set input is not covered by the card', cover.bottom <= cover.cardTop + 0.5, cover);
    await click('timer-stop'); await wait(100);
    const sb = await ev(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom'))`);
    await ev(`(switchTab('dnes'), true)`);
    check('--sticky-bottom is 0 on another tab (switchTab updates it)', (await ev(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom'))`)) === 0 && sb > 0, sb);

    console.log('== finish bar is opaque');
    for (const theme of ['light', 'dark']) {
      for (const disabled of [false, true]) {
        await ev(`(setThemePref(${J(theme)}), switchTab('trening'), renderTrening(), setFinishDisabled(${disabled}), true)`); await wait(200);
        const al = await ev(`(() => { const a = (el) => { const m = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g); return m.length > 3 ? Number(m[3]) : 1; };
          const bar = document.getElementById('finish-bar'); const btn = document.getElementById('btn-finish-workout');
          return { bar: a(bar), btn: a(btn), barOp: getComputedStyle(bar).opacity, btnOp: getComputedStyle(btn).opacity }; })()`);
        check(theme + (disabled ? ' disabled' : ' enabled') + ': #finish-bar and its button background alpha is 1, no opacity', al.bar === 1 && al.btn === 1 && al.barOp === '1' && al.btnOp === '1', al);
      }
    }
    await ev(`(setFinishDisabled(true), setThemePref('light'), true)`);

    console.log('== 320 px, long languages');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
    for (const lang of ['ar', 'fr', 'es']) {
      await ev(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), startPreset(state.settings.restPresets.find((x) => x.seconds === 60).id), startPreset(state.settings.restPresets.find((x) => x.seconds === 120).id), true)`); await wait(250);
      const r = await ev(`(() => { const c = document.getElementById('timer-bar').getBoundingClientRect(); const bs = Array.from(document.querySelectorAll('#timer-bar .timer-btn'));
        const n = document.getElementById('timer-note'); return { h: c.height, clipped: bs.some((x) => x.scrollWidth > x.clientWidth + 1), noteClipped: n.scrollHeight > n.clientHeight + 1, inView: c.left >= 0 && c.right <= innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
      check(lang + ' @320: height <= 112, nothing clipped/overflowing', r.h <= 112 && !r.clipped && !r.noteClipped && r.inView && !r.over, r);
      await click('timer-stop');
    }
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });

    console.log('== languages / themes');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      for (const theme of ['light', 'dark']) {
        await ev(`(setLang(${J(lang)}), setThemePref(${J(theme)}), switchTab('trening'), renderTrening(), startPreset(state.settings.restPresets.find((x) => x.seconds === 60).id), startPreset(state.settings.restPresets.find((x) => x.seconds === 90).id), true)`);
        await wait(250);
        const r = await ev(`(() => { const bs = Array.from(document.querySelectorAll('#timer-bar .timer-btn')); const c = document.getElementById('timer-bar').getBoundingClientRect();
          return { txt: bs.map((x) => x.textContent), clipped: bs.some((x) => x.scrollWidth > x.clientWidth + 1), note: document.getElementById('timer-note').textContent, tile: document.getElementById('bt-rest-line').textContent,
            raw: [].concat(bs.map((x) => x.textContent), [document.getElementById('timer-label').textContent]).some((x) => /^rest\\./.test(x)), dir: document.documentElement.dir,
            inView: c.left >= 0 && c.right <= innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
        check(lang + '/' + theme + ': labels translated, nothing clipped, in view, no overflow', r.txt.every(Boolean) && !r.raw && !r.clipped && r.inView && !r.over && /\S/.test(r.note), r);
        if (lang === 'ar') check('ar/' + theme + ': rtl', r.dir === 'rtl');
        if (lang === 'en' || lang === 'ar') {
          await shot('workout-running-' + lang + '-' + theme);
          await click('timer-pause'); await wait(150);
          await shot('workout-paused-' + lang + '-' + theme);
          await ev(`(switchTab('dnes'), document.getElementById('bt-rest').scrollIntoView({ block: 'center' }), true)`); await wait(250);
          await shot('today-paused-' + lang + '-' + theme);
          await ev(`(switchTab('trening'), true)`);
        }
        await click('timer-stop');
      }
    }
    await ev(`(setLang('en'), setThemePref('light'), true)`);
    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
