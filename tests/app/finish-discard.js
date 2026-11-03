'use strict';
/* GymQuest — veľké Dokončiť s potvrdením "Uložiť tréning?" a Zahodiť v ⋯ menu s dvoma krokmi (v97),
   v reálnom headless Chrome. Bez účtov a siete: appka beží s prázdnou Community konfiguráciou.

     GQ_TEST_PORT=8190 node tests/app/finish-discard.js

   Checks: obe tlačidlá Dokončiť (lepivá lišta, tlačidlo pod cvikmi) otvoria okno; "Keep training" ho zavrie bez
   zmeny histórie; Save uloží presne 1 záznam aj pri 3 rýchlych kliknutiach / Enter; Dokončiť je vypnuté bez
   hotovej série; Zahodiť nie je vidieť, kým sa neotvorí ⋯; Zahodiť má 2 potvrdenia, Zrušiť v oboch krokoch
   ponechá tréning; po zahodení žiadna zmena histórie/XP; lepivá lišta nezakrýva zaostrené pole váhy poslednej série
   (393x700); Esc zavrie okno aj menu; 6 jazykov. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-finish');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('finish-' + Date.now().toString(36), 9891, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const $ = (id) => `document.getElementById(${J(id)})`;
  const click = (id) => p.eval(`(${$(id)}.click(), true)`);
  const hist = () => p.eval(`state.history.filter((w) => w.planId === 'ftest').length`);
  const xp = () => p.eval(`JSON.stringify(state.history.map((w) => w.xp))`);
  const vis = (id) => p.eval(`(() => { const e = ${$(id)}; return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  const confirmOpen = () => p.eval(`!${$('modal-confirm')}.hidden`);
  const genericOpen = () => p.eval(`!${$('modal-generic')}.hidden`);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const markSet = () => p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[0].click(), true)`);
  const startSession = async () => {
    await p.eval(`(() => {
      state.plans['ftest'] = { id: 'ftest', builtin: false, customName: 'Finish test', location: null,
        exercises: [1, 2, 3, 4, 5].map((n) => ({ id: 'cx-f' + n, name: 'Move ' + n, sets: 3, reps: 10, weight: 20 })) };
      if (!state.planOrder.includes('ftest')) state.planOrder.push('ftest');
      selectedPlan = 'ftest'; ensureSession(); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
  };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 700, deviceScaleFactor: 2, mobile: true });
    await startSession();

    console.log('== Finish bar and buttons');
    check('sticky bar is visible during a session', await vis('finish-bar'));
    check('exactly one Finish button (no second one under the exercises)', (await p.eval(`document.querySelectorAll('#btn-finish-workout-end, #tr-session button.btn-primary').length`)) === 0 && (await p.eval(`document.querySelectorAll('#btn-finish-workout').length`)) === 1);
    check('Finish is disabled with no completed set', await p.eval(`${$('btn-finish-workout')}.disabled`));
    await click('btn-finish-workout');
    check('clicking disabled Finish (no sets) does nothing', !(await confirmOpen()));
    await markSet();
    check('Finish enables after one completed set', await p.eval(`!${$('btn-finish-workout')}.disabled`));
    check('bar button shows XP gain', /\+\d+ XP/.test(await p.eval(`${$('tr-finish-xp')}.textContent`)));

    for (const id of ['btn-finish-workout']) {
      await click(id);
      check(id + ' opens the "Save workout?" sheet', (await confirmOpen()) && (await p.eval(`${$('modal-confirm')}.querySelector('h3').textContent`)) === 'Save workout?');
      check('sheet buttons: "Save workout" / "Keep training"', (await p.eval(`${$('btn-confirm-ok')}.textContent`)) === 'Save workout' && (await p.eval(`${$('btn-confirm-cancel')}.textContent`)) === 'Keep training');
      await click('btn-confirm-cancel');
      check('Keep training closes the sheet, nothing saved, session stays', !(await confirmOpen()) && (await hist()) === 0 && (await p.eval(`!!getSession() && totalSetsDone() === 1`)));
    }

    console.log('== Esc');
    await click('btn-finish-workout');
    await esc();
    check('Esc closes the sheet without saving', !(await confirmOpen()) && (await hist()) === 0);

    console.log('== Sticky bar vs focused input (393x700)');
    await p.eval(`(window.scrollTo(0, 0), true)`);
    await p.eval(`(() => { const l = document.querySelectorAll('#exercise-list .exercise'); const last = l[l.length - 1]; const ins = last.querySelectorAll('input.set-weight'); ins[ins.length - 1].focus(); return true; })()`);
    await wait(500);
    const geo = await p.eval(`(() => { const l = document.querySelectorAll('#exercise-list .exercise'); const last = l[l.length - 1]; const ins = last.querySelectorAll('input.set-weight'); const i = ins[ins.length - 1].getBoundingClientRect(); const f = ${$('finish-bar')}.getBoundingClientRect(); return { inBottom: i.bottom, barTop: f.top, sticky: getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom'), vh: innerHeight }; })()`);
    check('--sticky-bottom is set to the real bar height (> 0)', parseInt(geo.sticky, 10) > 40, geo);
    check('focused last-set weight input is above the sticky bar', geo.inBottom <= geo.barTop + 0.5, geo);
    await p.eval(`(document.activeElement.blur(), true)`);

    console.log('== Bottom of the workout: nothing hidden behind the Finish bar, rest card or menu');
    const bottomGeo = async () => p.eval(`(() => { window.scrollTo(0, document.documentElement.scrollHeight); const sess = document.getElementById('tr-session'); const kids = [...sess.children].filter((e) => e.getClientRects().length); const last = kids[kids.length - 1].getBoundingClientRect(); const bar = ${$('finish-bar')}.getBoundingClientRect(); const card = document.getElementById('timer-bar'); const c = (!card.hidden && card.getClientRects().length) ? card.getBoundingClientRect() : null; const tab = document.querySelector('.tab-bar').getBoundingClientRect(); return { lastBottom: last.bottom, barTop: bar.top, barBottom: bar.bottom, cardTop: c ? c.top : null, cardBottom: c ? c.bottom : null, tabTop: tab.top }; })()`);
    let g = await bottomGeo();
    check('scrolled to the end, the last item sits above the Finish bar', g.lastBottom <= g.barTop + 0.5, g);
    check('Finish bar fully visible above the menu', g.barBottom <= g.tabTop + 0.5, g);
    await p.eval(`(startPreset(state.settings.restPresets.find((x) => x.seconds === 60).id), true)`); await wait(300);
    g = await bottomGeo();
    check('with the rest card running, the last item is above the card and the card does not overlap the Finish bar', g.cardTop !== null && g.lastBottom <= g.cardTop + 0.5 && g.cardBottom <= g.barTop + 0.5, g);
    await p.eval(`(stopTimer(), renderRestCard && renderRestCard(), true)`); await wait(200);
    await p.eval(`(window.scrollTo(0, 0), true)`);

    console.log('== Save: exactly one history entry under rapid taps');
    const xpBefore = await xp(), xpShown = parseInt((await p.eval(`${$('tr-finish-xp')}.textContent`)).replace(/[^0-9]/g, ''), 10);
    await p.eval(`(() => { ${$('btn-finish-workout')}.click(); ${$('btn-finish-workout')}.click(); ${$('btn-finish-workout')}.click(); return true; })()`);
    check('3 rapid Finish clicks open one sheet', await confirmOpen());
    await p.eval(`(() => { const n = ${$('confirm-note')}; for (let i = 0; i < 3; i++) n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); ${$('btn-confirm-ok')}.click(); ${$('btn-confirm-ok')}.click(); return true; })()`);
    await wait(300);
    check('exactly one history entry after 3 Enter + 2 Save clicks', (await hist()) === 1, await hist());
    check('XP is awarded once, exactly the amount shown on the Finish button', JSON.parse(await xp()).reduce((x, y) => x + (Number(y) || 0), 0) - JSON.parse(xpBefore).reduce((x, y) => x + (Number(y) || 0), 0) === xpShown && JSON.parse(await xp()).length - JSON.parse(xpBefore).length === 1, [xpBefore, await xp(), xpShown]);
    check('session is cleared and the result sheet opens', (await p.eval(`getSession() === null && !${$('modal-result')}.hidden`)));
    check('sticky bar hidden after saving', !(await vis('finish-bar')));
    check('--sticky-bottom back to 0px', (await p.eval(`getComputedStyle(document.documentElement).getPropertyValue('--sticky-bottom')`)).trim() === '0px');
    await p.eval(`(confirmFinish(), true)`);
    check('a stray confirmFinish() after saving writes nothing', (await hist()) === 1);
    await click('btn-result-close');

    console.log('== Discard in the ⋯ menu, two steps');
    await startSession();
    await markSet();
    const h0 = await hist(), x0 = await xp();
    check('Discard is not visible before the ⋯ menu is opened', !(await vis('btn-reset-session')));
    check('⋯ button is visible and >= 44 px', await p.eval(`(() => { const r = ${$('btn-session-more')}.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })()`));
    await click('btn-session-more');
    check('⋯ opens the menu with Discard workout', (await vis('btn-reset-session')) && (await p.eval(`${$('btn-reset-session')}.textContent`)) === 'Discard workout');
    await esc();
    check('Esc closes the menu', !(await vis('btn-reset-session')));
    await click('btn-session-more');
    await click('btn-reset-session');
    check('step 1: "Discard this workout?" with body text', (await genericOpen()) && (await p.eval(`${$('generic-title')}.textContent`)) === 'Discard this workout?' && (await p.eval(`${$('generic-text')}.textContent`)) === "Sets you marked won't be saved.");
    check('menu closed once step 1 opens', !(await vis('session-menu')));
    await click('btn-generic-cancel');
    check('Cancel at step 1 keeps the session', !(await genericOpen()) && (await p.eval(`!!getSession() && totalSetsDone() === 1`)));
    await click('btn-session-more'); await click('btn-reset-session'); await click('btn-generic-ok');
    check('step 2: "Discard for good", session still there', (await genericOpen()) && (await p.eval(`${$('btn-generic-ok')}.textContent`)) === 'Discard for good' && (await p.eval(`!!getSession()`)));
    check('step 2 button is styled destructive', await p.eval(`${$('btn-generic-ok')}.classList.contains('btn-danger-solid')`));
    await click('btn-generic-cancel');
    check('Cancel at step 2 keeps the session and its marks', !(await genericOpen()) && (await p.eval(`!!getSession() && totalSetsDone() === 1`)));
    await click('btn-session-more'); await click('btn-reset-session'); await click('btn-generic-ok');
    await wait(50); await click('btn-generic-ok');
    check('double tap (2 clicks 50 ms apart) does not discard; step 2 button is aria-disabled', (await genericOpen()) && (await p.eval(`!!getSession() && totalSetsDone() === 1 && ${$('btn-generic-ok')}.getAttribute('aria-disabled') === 'true'`)));
    await wait(500);
    check('after 500 ms the step 2 button is enabled again', await p.eval(`!${$('btn-generic-ok')}.hasAttribute('aria-disabled')`));
    await click('btn-generic-ok');
    await wait(300);
    check('after the second confirm the session is gone', await p.eval(`getSession() === null && totalSetsDone() === 0`));
    check('no history / XP change after discard', (await hist()) === h0 && (await xp()) === x0, { h: await hist(), x: await xp() });
    await p.eval(`(switchTab('pokrok'), switchTab('trening'), true)`);

    console.log('== Other dialogs do not keep the destructive style');
    await p.eval(`(showGeneric('Q', 'OK', null, ''), true)`);
    check('plain showGeneric has no destructive class', !(await p.eval(`${$('btn-generic-ok')}.classList.contains('btn-danger-solid')`)));
    await p.eval(`(closeGeneric(), true)`);

    console.log('== Android Back closes the menu first');
    await startSession(); await markSet();
    await click('btn-session-more');
    const r = await p.eval(`nativeBack()`);
    check('nativeBack closes the ⋯ menu', r === 'closed' && !(await vis('btn-reset-session')), r);
    await click('btn-finish-workout');
    const r2 = await p.eval(`nativeBack()`);
    check('nativeBack closes the Save sheet (Keep training)', r2 === 'closed' && !(await confirmOpen()) && (await p.eval(`!!getSession()`)), r2);

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), renderTrening(), true)`);
      await click('btn-finish-workout');
      const k = await p.eval(`({ title: t('finish.title'), save: t('finish.save'), keep: t('finish.keep'), dt: t('discard.title'), db: t('discard.body'), dc: t('discard.confirm'), df: t('discard.final'), dm: t('discard.menu'), ma: t('session.moreAria'),
        shownTitle: ${$('modal-confirm')}.querySelector('h3').textContent, shownSave: ${$('btn-confirm-ok')}.textContent, shownKeep: ${$('btn-confirm-cancel')}.textContent, menu: ${$('btn-reset-session')}.textContent, dir: document.documentElement.dir })`);
      const vals = [k.title, k.save, k.keep, k.dt, k.db, k.dc, k.df, k.dm, k.ma];
      check(lang + ': all 9 strings translated (no raw keys)', vals.every((v) => v && !/^(finish|discard|session)\./.test(v)), k);
      if (lang !== 'en') check(lang + ': differ from English', vals.filter((v) => v !== 'Save workout?').length === 9 && k.title !== 'Save workout?', k);
      check(lang + ': sheet and menu show the translated text', k.shownTitle === k.title && k.shownSave === k.save && k.shownKeep === k.keep && k.menu === k.dm, k);
      check(lang + ': sheet buttons fit', await p.eval(`(() => { const m = document.querySelector('#modal-confirm .modal'); return m.scrollWidth <= m.clientWidth + 1; })()`));
      if (lang === 'ar') check('ar: right-to-left', k.dir === 'rtl');
      await click('btn-confirm-cancel');
    }
    await p.eval(`(setLang('en'), true)`);

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
