'use strict';
/* GymQuest — pravidlo pracovnej váhy na ďalší tréning (v100, spec §3.4).
   Časť 1 (Node): nextWorkingWeight() sa vytiahne zo script.js a beží izolovane.
   Časť 2 (headless Chrome): completedMainSets() zo session — drop série vynechané, zlyhanie zahrnuté,
   výnimky váhy, jednostranný cvik so stranami.

     GQ_TEST_PORT=8190 node tests/app/working-weight.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-workingweight');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  console.log('== nextWorkingWeight (pure)');
  const src = fs.readFileSync(path.join(REPO, 'script.js'), 'utf8');
  const m = src.match(/function nextWorkingWeight[\s\S]*?\n}\n/);
  check('script.js defines nextWorkingWeight', !!m);
  const nww = m ? vm.runInNewContext('(' + m[0].replace(/^function nextWorkingWeight/, 'function') + ')', { Math, Number, Array }) : () => 'missing';
  const S = (...w) => w.map((x) => ({ weight: x }));
  const eq = (name, got, want) => check(name, got === want, { got, want });
  eq('40/45/45 -> 45', nww(S(40, 45, 45)), 45);
  eq('60/60/50 -> 60', nww(S(60, 60, 50)), 60);
  eq('60/60/80 -> 60', nww(S(60, 60, 80)), 60);
  eq('50/55/60 -> 60', nww(S(50, 55, 60)), 60);
  eq('60 (drop 40 excluded upstream) -> 60', nww(S(60)), 60);
  eq('none -> null', nww([]), null);
  eq('assisted 30/25/25 -> 25', nww(S(30, 25, 25), { assisted: true }), 25);
  eq('assisted 30/20 -> 20', nww(S(30, 20), { assisted: true }), 20);
  eq('unilateral L 20/20, R 22/22 -> 22', nww([{ weight: 20, side: 'left' }, { weight: 22, side: 'right' }, { weight: 20, side: 'left' }, { weight: 22, side: 'right' }]), 22);
  eq('only left done 20/20 -> 20', nww([{ weight: 20, side: 'left' }, { weight: 20, side: 'left' }]), 20);
  eq('bodyweight 0/0/0 -> 0', nww(S(0, 0, 0)), 0);
  eq('decimals 62.5/62.5/60 -> 62.5', nww(S(62.5, 62.5, 60)), 62.5);
  eq('float epsilon 0.1+0.2 vs 0.3 counts as equal', nww(S(0.1 + 0.2, 0.3, 0.2)), 0.30000000000000004);
  eq('unilateral assisted: lower assistance side', nww([{ weight: 30, side: 'left' }, { weight: 20, side: 'right' }], { assisted: true }), 20);
  eq('unilateral asymmetric last-set: L 20/25, R 22 -> 25', nww([{ weight: 20, side: 'left' }, { weight: 25, side: 'left' }, { weight: 22, side: 'right' }]), 25);

  console.log('== completedMainSets (browser)');
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('ww-' + Date.now().toString(36), 9891, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    const r = await p.eval(`(() => {
      state.plans['wtest'] = { id: 'wtest', builtin: false, customName: 'WW test', location: null,
        exercises: [{ id: 'cx-w1', name: 'Bench w', sets: 3, reps: 8, weight: 60 },
          { id: 'cx-w2', name: 'Curl w', sets: 2, reps: 10, weight: 20, unilateral: true }] };
      if (!state.planOrder.includes('wtest')) state.planOrder.push('wtest');
      selectedPlan = 'wtest'; const sess = ensureSession();
      const [a, c] = state.plans['wtest'].exercises;
      setSetWeight(a, 2, 80);                       // séria 3 = 80 kg
      toggleSetMark('done', a, 0, true); toggleSetMark('done', a, 2, true); toggleSetMark('failure', a, 2, true);
      addDrop(a); sess.drops[exerciseSessionKey(a)] = [{ w: 40, r: 5, done: true }];
      setSetWeight(c, 0, 22, 'right');
      toggleSetMark('done', c, 0, true, 'left'); toggleSetMark('done', c, 0, true, 'right');
      return { a: completedMainSets(a, getSession()), c: completedMainSets(c, getSession()),
        none: completedMainSets({ id: 'cx-zz', name: 'x', sets: 2, reps: 5, weight: 10 }, getSession()), nosess: completedMainSets(a, null) };
    })()`);
    check('bench: sets 1 and 3 only (undone skipped, drop excluded, failure included, override 80)', J(r.a) === J([{ weight: 60 }, { weight: 80 }]), r.a);
    check('unilateral: left 20, right 22 with sides', J(r.c) === J([{ weight: 20, side: 'left' }, { weight: 22, side: 'right' }]), r.c);
    check('untouched exercise -> []', J(r.none) === '[]', r.none);
    check('no session -> []', J(r.nosess) === '[]', r.nosess);
    check('end to end: bench -> 80? last set (60,80 distinct) -> 80', await p.eval(`nextWorkingWeight(completedMainSets(state.plans['wtest'].exercises[0], getSession()))`) === 80);
    check('no exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
