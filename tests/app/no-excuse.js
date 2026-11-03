'use strict';
/* GymQuest — week excuses removed (owner decision D8, 2026-10-30), in real headless Chrome. No accounts.

     node tests/app/no-excuse.js

   Checks: Today has no excuse tile, no excuse dialog and no data-go="excuse" entry; weeks excused earlier
   (state.excusedWeeks) still keep the streak and the Streak tile shows it; nothing writes to excusedWeeks;
   no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-no-excuse');
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
  const b = new Browser('noexc-' + Date.now().toString(36), 9877, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  await p.c.send('Runtime.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const SEL = `#btn-excuse, [data-go="excuse"], #modal-excuse:not([hidden])`;
  try {
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('dnes'); return true; })()`);
    await wait(200);
    check('fresh app: no excuse tile, dialog or entry point on Today', await p.eval(`document.querySelectorAll(${J(SEL)}).length === 0`));
    check('the excuse elements are gone from the page entirely', await p.eval(`!document.getElementById('btn-excuse') && !document.getElementById('modal-excuse') && !document.getElementById('excuse-note')`));

    /* týždne: cur-1, cur-3, cur-4 splnené (cieľ 1), cur-2 ospravedlnený, prebiehajúci týždeň prázdny */
    await p.eval(`(() => {
      const wk = [currentWeekKey()]; for (let i = 0; i < 5; i++) wk.push(prevWeekKey(wk[i]));
      const plan = getPlan(activePlanIds()[0]);
      state.history = [1, 3, 4].map((i) => ({ id: 'ne-' + i, date: localDateKey(addDays(new Date(), -7 * i)), planId: plan.id, planName: recordedPlanName(plan), xp: 10, exercises: [] }));
      state.settings.weeklyGoal = 1; state.goalHistory = {}; state.legacyGoal = 1;
      state.excusedWeeks = [wk[2]];
      saveState(); renderAll(); switchTab('dnes'); return true; })()`);
    await wait(200);
    check('earlier excused week still keeps the streak (3 weeks)', await p.eval(`computeStreak() === 3`), await p.eval(`computeStreak()`));
    check('the Streak tile shows it', (await p.eval(`document.getElementById('bt-streak-v').textContent`)).trim().startsWith('3'), await p.eval(`document.getElementById('bt-streak-v').textContent`));
    await p.eval(`(state.excusedWeeks = [], saveState(), renderAll(), true)`);
    check('without the excused week the streak is broken (proves it is the excuse that counts)', await p.eval(`computeStreak() === 1`));
    await p.eval(`(state.excusedWeeks = [prevWeekKey(prevWeekKey(currentWeekKey()))], saveState(), renderAll(), true)`);
    check('still no excuse entry point with an excused week in the data', await p.eval(`document.querySelectorAll(${J(SEL)}).length === 0`));
    check('no code path writes excusedWeeks any more', await p.eval(`typeof setWeekExcused === 'undefined' && typeof openExcuseSheet === 'undefined'`));
    check('no console errors', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    fail++; console.log('  FAIL crashed: ' + (e && e.stack || e));
  } finally {
    console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
    b.killHard(true); await server.close();
    process.exit(fail ? 1 : 0);
  }
})();
