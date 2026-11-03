'use strict';
/* GymQuest — nahraný stav zachová neznáme polia najvyššej úrovne (real headless Chrome).

     [GQ_TEST_PORT=8174] node tests/app/forward-compat.js

   Novšia verzia appky môže pridať pole do uloženého stavu. Načítanie + uloženie v tejto verzii ho
   nesmie zahodiť, história/plány/úspechy zostanú bajt po bajte rovnaké a obsahový hash na
   synchronizáciu sa po ďalšom načítaní nezmení (žiadny falošný „dirty"). */
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8124);
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-forward-compat');
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + JSON.stringify(info) : '')); };

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('fwdcompat-' + Date.now().toString(36), 10096, path.join(WORK, 'profiles'));
  try {
    const p = await b.launch();
    await p.navigate(BASE);
    /* v3 stav s neznámym poľom, históriou a legacy kľúčmi name/legacyGoal */
    await p.eval(`(() => {
      const s = defaultState();
      s.version = 3;
      s.futureField = { a: 1 };
      s.name = 'Stary';
      s.legacyGoal = 4;
      s.history = [{ id: 'w1', week: '2026-W40', date: '2026-09-30', planId: 'push', planName: 'Push', note: 'x', exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, setsDone: 3 }] }];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return true;
    })()`);
    await p.reload();
    await p.eval(`saveState()`);
    const snap = () => p.eval(`(async () => { const o = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { o, future: o.futureField, hist: JSON.stringify(o.history), plans: JSON.stringify(o.plans), ach: JSON.stringify(o.achievements),
               name: o.name, legacyGoal: o.legacyGoal, hasMedia: 'media' in o, hasApply: '_applyId' in o,
               scope: 'futureField' in syncScope(state), scopeName: 'name' in syncScope(state), hash: await syncContentHash(state, {}) }; })()`);
    const a = await snap();
    check('futureField kept', a.future && a.future.a === 1, a.future);
    check('history kept (entry present)', a.hist.indexOf('"w1"') >= 0 && a.hist.indexOf('"note":"x"') >= 0, a.hist);
    check('legacyGoal unchanged (4)', a.legacyGoal === 4, a.legacyGoal);
    check('legacy key name is dropped as before (and not in synced scope)', a.name === undefined && !a.scopeName, [a.name, a.scopeName]);
    check('media / _applyId not invented', !a.hasMedia && !a.hasApply);
    await p.reload();
    const c = await snap();
    check('futureField kept after second load', c.future && c.future.a === 1, c.future);
    check('history byte-identical across loads', a.hist === c.hist);
    check('plans byte-identical across loads', a.plans === c.plans);
    check('achievements byte-identical across loads', a.ach === c.ach);
    check('syncContentHash equal after second load (no false dirty)', a.hash === c.hash, [a.hash, c.hash]);
    check('futureField is part of the synced scope', a.scope === true);
    check('no page errors', p.errors.length === 0, p.errors.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
