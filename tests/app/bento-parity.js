'use strict';
/* GymQuest — feature parity of the Bento redesign, in real headless Chrome. No accounts.

     node tests/app/bento-parity.js

   1. Every element id of the previous release's index.html still exists (no control was removed).
   2. Every feature entry point is reachable in the new layout: on its screen it is shown, at least
      24 × 24 px, keyboard-focusable, and after scrolling it is really on top (not covered by the
      floating menu, the rest-timer pill or another tile) — in light and dark mode, on a phone
      (320 and 390 px), a tablet (820 px) and a desktop (1280 px).
   3. Tapping a representative control on every screen still runs its feature (the screen or dialog
      it belongs to opens). Feature behaviour itself is covered by the other suites. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-bento-parity');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 900) : '')); }
}

/* Vstupy do funkcií: [funkcia, ako sa k nej dostať (JS v stránke), selektor ovládača] */
const SESSION = `(switchTab('trening'), ensureSession(getPlan(selectedPlan)), saveState(), renderTrening())`;
const ENTRY = [
  ['Today: start / continue workout', `switchTab('dnes')`, '#btn-start-workout'],
  ['Today: week → calendar', `switchTab('dnes')`, '#bt-week'],
  ['Today: streak', `switchTab('dnes')`, '#bt-streak'],
  ['Today: excuse week', `switchTab('dnes')`, '#btn-excuse'],
  ['Today: level', `switchTab('dnes')`, '#bt-level'],
  ['Today: body', `switchTab('dnes')`, '#bt-body'],
  ['Today: best lift', `switchTab('dnes')`, '#bt-lift'],
  ['Today: food', `switchTab('dnes')`, '#bt-food'],
  ['Today: rest timer', `switchTab('dnes')`, '#bt-rest'],
  ['Today: activity', `switchTab('dnes')`, '#btn-choose-mode'],
  ['Today: friends / messages', `switchTab('dnes')`, '#bt-friends'],
  ['Today: photos', `switchTab('dnes')`, '#bt-photos'],
  ['Today: settings tile', `switchTab('dnes')`, '#bt-settings'],
  ['Activity sheet: log a past activity', `(switchTab('dnes'), document.getElementById('btn-choose-mode').click())`, '#btn-choose-manual'],
  ['Workout: plan tile', `switchTab('trening')`, '.plan-chips .chip'],
  ['Workout: start the selected plan', `switchTab('trening')`, '#tr-start'],
  ['Workout: edit plan', `switchTab('trening')`, '#btn-plan-rename'],
  ['Workout: manage plans', `switchTab('trening')`, '#btn-manage-plans'],
  ['Workout: new plan', `switchTab('trening')`, '#btn-add-plan'],
  ['Workout: exercise library', `switchTab('trening')`, '#btn-exercise-library'],
  ['Workout: Full Body builder', `switchTab('trening')`, '#btn-fullbody-tile'],
  ['Session: switch plan', SESSION, '#tr-sess-plan'],
  ['Session: rest timer sheet', SESSION, '#btn-open-rest'],
  ['Session: discard / reset', SESSION, '#btn-reset-session'],
  ['Session: mark a set done', SESSION, '#exercise-list .set-btn'],
  ['Session: per-set reps', SESSION, '#exercise-list .set-reps'],
  ['Session: per-set weight', SESSION, '#exercise-list .set-weight'],
  ['Session: failure mark', SESSION, '#exercise-list .set-fail'],
  ['Session: add drop set', SESSION, '#exercise-list .btn-add-drop'],
  ['Session: replace exercise', SESSION, '#exercise-list .exercise-swap'],
  ['Session: exercise details', SESSION, '#exercise-list .exercise-info'],
  ['Session: finish workout', `(${SESSION.slice(1, -1)}, document.querySelector('#exercise-list .set-btn').click())`, '#btn-finish-workout'],
  ['Rest sheet: preset', `openRestSheet()`, '#timer-presets .timer-chip:not(.timer-chip-custom)'],
  ['Rest sheet: custom time', `openRestSheet()`, '#btn-custom-timer'],
  ['Rest sheet: manage timers', `openRestSheet()`, '#btn-manage-presets'],
  ['Rest pill: stop', `(switchTab('dnes'), startTimer(90))`, '#timer-stop'],
  ['Stats: week tile', `switchTab('pokrok')`, '#stats-grid [data-go="history"]'],
  ['Stats: records', `switchTab('pokrok')`, '#stats-grid [data-go="records"]'],
  ['Stats: achievements', `switchTab('pokrok')`, '#stats-grid [data-go="motivation"]'],
  ['Stats: calendar', `switchTab('pokrok')`, '#stats-grid [data-go="calendar"]'],
  ['Stats: body', `switchTab('pokrok')`, '#stats-grid [data-go="body"]'],
  ['Stats: photos', `switchTab('pokrok')`, '#stats-grid [data-go="photos"]'],
  ['Stats: food', `switchTab('pokrok')`, '#stats-grid [data-go="food"]'],
  ['Stats: a recent workout', `switchTab('pokrok')`, '#stats-grid [data-day]'],
  ['History: edit a past workout', `(switchTab('pokrok'), setPokrokView('progress'))`, '#history-list [data-action="edit"]'],
  ['History: back', `(switchTab('pokrok'), setPokrokView('progress'))`, '#back-progress'],
  ['Body: add measurement', `(switchTab('pokrok'), setPokrokView('body'))`, '#btn-add-measure'],
  ['Body: units', `(switchTab('pokrok'), setPokrokView('body'))`, '#body-units .unit-chip'],
  ['Body: energy estimate', `(switchTab('pokrok'), setPokrokView('body'))`, '#btn-calorie-enable'],
  ['Food: turn on', `(switchTab('pokrok'), setPokrokView('food'))`, '#btn-food-enable'],
  ['Photos: add photos', `(switchTab('pokrok'), setPokrokView('photos'))`, '#btn-photos-add-empty'],
  ['Calendar: previous month', `openCalendarPage()`, '#btn-cal-prev'],
  ['Calendar: next month', `openCalendarPage()`, '#btn-cal-next'],
  ['Calendar: today', `openCalendarPage()`, '#btn-cal-today'],
  ['Calendar: open a day', `openCalendarPage()`, '#calendar-grid .cal-cell.cal-today'],
  ['Calendar: back', `openCalendarPage()`, '#back-calendar'],
  ['Community: open', `switchTab('komunita')`, '#community-body button'],
  ['Community: search', `switchTab('komunita')`, '#btn-csearch'],
  ['You: Community profile', `switchTab('ty')`, '#ty-profile'],
  ['You: goal', `switchTab('ty')`, '#ty-goal'],
  ['You: settings', `switchTab('ty')`, '#ty-settings'],
  ['Menu: Today', `switchTab('trening')`, '.tab-bar .tab[data-tab="dnes"]'],
  ['Menu: Workout', `switchTab('dnes')`, '.tab-bar .tab[data-tab="trening"]'],
  ['Menu: Stats', `switchTab('dnes')`, '.tab-bar .tab[data-tab="pokrok"]'],
  ['Menu: Community', `switchTab('dnes')`, '.tab-bar .tab[data-tab="komunita"]'],
  ['Menu: You', `switchTab('dnes')`, '.tab-bar .tab[data-tab="ty"]'],
];
const SETTINGS = ['#btn-change-lang', '#theme-chips [data-theme-choice="light"]', '#theme-chips [data-theme-choice="dark"]', '#theme-chips [data-theme-choice="auto"]',
  '#btn-design-previews', '#btn-community-settings', '#settings-goal-chips .goal-chip', '#btn-rest-sound', '#btn-test-sound', '#btn-backup-now',
  '#btn-export', '#btn-import', '#btn-load-demo', '#btn-reset-data', '#btn-check-update', '#btn-settings-close', '#btn-settings-save'];

const REACH_JS = (sel) => `(() => {
  const el = document.querySelector(${J(sel)});
  if (!el) return { ok: false, why: 'missing' };
  const cs = getComputedStyle(el);
  if (el.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden') return { ok: false, why: 'hidden' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width < 24 || r.height < 24) return { ok: false, why: 'small ' + Math.round(r.width) + 'x' + Math.round(r.height) };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok: false, why: 'off-screen' };
  const hit = document.elementFromPoint(x, y);
  const top = !!hit && (hit === el || el.contains(hit));
  /* Výnimky, ktoré sú zámerným správaním (rovnako ako v predošlej verzii):
     úroveň v hlavičke je iba zobrazenie; v skupine prepínačov (role=radio) je cez Tab dostupný vybraný
     prepínač a ostatné šípkami; "Otestovať zvuk" je vypnuté, kým nie je zapnutý zvuk po pauze. */
  const displayOnly = el.id === 'header-level';
  const radioGroup = el.getAttribute('role') === 'radio' && !!el.parentElement.querySelector('[role="radio"][tabindex="0"]');
  const disabledByDesign = el.id === 'btn-test-sound' && el.disabled;
  const focusable = displayOnly || radioGroup || disabledByDesign || (!el.disabled && el.tabIndex >= 0);
  return { ok: top && focusable, why: top ? (focusable ? '' : 'not focusable') : 'covered by ' + (hit ? (hit.id || hit.className || hit.tagName) : 'nothing') };
})()`;

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  console.log('== every control of the previous release still exists');
  const oldHtml = execSync('git show ' + (process.env.GQ_OLD_REF || 'HEAD') + ':index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  const newHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const ids = (s) => new Set([...s.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const oldIds = ids(oldHtml), newIds = ids(newHtml);
  const missing = [...oldIds].filter((x) => !newIds.has(x));
  check('all ' + oldIds.size + ' element ids of the previous release are present (' + newIds.size + ' now)', missing.length === 0, missing);

  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('bpar-' + Date.now().toString(36), 9877, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); seedSampleData(); renderAll(); return true; })()`);
    const reset = `(() => { for (const m of document.querySelectorAll('.modal-backdrop')) m.hidden = true; if (typeof stopTimer === 'function') stopTimer(); pokrokView = 'stats'; trainShowPlans = false;
      if (getSession()) { clearSession(); saveState(); } if (editingPlan !== null) { closeEditor(); } document.getElementById('modal-library').hidden = true; renderAll(); return true; })()`;
    for (const [w, mobile] of [[320, true], [390, true], [820, true], [1280, false]]) {
      for (const mode of ['light', 'dark']) {
        await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: w > 900 ? 900 : 760, deviceScaleFactor: 1, mobile });
        await p.eval(`(localStorage.setItem('gymquest_theme', ${J(mode)}), applyTheme(), true)`);
        console.log('== entry points reachable: ' + w + ' px, ' + mode);
        const bad = [];
        for (const [name, go, sel] of ENTRY) {
          await p.eval(reset);
          await p.eval(`(${go}, window.scrollTo(0, 0), true)`); await wait(60);
          const r = await p.eval(REACH_JS(sel));
          if (!r.ok) bad.push(name + ' (' + sel + '): ' + r.why);
        }
        await p.eval(reset);
        await p.eval(`(openSettings(), true)`); await wait(80);
        for (const sel of SETTINGS) {
          const r = await p.eval(REACH_JS(sel));
          if (!r.ok) bad.push('Settings ' + sel + ': ' + r.why);
        }
        check(w + ' px ' + mode + ': all ' + (ENTRY.length + SETTINGS.length) + ' entry points shown, ≥ 24 px, focusable and not covered', bad.length === 0, bad);
      }
    }
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

    console.log('== tapping a control runs its feature');
    const acts = [
      ['Today Start → Workout tab with an active workout', `switchTab('dnes')`, '#btn-start-workout', `activeTab === 'trening' && !!getSession() && !document.getElementById('tr-session').hidden && document.getElementById('tr-pick').hidden`],
      ['plan tile selects the plan', `switchTab('trening')`, '.plan-chips .chip-wrap:nth-child(2) .chip', `selectedPlan === activePlanIds()[1] && document.getElementById('plan-title').textContent === planDisplayName(getPlan(activePlanIds()[1]))`],
      ['selected-plan Start begins that plan', `switchTab('trening')`, '#tr-start', `!!getSession() && getSession().planId === selectedPlan`],
      ['exercise library opens', `switchTab('trening')`, '#btn-exercise-library', `!document.getElementById('modal-library').hidden`],
      ['Full Body builder opens', `switchTab('trening')`, '#btn-fullbody-tile', `!document.getElementById('modal-fullbody').hidden`],
      ['edit plan opens the editor sheet', `switchTab('trening')`, '#btn-plan-rename', `editingPlan === selectedPlan && !document.getElementById('edit-panel').hidden && getComputedStyle(document.getElementById('edit-panel')).position === 'fixed'`],
      ['set square marks the set (and starts the workout)', `switchTab('trening')`, '#exercise-list .set-btn', `totalSetsDone() === 1 && !!getSession()`],
      ['plan name in the workout tile shows the plans to switch', SESSION, '#tr-sess-plan', `!document.getElementById('tr-pick').hidden`],
      ['rest pill opens the rest timer sheet', SESSION, '#btn-open-rest', `!document.getElementById('modal-rest').hidden`],
      ['rest preset starts the timer pill', `openRestSheet()`, '#timer-presets .timer-chip:not(.timer-chip-custom)', `!document.getElementById('timer-bar').hidden && !!timerInterval`],
      ['Stats records tile opens records', `switchTab('pokrok')`, '#stats-grid [data-go="records"]', `pokrokView === 'progress' && !document.getElementById('subview-progress').hidden`],
      ['Stats achievements tile', `switchTab('pokrok')`, '#stats-grid [data-go="motivation"]', `pokrokView === 'motivation'`],
      ['Stats calendar tile opens the calendar page', `switchTab('pokrok')`, '#stats-grid [data-go="calendar"]', `activeTab === 'kalendar'`],
      ['Stats recent workout opens its day', `switchTab('pokrok')`, '#stats-grid [data-day]', `!document.getElementById('modal-day').hidden`],
      ['history edit opens', `(switchTab('pokrok'), setPokrokView('progress'))`, '#history-list [data-action="edit"]', `!document.getElementById('modal-history-edit').hidden`],
      ['history back returns to the Stats tiles', `(switchTab('pokrok'), setPokrokView('progress'))`, '#back-progress', `pokrokView === 'stats' && !document.getElementById('stats-grid').hidden`],
      ['add measurement opens', `(switchTab('pokrok'), setPokrokView('body'))`, '#btn-add-measure', `!document.getElementById('modal-measure').hidden`],
      ['calendar day opens', `openCalendarPage()`, '#calendar-grid .cal-cell.cal-today', `!document.getElementById('modal-day').hidden`],
      ['calendar back returns to the tab it came from', `(switchTab('pokrok'), openCalendarPage())`, '#back-calendar', `activeTab === 'pokrok'`],
      ['You settings tile opens settings', `switchTab('ty')`, '#ty-settings', `!document.getElementById('modal-settings').hidden`],
      ['You goal tile opens settings at the goal', `switchTab('ty')`, '#ty-goal', `!document.getElementById('modal-settings').hidden`],
      ['You profile tile opens Community', `switchTab('ty')`, '#ty-profile', `activeTab === 'komunita'`],
      ['menu You selects only the You tab', `switchTab('dnes')`, '.tab-bar .tab[data-tab="ty"]', `activeTab === 'ty' && document.querySelectorAll('.tab-bar .tab.active').length === 1 && document.querySelector('.tab-bar .tab.active').dataset.tab === 'ty'`],
      ['menu Today selects only Today', `switchTab('ty')`, '.tab-bar .tab[data-tab="dnes"]', `document.querySelectorAll('.tab-bar .tab.active').length === 1 && document.querySelector('.tab-bar .tab.active').dataset.tab === 'dnes'`],
      ['language picker opens from settings', `openSettings()`, '#btn-change-lang', `!document.getElementById('modal-lang').hidden`],
      ['dark mode from settings', `openSettings()`, '#theme-chips [data-theme-choice="dark"]', `document.documentElement.dataset.theme === 'dark' && localStorage.getItem('gymquest_theme') === 'dark'`],
      ['system mode from settings', `openSettings()`, '#theme-chips [data-theme-choice="auto"]', `localStorage.getItem('gymquest_theme') === null`],
    ];
    for (const [name, go, sel, cond] of acts) {
      await p.eval(reset);
      await p.eval(`(${go}, true)`); await wait(80);
      await p.eval(`(() => { const el = document.querySelector(${J(sel)}); el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`); await wait(200);
      check(name, await p.eval(`!!(${cond})`));
    }

    console.log('== keyboard');
    await p.eval(reset);
    await p.eval(`(openSettings(), document.querySelector('#theme-chips [aria-checked="true"]').focus(), true)`);
    const before = await p.eval(`themePref()`);
    await p.c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await p.c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await wait(100);
    check('theme choice works with the arrow keys and focus follows', (await p.eval(`themePref()`)) !== before && await p.eval(`document.activeElement.getAttribute('aria-checked') === 'true'`));
    const outline = await p.eval(`(() => { const el = document.querySelector('#btn-settings-close'); el.focus(); const cs = getComputedStyle(el); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; })()`);
    check('keyboard focus is visible (≥ 2 px outline)', outline);
    await p.eval(`(setThemePref('auto'), true)`);
    await p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const motion = await p.eval(`(() => { const m = document.querySelector('#modal-settings .modal'); return parseFloat(getComputedStyle(m).animationDuration) < 0.01; })()`);
    check('prefers-reduced-motion turns the sheet animation off', motion);
    check('no page errors', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
