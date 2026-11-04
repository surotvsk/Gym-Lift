'use strict';
/* GymQuest — úroveň a XP v UI podľa novej krivky + jednorazová poznámka o prepočte (v101). Headless Chrome, bez účtov.

     GQ_TEST_PORT=8190 node tests/app/xp-level-ui.js

   Kontroluje: dlaždica Dnes (číslo úrovne, XP, "N XP do ďalšej", šírka pásu = into / cost) podľa nezávislého
   vzorca 10L²+70L pre známu históriu; Motivácia a Ty; poznámka `xp.recalculated` sa ukáže len pri histórii spred verzie,
   raz na zariadení (localStorage, mimo stavu), čerstvý používateľ ju nevidí nikdy; tlačidlo >= 44 px; 6 jazykov;
   hláška o novej úrovni po Dokončiť sa objaví presne vtedy, keď tréning prekročí hranicu novej krivky. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-xplevelui');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
/* Nezávislý vzorec (nie z appky): celkové XP na úroveň L = 10L²+70L, cena L -> L+1 = 80+20L. */
const cum = (L) => 10 * L * L + 70 * L;
function expectLevel(xp) { let L = 0; while (cum(L + 1) <= xp) L++; return { level: L, into: xp - cum(L), cost: 80 + 20 * L }; }

(async () => {
  fs.mkdirSync(path.join(WORK, 'profiles'), { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('xlu-' + Date.now().toString(36), 9897, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const E = (x) => p.eval(x);
  const txt = (id) => E(`(document.getElementById(${J(id)}) || {}).textContent || ''`);
  const shot = async (name) => { if (!SHOTS) return; const s = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.data, 'base64')); };
  const wk = (i, sets) => ({ id: 'h' + String(i).padStart(5, '0'), date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), planId: 'push', planName: 'Push', xp: 0, note: '',
    exercises: [{ name: 'Bench', exId: 'bench-press', sets: sets, reps: 8, weight: 50, setsDone: sets }] });
  /* Nastaví stav (história spred verzie) a prekreslí. */
  const load = (hist) => E(`(() => { const s = JSON.parse(JSON.stringify(state)); s.history = ${J(hist)}; s.activities = []; s.achievements = {}; s.demo = false; s.version = 3;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); loadState(); renderAll(); switchTab('dnes'); return true; })()`);

  try {
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
    await p.navigate('http://localhost:' + PORT + '/');
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== Čerstvý používateľ: poznámka nikdy');
    await E(`(() => { localStorage.removeItem('gymquest_xp_note'); state.history = []; state.activities = []; state.demo = false; renderAll(); return true; })()`);
    check('fresh user: note hidden', await E(`document.getElementById('xp-note').hidden`));
    check('fresh user: flag set so a later workout never shows it', await E(`localStorage.getItem('gymquest_xp_note') !== null`));
    await load([wk(1, 12)]);
    check('fresh user who later trains: note still hidden', await E(`document.getElementById('xp-note').hidden`));

    console.log('== Dlaždica Dnes pre známu históriu');
    const hist = []; for (let i = 0; i < 9; i++) hist.push(wk(i, 12));   // 9 × 54 XP = 486 + úspechy
    await E(`localStorage.removeItem('gymquest_xp_note')`);
    await load(hist);
    const xp = await E(`totalXP()`);
    const ex = expectLevel(xp);
    check('known history: total XP >= 486 and level from the independent formula', xp >= 486 && ex.level >= 2, { xp, ex });
    check('tile level number', (await txt('bt-level-l')) === 'Level ' + ex.level, await txt('bt-level-l'));
    check('tile total XP', (await txt('bt-level-v')) === xp + ' XP', await txt('bt-level-v'));
    check('tile "N XP to level L" uses the new cost', (await txt('bt-level-line')) === (ex.cost - ex.into) + ' XP to level ' + (ex.level + 1), [await txt('bt-level-line'), ex]);
    const w = await E(`document.getElementById('bt-level-bar').style.width`);
    check('bar width = into / cost', w === Math.round(ex.into / ex.cost * 100) + '%', [w, ex]);
    check('Motivation card: level + remaining XP', (await txt('level-value')) === String(ex.level) && Math.round(parseFloat(await E(`document.getElementById('level-progress').style.width`))) === Math.round(ex.into / ex.cost * 100), [await txt('level-value')]);
    check('You pill shows level and XP', (await E(`(renderTy(), document.getElementById('ty-level-line').textContent)`)).includes(String(xp)));
    check('header level badge', (await txt('header-level')).endsWith(String(ex.level)), await txt('header-level'));

    console.log('== Jednorazová poznámka');
    check('user with history: note visible', await E(`!document.getElementById('xp-note').hidden`));
    check('note text is the recalculated message (en)', (await txt('xp-note-text')) === 'XP and levels now follow new rules: steady training counts most. Your level was recalculated from your workouts.', await txt('xp-note-text'));
    check('note does not claim the level was kept', !/kept/i.test(await txt('xp-note-text')));
    const bh = await E(`document.getElementById('btn-xp-note').getBoundingClientRect().height`);
    check('dismiss button >= 44 px', bh >= 44, bh);
    check('note does not overflow horizontally', await E(`document.documentElement.scrollWidth <= innerWidth + 1`));
    await shot('note-en-light');
    await E(`document.getElementById('btn-xp-note').click()`);
    check('dismiss hides it', await E(`document.getElementById('xp-note').hidden`));
    check('flag is device-only (localStorage, not in state)', (await E(`localStorage.getItem('gymquest_xp_note')`)) === '1' && !(await E(`JSON.stringify(state)`)).includes('xp_note'));
    await E(`(saveState(), true)`); await p.reload(); await wait(400);
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    check('after reload: never again', await E(`document.getElementById('xp-note').hidden`));
    const langs = JSON.parse(await E(`JSON.stringify(['sk','en','es','pt-BR','fr','ar'].map((l) => { setLang(l); return [l, t('xp.recalculated'), t('xp.gotIt'), t('xp.levelUp', { n: 3 })]; }))`));
    check('6 languages: note, button and level-up translated', langs.length === 6 && langs.every((r) => r[1] && r[1] !== 'xp.recalculated' && r[2] !== 'xp.gotIt' && /3/.test(r[3]) && r[3] !== 'xp.levelUp') && new Set(langs.map((r) => r[1])).size === 6, langs);
    await E(`setLang('en')`);

    console.log('== Hláška o novej úrovni po Dokončiť');
    await E(`(() => { state.plans['lvtest'] = { id: 'lvtest', builtin: false, customName: 'Lv test', location: null, exercises: [{ id: 'cx-l1', name: 'Curl test', sets: 3, reps: 10, weight: 20 }] };
      if (!state.planOrder.includes('lvtest')) state.planOrder.push('lvtest'); saveState(); return true; })()`);
    const finish = async () => {
      await E(`(selectedPlan = 'lvtest', switchTab('trening'), renderTrening(), true)`); await wait(250);
      for (let i = 0; i < 3; i++) await E(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-item:not(.drop-item) .set-btn')[${i}].click(), true)`);
      await E(`(finishWorkout(), confirmFinish(), true)`); await wait(300);
      return JSON.parse(await E(`JSON.stringify({ up: lastLevelUp, shown: !document.getElementById('result-levelup').hidden, text: document.getElementById('result-levelup').textContent, total: totalXP(), xp: lastXP })`));
    };
    /* Prípad A: prvý tréning (36 XP + úspech za prvý tréning) prekročí hranicu úrovne 1 */
    await E(`(() => { state.history = []; state.activities = []; state.achievements = {}; saveState(); return true; })()`);
    const a = await finish();
    check('first workout crosses level 1 (total ' + a.total + '): message shows level 1', expectLevel(a.total).level === 1 && a.up === 1 && a.shown && /1/.test(a.text), a);
    await E(`(document.getElementById('modal-result').hidden = true, true)`);
    const a2 = await finish();
    check('second workout stays inside level 1 (total ' + a2.total + '): no level-up message', expectLevel(a2.total).level === 1 && a2.up === 0 && !a2.shown, a2);
    await E(`(document.getElementById('modal-result').hidden = true, true)`);
    /* Prípad B: tesne pod hranicou nejakej úrovne (zvolí sa podľa odomknutých úspechov), tréning (36 XP) ju prekročí */
    const filler = JSON.parse(await E(`(() => {
      const mk = (i, sets) => ({ id: 'f' + i, date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), planId: 'push', planName: 'P', xp: 0, note: '', exercises: [{ name: 'Bench', exId: 'bench-press', sets: sets, reps: 8, weight: 50, setsDone: sets }] });
      for (let L = 3; L < 12; L++) {
        const tgt = 10 * L * L + 70 * L, gap = tgt - 20;
        state.history = []; state.activities = []; state.achievements = {}; xpCacheClear(); reconcileAchievements();
        let i = 0;
        while (totalXP() < gap && i < 80) {
          const x = Math.min(78, gap - totalXP());
          if (x >= 36) state.history.push(mk(++i, Math.floor((x - 30) / 2)));
          else if (x >= 5) state.activities.push({ id: 'a' + (++i), kind: 'run', date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), startedAt: 1, endedAt: 2, activeSeconds: 2 * x * 60, distanceKm: null, note: '' });
          else break;
          xpCacheClear(); reconcileAchievements();
        }
        const T = totalXP();
        if (T < tgt && tgt - T <= 36) { saveState(); return JSON.stringify({ t: T, L: levelForXp(T).level, tgt, target: L }); }
      }
      return JSON.stringify({ fail: true }); })()`));
    check('prepared state is just below a level boundary (<= 36 XP short)', !filler.fail && filler.L === filler.target - 1, filler);
    const bb = await finish();
    check('crossing the boundary: level-up shows the new level ' + filler.target, expectLevel(bb.total).level === filler.target && bb.up === filler.target && bb.shown && bb.text.includes(String(filler.target)), bb);
    await shot('levelup-en');
    await E(`(document.getElementById('modal-result').hidden = true, true)`);
    /* Prípad C: ďalší tréning bez prekročenia -> hláška zmizne */
    const cc = await finish();
    check('next workout inside the same level: no level-up message', expectLevel(cc.total).level === filler.target && cc.up === 0 && !cc.shown, cc);
    await E(`(document.getElementById('modal-result').hidden = true, true)`);

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
