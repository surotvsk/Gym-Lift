'use strict';
/* GymQuest — untouched built-in Push/Pull plans show their muscle groups (owner decision D5), in real headless Chrome.

     node tests/app/plan-names.js      (GQ_TEST_PORT, GQ_SHOTS = folder for screenshots, optional)

   Checks: fresh state → Workout tiles and Today "Next up" show the long names in 6 languages; a plan with an
   added exercise keeps "Push"; customName wins; history keeps its recorded planName; isBuiltinPlanLabel accepts
   the short and the long name in every language; long names stay inside their tiles at 360 / 393 px and at
   130 % scale (en, fr, ar; light and dark). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-plan-names');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const NAMES = {
  sk: ['Hrudník, ramená a triceps', 'Chrbát a biceps', 'Nohy'],
  en: ['Chest, Shoulders & Triceps', 'Back & Biceps', 'Legs'],
  es: ['Pecho, hombros y tríceps', 'Espalda y bíceps', 'Piernas'],
  'pt-BR': ['Peito, ombros e tríceps', 'Costas e bíceps', 'Pernas'],
  fr: ['Pectoraux, épaules et triceps', 'Dos et biceps', 'Jambes'],
  ar: ['الصدر والكتفان والترايسبس', 'الظهر والبايسبس', 'الأرجل'],
};
const SHORT = { sk: ['Push', 'Pull'], en: ['Push', 'Pull'], es: ['Empuje', 'Tirón'], 'pt-BR': ['Empurrar', 'Puxar'], fr: ['Poussée', 'Tirage'], ar: ['دفع', 'سحب'] };

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('plnames-' + Date.now().toString(36), 9878, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  await p.c.send('Runtime.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const tileNames = () => p.eval(`[...document.querySelectorAll('.plan-chips .chip-name')].map((n) => n.textContent)`);
  const shot = async (file) => {
    if (!SHOTS) return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, 'base64'));
  };
  try {
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);

    console.log('== names per language (fresh state)');
    for (const lang of Object.keys(NAMES)) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), true)`); await wait(150);
      const got = (await tileNames()).slice(0, 3);
      check(lang + ': Workout tiles ' + NAMES[lang].join(' | '), J(got) === J(NAMES[lang]), got);
      await p.eval(`(switchTab('dnes'), true)`); await wait(100);
      const next = await p.eval(`document.getElementById('bt-next-name').textContent`);
      check(lang + ': Today "Next up" shows a full name', NAMES[lang].slice(0, 3).includes(next), next);
    }

    console.log('== touched / renamed / history');
    await p.eval(`(setLang('en'), true)`);
    await p.eval(`(() => { state.plans.push.exercises.push({ name: 'Extra', sets: 3, reps: 10, weight: 5 }); state.plans.pull.customName = 'My pull'; saveState(); renderAll(); switchTab('trening'); return true; })()`);
    await wait(150);
    const n = await tileNames();
    check('push with an added exercise stays "Push"', n[0] === 'Push', n);
    check('pull with customName shows "My pull"', n[1] === 'My pull', n);
    check('builtinPlanUntouched false for both, true for a fresh copy',
      await p.eval(`!builtinPlanUntouched(state.plans.push) && !builtinPlanUntouched(state.plans.pull) && builtinPlanUntouched(JSON.parse(JSON.stringify(DEFAULT_PLANS.push)))`));
    check('only the exercise list matters: changed sets/reps/weights stay untouched', await p.eval(`(() => { const c = JSON.parse(JSON.stringify(DEFAULT_PLANS.push)); c.exercises[0].sets = 9; c.exercises[1].weight = 99; return builtinPlanUntouched(c); })()`));
    check('a reordered exercise list is touched', await p.eval(`(() => { const c = JSON.parse(JSON.stringify(DEFAULT_PLANS.push)); c.exercises.reverse(); return !builtinPlanUntouched(c); })()`));
    await p.eval(`(() => { state.plans.push = JSON.parse(JSON.stringify(DEFAULT_PLANS.push)); state.plans.pull = JSON.parse(JSON.stringify(DEFAULT_PLANS.pull)); state.history = [{ id: 'pn-1', date: localDateKey(new Date()), planId: 'push', planName: 'Push', xp: 10, exercises: [] }]; saveState(); renderAll(); return true; })()`);
    check('history entry keeps its recorded planName', await p.eval(`state.history[0].planName === 'Push'`));
    check('untouched push again shows the long name', (await tileNames())[0] === 'Chest, Shoulders & Triceps', await tileNames());
    check('recordedPlanName stays the short canonical name', await p.eval(`recordedPlanName(state.plans.push) === 'Push'`));

    console.log('== isBuiltinPlanLabel');
    check('push: "Push" and the long name', await p.eval(`isBuiltinPlanLabel('push', 'Push') && isBuiltinPlanLabel('push', 'Chest, Shoulders & Triceps')`));
    let allOk = true; const badL = [];
    for (const lang of Object.keys(NAMES)) {
      const ok = await p.eval(`isBuiltinPlanLabel('push', ${J(NAMES[lang][0])}) && isBuiltinPlanLabel('pull', ${J(NAMES[lang][1])}) && isBuiltinPlanLabel('push', ${J(SHORT[lang][0])}) && isBuiltinPlanLabel('pull', ${J(SHORT[lang][1])}) && !isBuiltinPlanLabel('pull', ${J(NAMES[lang][0])})`);
      if (!ok) { allOk = false; badL.push(lang); }
    }
    check('short and long labels accepted in all 6 languages (and not crossed)', allOk, badL);

    console.log('== fit inside tiles (360 / 393 px and 130 % scale; en, fr, ar; light, dark)');
    const bad = [];
    for (const mode of ['light', 'dark']) {
      await p.eval(`(localStorage.setItem('gymquest_theme', ${J(mode)}), applyTheme(), true)`);
      for (const [w, scale] of [[360, 1], [393, 1], [360, 1.3], [393, 1.3]]) {
        await p.c.send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / scale), height: Math.round(760 / scale), deviceScaleFactor: scale, mobile: true });
        for (const lang of ['en', 'fr', 'ar']) {
          await p.eval(`(setLang(${J(lang)}), true)`);
          for (const tab of ['trening', 'dnes']) {
            await p.eval(`(switchTab(${J(tab)}), true)`); await wait(120);
            const out = await p.eval(`(() => { const tiles = tab => [...document.querySelectorAll(tab)];
              const sel = ${J(tab)} === 'trening' ? '.plan-chips .chip' : '#bt-next';
              return tiles(sel).filter((t) => !t.hidden && t.offsetParent).flatMap((t) => { const r = t.getBoundingClientRect();
                const o = [t.scrollWidth > t.clientWidth + 1 ? 'tile scrolls' : ''];
                [...t.querySelectorAll('*')].filter((c) => c.offsetParent && c.tagName !== 'IMG' && !c.closest('svg') && !c.closest('.sr-only')).forEach((c) => { const q = c.getBoundingClientRect();
                  if (q.width && (q.right > r.right + 1 || q.left < r.left - 1 || q.bottom > r.bottom + 1)) o.push((c.id || c.className || c.tagName)); });
                return o.filter(Boolean).map((x) => (t.id || t.className) + ' > ' + x); }); })()`);
            if (out.length) bad.push([mode, w, scale, lang, tab, out.slice(0, 3)]);
            if (SHOTS && w === 360 && scale === 1) await shot((tab === 'trening' ? 'workout' : 'today') + '-' + lang + '-' + mode + '-360.png');
          }
        }
      }
    }
    check('names stay inside the Workout plan tiles and the Today Next-up tile', bad.length === 0, bad.slice(0, 4));
    await p.eval(`(localStorage.removeItem('gymquest_theme'), applyTheme(), true)`);

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
