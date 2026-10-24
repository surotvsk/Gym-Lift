'use strict';
/* GymQuest — Bento Today screen (v78), in real headless Chrome. No accounts.

     node tests/app/bento-home.js

   Checks: every tile shows the right value from the app's own data (week, streak, level, body weight,
   best lift, food, calendar), and every tile opens the existing feature it stands for (workout, rest
   timer, activity, calendar, progress views, exercises, settings, Community friends / messages / Top 20);
   Start begins the recommended workout and the tile then shows Continue; the excuse tile toggles the
   excused week; the rest tile mirrors the running timer; the messages tile shows the unread badge;
   showing Today never writes to the saved data; all tiles are translated in 6 languages; no errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-bento-home');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('bhome-' + Date.now().toString(36), 9876, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  await p.c.send('Runtime.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const txt = (id) => p.eval(`(document.getElementById(${J(id)}) || {}).textContent || ''`);
  const click = (sel) => p.eval(`(() => { const el = document.querySelector(${J(sel)}); if (!el) return false; el.click(); return true; })()`);
  const home = () => p.eval(`(() => { for (const m of document.querySelectorAll('.modal-backdrop, [id^="modal-"]')) if (!m.hidden && m.id) m.hidden = true; switchTab('dnes'); window.scrollTo(0, 0); return true; })()`);
  try {
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    /* Vzorové dáta + dnešný tréning, váha a jedlo */
    await p.eval(`(() => {
      seedSampleData();
      const plan = getPlan(activePlanIds()[0]);
      state.history.push({ id: 'bh-today', date: todayISO(), planId: plan.id, planName: recordedPlanName(plan), xp: 50,
        exercises: [{ id: 'leg-press', builtin: true, name: 'Leg press', sets: 3, reps: 8, weight: 140, completedSets: 3 }] });
      state.measurements = (state.measurements || []).concat([{ id: 'bh-m', date: todayISO(), weightKg: 80.8, waistCm: null, chestCm: null, armLeftCm: null, armRightCm: null, thighLeftCm: null, thighRightCm: null, hipCm: null }]);
      state.settings.foodLogEnabled = true;
      state.foodLog = state.foodLog || {}; state.foodLog[todayISO()] = [{ id: 'bh-f', name: 'Oats', kcal: 400, protein: 10, carbs: 60, fat: 6, qty: 2.5 }];
      saveState(); renderAll(); switchTab('dnes'); return true; })()`);
    await wait(300);

    console.log('== tiles show the app data');
    const exp = await p.eval(`(() => { const lv = levelInfo(); const pr = personalRecords()[0];
      return { week: sessionsInWeek(currentWeekKey()) + ' / ' + weeklyGoal(), level: 'Level ' + lv.level, xp: lv.xp + ' XP', toNext: (lv.total - lv.levelXP) + ' XP to level ' + (lv.level + 1),
        lift: pr.weight + ' kg', liftName: recordedNameToDisplay(pr.name), month: workoutsInMonth(currentMonthKey()), plan: planNameOf(recommendedPlan()), streak: computeStreak() }; })()`);
    check('week tile = sessions this week / goal', (await txt('week-count')) === exp.week, [await txt('week-count'), exp.week]);
    const dots = await p.eval(`(() => { const d = [...document.querySelectorAll('#bt-week-dots i')]; const idx = (new Date().getDay() + 6) % 7; return { n: d.length, todayDone: d[idx].className === 'd', outlined: d.filter((i) => i.classList.contains('n')).length, idx }; })()`);
    check('week tile has 7 day squares; today is filled after today\'s workout (as in the reference: filled = trained, outline = today without one)', dots.n === 7 && dots.todayDone && dots.outlined === 0, dots);
    check('streak tile shows weeks', (await txt('bt-streak-v')) === exp.streak + (exp.streak === 1 ? ' week' : ' weeks'), await txt('bt-streak-v'));
    check('level tile: level, total XP and XP to the next level', (await txt('bt-level-l')) === exp.level && (await txt('bt-level-v')) === exp.xp && (await txt('bt-level-line')) === exp.toNext,
      [await txt('bt-level-l'), await txt('bt-level-v'), await txt('bt-level-line'), exp]);
    check('body tile shows the latest weight', (await txt('bt-body-v')) === '80.8 kg', await txt('bt-body-v'));
    check('best lift tile shows the top record', (await txt('bt-lift-v')) === exp.lift && (await txt('bt-lift-line')) === exp.liftName, [await txt('bt-lift-v'), await txt('bt-lift-line'), exp]);
    check('food tile shows today\'s kcal', (await txt('bt-food-v')) === '1000 kcal', await txt('bt-food-v'));
    check('next-up tile names the recommended plan with exercise and set counts', (await txt('bt-next-name')) === exp.plan && /\d+ exercises · \d+ sets/.test(await txt('dnes-next-plan')), [await txt('bt-next-name'), await txt('dnes-next-plan')]);
    check('next-up tile shows an exercise photo', await p.eval(`(() => { const i = document.getElementById('bt-next-img'); return !i.hidden && /^media\\//.test(i.getAttribute('src') || ''); })()`));
    check('greeting is shown', (await txt('bh-hello')).startsWith('Hi'));
    check('header as in the reference: short date with the week, greeting; Settings is a tile (and on You)', /· week \d+$/.test(await txt('today-date')) && await p.eval(`!!document.getElementById('bt-settings').offsetParent`), await txt('today-date'));

    console.log('== showing Today never writes data');
    const before = await p.eval(`localStorage.getItem(STORAGE_KEY)`);
    await p.eval(`(renderAll(), setLang('fr'), setLang('en'), switchTab('dnes'), true)`);
    check('saved data is byte-identical after rendering Today', (await p.eval(`localStorage.getItem(STORAGE_KEY)`)) === before);

    console.log('== every tile opens its feature');
    const nav = [
      ['#bt-week', `activeTab === 'kalendar' && document.querySelector('.tab-bar .tab.active').dataset.tab === 'dnes'`, 'week → Calendar page (Today stays selected in the menu)'],
      ['#bt-streak', `activeTab === 'pokrok' && pokrokView === 'motivation'`, 'streak → Achievements'],
      ['#bt-level', `activeTab === 'pokrok' && pokrokView === 'motivation'`, 'level → Achievements'],
      ['#bt-body', `activeTab === 'pokrok' && pokrokView === 'body'`, 'body → Body'],
      ['#bt-lift', `activeTab === 'pokrok' && pokrokView === 'progress' && !!document.querySelector('#records-list .record-row')`, 'best lift → Records'],
      ['#bt-food', `activeTab === 'pokrok' && pokrokView === 'food'`, 'food → Food'],
      ['#bt-photos', `activeTab === 'pokrok' && pokrokView === 'photos'`, 'photos → Photos'],
      ['#bt-rest', `!document.getElementById('modal-rest').hidden && !!document.querySelector('#modal-rest #timer-presets')`, 'rest → Rest timer sheet'],
      ['#bt-settings', `!document.getElementById('modal-settings').hidden`, 'settings → Settings'],
      ['#bt-friends', `activeTab === 'komunita'`, 'friends → Community (Messages)'],
      ['#btn-choose-mode', `!document.getElementById('modal-mode').hidden`, 'activity → activity choice'],
      ['#btn-choose-manual', `!document.getElementById('modal-activity').hidden && document.getElementById('modal-mode').hidden`, 'activity choice → log a past activity'],
    ];
    for (const [sel, cond, name] of nav) {
      await home(); await wait(60);
      if (sel === '#btn-choose-manual') { await click('#btn-choose-mode'); await wait(100); }
      await click(sel); await wait(150);
      check(name, await p.eval(`!!(${cond})`), await p.eval(`({ tab: activeTab, view: pokrokView })`));
    }
    await home();
    check('train-together tile stays hidden without Community', await p.eval(`document.getElementById('bt-train').hidden`));

    console.log('== Start, Continue, excuse');
    await click('#btn-start-workout'); await wait(200);
    check('Start begins the recommended workout on the Workout tab', await p.eval(`activeTab === 'trening' && !!getSession() && getSession().planId === selectedPlan`));
    await home(); await wait(100);
    check('next-up tile shows In progress and Continue', (await txt('bt-next-label')).startsWith('In progress') && (await txt('bt-start-text')) === 'Continue' && /^0 \/ \d+ sets$/.test(await txt('dnes-next-plan')), [await txt('bt-next-label'), await txt('bt-start-text')]);
    await click('#btn-start-workout'); await wait(150);
    check('Continue goes back to the same workout', await p.eval(`activeTab === 'trening' && !!getSession()`));
    await p.eval(`(clearSession(), saveState(), switchTab('dnes'), true)`);
    check('after the workout ends the tile says Start again', (await txt('bt-start-text')) === 'Start');
    const wk = await p.eval(`currentWeekKey()`);
    await click('#btn-excuse'); await wait(100);
    check('excuse tile excuses this week', await p.eval(`state.excusedWeeks.includes(${J(wk)})`) && (await txt('bt-excuse-l')).startsWith('Excused') && (await txt('bt-excuse-line')) === 'Tap to undo' && await p.eval(`document.getElementById('btn-excuse').getAttribute('aria-pressed') === 'true'`));
    await click('#btn-excuse'); await wait(100);
    check('tapping again undoes it', !(await p.eval(`state.excusedWeeks.includes(${J(wk)})`)) && (await txt('bt-excuse-l')) === 'Busy week?' && (await txt('bt-excuse-line')) === 'Excuse it, keep the streak');

    console.log('== rest timer and messages badge');
    await p.eval(`(startTimer(90), switchTab('dnes'), true)`); await wait(1200);
    const rest = await txt('bt-rest-line');
    check('rest tile shows the running timer', /^0[01]:\d\d$/.test(rest) && await p.eval(`document.getElementById('bt-rest').classList.contains('bt-running')`), rest);
    await p.eval(`(stopTimer(), true)`);
    check('rest tile goes back to Rest when stopped', (await txt('bt-rest-line')) === 'Rest' && !(await p.eval(`document.getElementById('bt-rest').classList.contains('bt-running')`)));
    await p.eval(`(communityBadges = { chats: 3, requests: 1 }, communityShowBadges(), true)`);
    check('friends tile shows unread messages and requests', await p.eval(`!document.getElementById('bt-chats-badge').hidden && document.getElementById('bt-chats-badge').textContent === '4'`));
    await p.eval(`(communityBadges = { chats: 0, requests: 0 }, communityShowBadges(), true)`);
    check('badge hides at zero', await p.eval(`document.getElementById('bt-chats-badge').hidden`));

    console.log('== translations');
    const langs = {};
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('dnes'), true)`); await wait(60);
      langs[lang] = await p.eval(`[...document.querySelectorAll('#bento-grid .bt-l, #bento-grid .bt-line, #bento-grid .bt-v, #bt-start-text, #bh-hello')].filter((e) => e.offsetParent).map((e) => e.textContent.trim())`);
    }
    const missing = Object.entries(langs).flatMap(([l, a]) => a.filter((s) => !s || /^bento\.|^dnes\./.test(s)).map((s) => l + ':' + s));
    check('every visible tile text is filled in all 6 languages (no raw keys)', missing.length === 0, missing.slice(0, 5));
    check('tile texts differ from English in every other language', ['sk', 'es', 'pt-BR', 'fr', 'ar'].every((l) => langs[l].join('|') !== langs.en.join('|')));
    await p.eval(`(setLang('en'), true)`);

    check('no console errors', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    fail++; console.log('  FAIL crashed: ' + (e && e.stack || e));
  } finally {
    console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
    b.killHard(true); await server.close();
    process.exit(fail ? 1 : 0);
  }
})();
