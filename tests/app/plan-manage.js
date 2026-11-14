'use strict';
/* GymQuest — úprava poradia plánov: lišta s nápovedou a výrazným Hotovo priamo nad plánmi (v106), headless Chrome.

     GQ_TEST_PORT=8190 node tests/app/plan-manage.js

   Checks: lišta je skrytá mimo úprav; po zapnutí úprav je nad plánmi, viditeľná bez posúvania, Hotovo má ≥ 44 px
   a ukončí úpravy; nápoveda hovorí, že poradie sa ukladá hneď (6 jazykov); presun plánu sa uloží hneď
   (bez Hotovo); 320 px a arabčina bez pretečenia; svetlý aj tmavý režim. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-plan-manage');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
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
  const b = new Browser('pm-' + Date.now().toString(36), 9893, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const E = (code) => p.eval(code);
  const errors = [];
  p.c.on('Runtime.exceptionThrown', (e) => errors.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const shot = async (file) => {
    if (process.env.GQ_SCREENSHOTS === '0' || !SHOTS) return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, 'base64'));
  };
  const geo = () => E(`(() => { const bar = document.getElementById('plan-manage-bar'), chips = document.getElementById('plan-chips'), done = document.getElementById('btn-plan-manage-done');
    const r = bar.getBoundingClientRect(), c = chips.getBoundingClientRect(), d = done.getBoundingClientRect();
    return { hidden: bar.hidden, barBottom: r.bottom, barTop: r.top, chipsTop: c.top, doneH: d.height, doneW: d.width, inView: d.top >= 0 && d.bottom <= innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || bar.scrollWidth > bar.clientWidth + 1, hint: document.getElementById('plan-manage-hint').textContent }; })()`);
  try {
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
    await p.navigate(BASE);
    await E(`(() => { localStorage.setItem('gymquest_tutorial', '{"v":1,"status":"done","at":0}'); const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('trening'); window.scrollTo(0, 0); return true; })()`);
    check('bar hidden outside manage mode', (await geo()).hidden === true);
    await E(`(() => { document.getElementById('btn-manage-plans').click(); window.scrollTo(0, 0); return true; })()`);
    let g = await geo();
    check('bar shown in manage mode', g.hidden === false, g);
    check('bar sits directly above the plans', g.barBottom <= g.chipsTop + 1 && g.chipsTop - g.barBottom < 24, g);
    check('Done visible without scrolling', g.inView, g);
    check('Done is a ≥ 44 px target', g.doneH >= 44 && g.doneW >= 44, g);
    check('hint says the order saves right away', /saves right away/.test(g.hint), g.hint);
    await shot('manage-en-light.png');
    const order0 = await E(`JSON.stringify(state.planOrder)`);
    const seq0 = await E(`syncMetaRead().seq`);
    await E(`(() => { movePlan(state.planOrder[1], -1); return true; })()`);
    check('moving a plan saves immediately (order changed, counter bumped, still managing)', await E(`JSON.stringify(state.planOrder)`) !== order0
      && await E(`syncMetaRead().seq`) > seq0 && await E(`planManageMode === true`));
    check('stored order matches state before Done', await E(`JSON.parse(localStorage.getItem(STORAGE_KEY)).planOrder.join() === state.planOrder.join()`));
    await E(`(() => { document.getElementById('btn-plan-manage-done').click(); return true; })()`);
    check('Done ends manage mode and hides the bar', await E(`planManageMode === false && document.getElementById('plan-manage-bar').hidden && document.querySelector('.chip-drag').hidden`));
    check('tile toggles the same mode (label back to Manage plans)', await E(`document.querySelector('#btn-manage-plans .bt-line').textContent === t('trening.managePlans')`));
    const hints = await E(`(() => { const out = {}; for (const l of ['sk','en','es','pt-BR','fr','ar']) { setLang(l); out[l] = t('trening.manageHint'); } setLang('en'); return out; })()`);
    check('hint in 6 languages, all different, mention ⠿ and ✏️', Object.values(hints).every((h) => h && h.includes('⠿') && h.includes('✏️')) && new Set(Object.values(hints)).size === 6, hints);
    for (const [lang, w, theme] of [['ar', 320, 'dark'], ['fr', 320, 'light'], ['sk', 360, 'dark']]) {
      await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 1, mobile: true });
      await E(`(() => { setLang(${J(lang)}); document.documentElement.dataset.theme = ${J(theme)}; setPlanManageMode(true); window.scrollTo(0, 0); return true; })()`);
      g = await geo();
      check(`${lang} ${w}px ${theme}: no overflow, Done in view and ≥ 44 px`, !g.overflow && g.inView && g.doneH >= 44, g);
      await shot(`manage-${lang}-${w}-${theme}.png`);
      await E(`setPlanManageMode(false)`);
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) {
    fail++; console.log('  FAIL test error  -> ' + (e && e.stack || e));
  } finally {
    try { await b.close(); } catch (_) {}
    try { server.close(); } catch (_) {}
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
