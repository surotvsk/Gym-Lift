'use strict';
/* GymQuest — XP sa odteraz DERIVUJE z histórie novými pravidlami pre každý záznam (v101, rozhodnutie vlastníka
   2026-11-04: žiadny bonus ani prepočet, všetci rovnako). Reálny headless Chrome, bez účtov a siete.

     GQ_TEST_PORT=8190 node tests/app/xp-recalc.js

   Kontroluje: v100 históriu (uložené xp 20+2/séria) prepočíta presne podľa nových pravidiel vrátane denného limitu
   a pravidla < 3 série = 0; uložené polia xp sa nemenia (bajt po bajte); žiadny nový kľúč v nastaveniach;
   dve zariadenia = rovnaké súčty; zobrazenia a rebríček používajú odvodenú hodnotu; úroveň = levelForXp(súčet). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-xprecalc');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'profiles'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('xpr-' + Date.now().toString(36), 9896, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const E = (x) => p.eval(x);
  /* Záznam tréningu z v100: `sets` dokončených sérií, uložené xp podľa starého pravidla 20 + 2/séria. */
  let seq = 0;
  const w = (date, sets) => ({ id: 'h' + String(++seq).padStart(5, '0'), date, planId: 'push', planName: 'Push', xp: 20 + 2 * sets, note: '',
    exercises: [{ name: 'Bench', exId: 'bench-press', sets: Math.max(1, sets), reps: 8, weight: 50, setsDone: sets }] });
  const act = (date, minutes, xp) => ({ id: 'a' + (++seq), kind: 'run', date, startedAt: 1, endedAt: 2, activeSeconds: minutes * 60, distanceKm: null, note: '', xp });
  /* Nastaví stav a načíta ho cez loadState (ako štart appky). */
  const load = async (patch) => JSON.parse(await E(`(() => {
    const s = JSON.parse(JSON.stringify(state));
    Object.assign(s, ${J(patch)}); s.version = 3;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    loadState();
    return JSON.stringify({ w: workoutXP(), a: activityXP(), ach: achievementXP(), total: totalXP(), lv: levelInfo(),
      per: state.history.map((h) => historyEntryXp(h)), pera: state.activities.map((x) => activityEntryXp(x)), keys: Object.keys(state.settings).sort() });
  })()`));

  try {
    await p.navigate('http://localhost:' + PORT + '/');
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== Fresh install');
    const fresh = JSON.parse(await E(`(() => { localStorage.clear(); loadState(); return JSON.stringify({ total: totalXP(), lv: levelInfo().level, keys: Object.keys(state.settings).sort() }); })()`));
    check('fresh install: 0 XP, level 0', fresh.total === 0 && fresh.lv === 0, fresh);
    const keys0 = fresh.keys;

    console.log('== v100 history recalculated by the new rules');
    const hist = [
      w('2026-03-01', 2),      // < 3 sérií: 0 (uložené 24)
      w('2026-03-01', 3),      // 36 (nespotrebovalo limit predošlé 0 XP) -> 1. s XP dňa
      w('2026-03-01', 30),     // 78 (strop 24 sérií) -> 2. s XP dňa
      w('2026-03-01', 10),     // 3. s XP v dni -> 0 (uložené 40)
      w('2026-03-02', 12),     // 54
      w('2026-03-02', 12),     // 54
      w('2026-03-02', 12),     // 0 (limit)
      w('2026-03-03', 0),      // 0
    ];
    const stored = J(hist);
    let r = await load({ history: hist, activities: [], achievements: {} });
    check('per-entry XP = [0, 36, 78, 0, 54, 54, 0, 0]', J(r.per) === J([0, 36, 78, 0, 54, 54, 0, 0]), r.per);
    check('workoutXP = 222 (stored sum was ' + hist.reduce((s, h) => s + h.xp, 0) + ')', r.w === 222, r.w);
    const afterHist = await E(`(() => { persistState(); renderAll(); return JSON.stringify(state.history); })()`);
    check('history unchanged byte for byte after load, persist and render (stored xp 24, 26, 80, 40, 44, 44, 44, 20)', afterHist === stored, afterHist.slice(0, 300));
    check('no new settings key (no xpLegacy / xpV2)', J(r.keys.filter((k) => k !== 'startersAdded')) === J(keys0) && !r.keys.includes('xpLegacy') && !r.keys.includes('xpV2'), { keys0, keys: r.keys });

    console.log('== Activities (derived from minutes, daily limit)');
    r = await load({ history: [], activities: [act('2026-03-01', 9, 4), act('2026-03-01', 40, 20), act('2026-03-01', 120, 60), act('2026-03-01', 50, 25), act('2026-03-02', 10, 10)], achievements: {} });
    check('activity XP = [0 (<10 min), 20, 30 (cap), 0 (3rd XP entry of the day), 5]', J(r.pera) === J([0, 20, 30, 0, 5]) && r.a === 55, r.pera);

    console.log('== Total, level, no floor');
    const hist2 = Array.from({ length: 60 }, (_, i) => w('2026-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), 12));   // uložené 44 každý = 2640
    r = await load({ history: hist2, activities: [], achievements: { first: '2026-01-01', ten: '2026-01-10', pr10: '2026-02-01' } });
    const expected = 60 * 54 + r.ach;
    check('total = workout + activity + achievement only (60 x 54 + achievements)', r.total === expected && r.w === 3240, r);
    const lvExp = JSON.parse(await E(`JSON.stringify(levelForXp(${r.total}))`));
    check('level shown == levelForXp(new total) (no floor, no bonus)', r.lv.level === lvExp.level && r.lv.levelXP === lvExp.into && r.lv.total === lvExp.cost && r.lv.xp === r.total, { lv: r.lv, lvExp });
    console.log('  info: old rules total ' + (2640 + 25 + 100 + 300) + ' (level ' + Math.floor((2640 + 425) / 100) + ') -> new total ' + r.total + ' (level ' + r.lv.level + ')');

    console.log('== Two devices produce identical numbers');
    const dev = async (order) => JSON.parse(await E(`(() => {
      const s = JSON.parse(JSON.stringify(state)); ${order}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); loadState();
      return JSON.stringify({ t: totalXP(), per: state.history.map((h) => [h.id, historyEntryXp(h)]) }); })()`));
    const d1 = await dev('');
    const d2 = await dev('xpCacheClear();');
    check('same state on two loads -> identical total and per-entry XP', J(d1) === J(d2) && d1.t === r.total, [d1.t, d2.t]);

    console.log('== Displays and leaderboard use derived values');
    const today = await E(`todayISO()`);
    r = await load({ history: [w(today, 2), w(today, 12), w(today, 5), w(today, 5)], activities: [act(today, 40, 99)], achievements: {} });
    const lp = JSON.parse(await E(`JSON.stringify(leaderboardPayload())`));
    check('leaderboard p_training = derived workout + activity XP (0 + 54 + 40 + 0 + 20 = 114)', lp.p_training === 114, lp);
    check('leaderboard p_week_training = derived XP of this week\'s entries', lp.p_week_training === 114, lp);
    const lvx = JSON.parse(await E(`JSON.stringify({ xp: levelInfo().xp, total: totalXP(), ach: achievementXP() })`));
    check('levelInfo().xp = totalXP() = derived sum (stored xp 99 of the activity is ignored)', lvx.xp === lvx.total && lvx.total === 114 + lvx.ach, lvx);
    check('cache is dropped on persistState: editing sets changes XP', await E(`(() => { const h = state.history[0]; const before = historyEntryXp(h); h.exercises[0].setsDone = 8; persistState(); return before === 0 && historyEntryXp(h) === 46; })()`));

    console.log('== Shared workout cards show the payload XP');
    r = await load({ history: [w(today, 2), w(today, 12)], activities: [], achievements: {} });
    const sh = JSON.parse(await E(`(() => {
      const p0 = shareFromWorkout(state.history[0]), p1 = shareFromWorkout(state.history[1]);
      const old = Object.assign({}, p1, { xp: 44 });   // starší payload s vlastnou hodnotou
      const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
      return JSON.stringify({ x0: p0.xp, x1: p1.xp,
        card1: txt(shareCardHtml(p1, 'post', 1, true)), ty1: txt(tyWorkoutCardHtml({ id: 'p', share: p1, photos: [], urls: {} })),
        cardOld: txt(shareCardHtml(old, 'msg', 1, true)), card0: txt(shareCardHtml(p0, 'post', 1, true)) }); })()`));
    check('shareFromWorkout writes the derived XP (0 for 2 sets, 54 for 12 sets)', sh.x0 === 0 && sh.x1 === 54, sh);
    check('received share card shows "+54 XP"; the 0 XP card shows no chip', /\+54 XP/.test(sh.card1) && !/\+0 XP/.test(sh.card0), sh);
    check('Ty feed workout card shows "+54 XP"', /\+54 XP/.test(sh.ty1), sh.ty1);
    check('an older payload keeps its own xp value (+44 XP)', /\+44 XP/.test(sh.cardOld), sh.cardOld);

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
