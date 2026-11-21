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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Real pointer tap at the centre of a visible element; fails when something else covers it. */
  const tap = async (selector) => {
    const pt = await E(`(() => { const e = document.querySelector(${J(selector)}); if (!e) return { ok: false }; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y); return { x, y, ok: !!hit && e.contains(hit) }; })()`);
    if (!pt.ok) throw new Error('Not tappable: ' + selector);
    await p.c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await p.c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await wait(150);
  };
  /* Geometry of the plan rows: `bad` lists every violated rule (empty = fine). */
  const rowsCheck = (opts) => E(`(() => {
    const o = ${J(opts || {})}, box = document.getElementById('plan-chips'), cs = getComputedStyle(box), br = box.getBoundingClientRect();
    const iL = br.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), iR = br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const ids = activePlanIds(), rows = Array.from(box.children).filter((w) => w.classList.contains('chip-wrap')), bad = [];
    if (rows.length !== ids.length || rows.some((w, i) => w.dataset.planId !== ids[i])) bad.push('order/count mismatch');
    let prev = null;
    rows.forEach((w) => {
      const r = w.getBoundingClientRect(), c = w.querySelector('.chip'), cr = c.getBoundingClientRect(), id = w.dataset.planId;
      const kids = Array.from(w.children).filter((k) => k.getClientRects().length).map((k) => k.getBoundingClientRect());
      if (Math.abs(r.left - iL) > 2 || Math.abs(r.right - iR) > 2) bad.push(id + ' not full width ' + [r.left, r.right, iL, iR].map(Math.round));
      if (r.left < -1 || r.right > innerWidth + 1) bad.push(id + ' outside the screen');
      if (r.height < 44 || cr.height < 44) bad.push(id + ' under 44 px high: ' + Math.round(r.height));
      if (o.maxH && r.height > o.maxH) bad.push(id + ' taller than ' + o.maxH + ': ' + Math.round(r.height));
      if (!o.manage && (cr.width < r.width - 2 || kids.length !== 1)) bad.push(id + ' chip does not fill its row alone');
      if (o.manage && kids.length !== 3) bad.push(id + ' manage row shows ' + kids.length + ' parts, not 3');
      kids.forEach((k, i) => {
        if (k.left < r.left - 1 || k.right > r.right + 1) bad.push(id + ' part outside its row');
        for (let j = i + 1; j < kids.length; j++) if (Math.min(k.right, kids[j].right) - Math.max(k.left, kids[j].left) > 1) bad.push(id + ' parts overlap');
      });
      if (prev && r.top < prev.bottom - 0.5) bad.push(id + ' overlaps the row above');
      prev = r;
    });
    return { n: rows.length, bad, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  })()`);
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
    console.log('== plan rows: compact coloured full-width rows (393 px)');
    await E(`(() => { for (const [id, name, ex] of [['pmA', 'Row plan Alpha', 'Alpha press'], ['pmB', 'Row plan Bravo', 'Bravo curl'], ['pmC', 'Row plan Charlie', 'Charlie squat']]) {
      state.plans[id] = { id, builtin: false, customName: name, location: null, exercises: [{ id: 'cx-' + id, name: ex, sets: 3, reps: 8, weight: 20 }] };
      if (!state.planOrder.includes(id)) state.planOrder.push(id); }
      clearSession(); selectedPlan = 'pmA'; saveState(); switchTab('trening'); renderTrening(); window.scrollTo(0, 0); return true; })()`);
    let rc = await rowsCheck({ maxH: 110 });
    check('every plan is one row, in plan order', rc.n >= 4 && !rc.bad.some((x) => /order/.test(x)), rc);
    check('393 px: every row spans the full available width, ≥ 44 px and ≤ 110 px high, inside the screen', rc.bad.length === 0 && !rc.overflow, rc);
    check('rows are stacked top to bottom without overlap', await E(`(() => { const r = Array.from(document.querySelectorAll('#plan-chips > .chip-wrap')).map((w) => w.getBoundingClientRect()); return r.length > 1 && r.every((x, i) => i === 0 || (x.top >= r[i - 1].bottom - 0.5 && x.top > r[i - 1].top)); })()`));
    const tone = (id) => E(`(() => { const c = document.querySelector('#plan-chips [data-plan-id="${id}"] .chip'), s = getComputedStyle(c), a = getComputedStyle(c, '::after'), b = getComputedStyle(c, '::before');
      return { tile: c.dataset.tile, bg: s.backgroundColor, pressed: c.getAttribute('aria-pressed'), active: c.classList.contains('active'),
        sig: [s.boxShadow, s.outlineStyle + s.outlineWidth + s.outlineColor, s.borderTopColor, s.borderTopWidth, s.transform, a.content, a.width, a.backgroundColor, b.content, b.width, b.backgroundColor].join('|') }; })()`);
    const pressedIds = () => E(`Array.from(document.querySelectorAll('#plan-chips .chip[aria-pressed="true"]')).map((c) => c.closest('.chip-wrap').dataset.planId)`);
    const tA = await tone('pmA'), tB = await tone('pmB');
    check('only the selected plan is pressed (and .active); every row has a colour tile', J(await pressedIds()) === J(['pmA']) && tA.active && tA.pressed === 'true' && !tB.active && tB.pressed === 'false'
      && !(await E(`Array.from(document.querySelectorAll('#plan-chips .chip')).some((c) => /^(rgba\\(0, 0, 0, 0\\)|transparent)$/.test(getComputedStyle(c).backgroundColor) || c.dataset.tile === undefined)`)), { tA, tB });
    check('the selected row is visibly distinct from an unselected one', tA.sig !== tB.sig, { a: tA.sig, b: tB.sig });
    const titleA = await E(`document.getElementById('plan-title').textContent`), detailA = await E(`document.getElementById('tr-detail-rows').textContent`);
    await tap('#plan-chips [data-plan-id="pmB"] .chip');
    const tB2 = await tone('pmB'), tA2 = await tone('pmA');
    check('tapping another plan selects it: only it is pressed and it keeps its tone', await E(`selectedPlan`) === 'pmB' && J(await pressedIds()) === J(['pmB']) && tB2.pressed === 'true' && tB2.tile === tB.tile && tB2.bg === tB.bg && tA2.pressed === 'false' && tA2.tile === tA.tile && tA2.bg === tA.bg, { tB, tB2, tA, tA2 });
    check('the preview follows the selection (title and exercise rows change)', await E(`document.getElementById('plan-title').textContent`) === 'Row plan Bravo' && titleA === 'Row plan Alpha'
      && (await E(`document.getElementById('tr-detail-rows').textContent`)).includes('Bravo curl') && !(await E(`document.getElementById('tr-detail-rows').textContent`)).includes('Alpha press') && detailA.includes('Alpha press'), { titleA, detailA });
    rc = await rowsCheck({ maxH: 110 });
    check('rows keep their geometry after the selection changed', rc.bad.length === 0 && !rc.overflow, rc);
    const startBox = await E(`(() => { const b = document.getElementById('tr-start'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { vis: b.checkVisibility(), h: r.height, w: r.width }; })()`);
    check('Start stays a usable ≥ 44 px control', startBox.vis && startBox.h >= 44 && startBox.w >= 44, startBox);
    await tap('#tr-start');
    check('Start begins a workout of the selected plan', await E(`!!getSession() && getSession().planId === 'pmB' && document.getElementById('tr-pick').hidden`));
    await E(`(clearSession(), saveState(), renderTrening(), window.scrollTo(0, 0), true)`);
    rc = await rowsCheck({ maxH: 110 });
    check('after the workout is cleared the plan rows are back and unchanged in geometry', await E(`!getSession() && !document.getElementById('tr-pick').hidden && selectedPlan === 'pmB'`) && rc.bad.length === 0, rc);

    console.log('== manage mode keeps handle, edit and reorder in the row');
    await tap('#btn-manage-plans');
    rc = await rowsCheck({ manage: true, maxH: 110 });
    check('in manage mode each row shows handle + plan + edit inside its full width, without overlap', await E(`planManageMode === true`) && rc.bad.length === 0 && !rc.overflow, rc);
    const orderBefore = await E(`activePlanIds().join()`);
    await E(`(movePlan('pmC', -1), true)`);
    const orderAfter = await E(`activePlanIds().join()`);
    rc = await rowsCheck({ manage: true, maxH: 110 });
    check('reordering moves the row in the list and keeps the geometry', orderAfter !== orderBefore && await E(`Array.from(document.querySelectorAll('#plan-chips > .chip-wrap')).map((w) => w.dataset.planId).join()`) === orderAfter && rc.bad.length === 0, { orderBefore, orderAfter, rc });
    await tap('#plan-chips [data-plan-id="pmB"] .chip-edit');
    check('the pencil opens the editor for that plan', await E(`editingPlan === 'pmB' && !document.getElementById('edit-panel').hidden && document.getElementById('edit-plan-name').value === 'Row plan Bravo'`));
    await E(`(document.getElementById('btn-edit-cancel').click(), true)`);
    check('cancelling leaves the plan untouched', await E(`editingPlan === null && getPlan('pmB').customName === 'Row plan Bravo'`));
    await E(`(setPlanManageMode(false), true)`);

    const hints = await E(`(() => { const out = {}; for (const l of ['sk','en','es','pt-BR','fr','ar']) { setLang(l); out[l] = t('trening.manageHint'); } setLang('en'); return out; })()`);
    check('hint in 6 languages, all different, mention ⠿ and ✏️', Object.values(hints).every((h) => h && h.includes('⠿') && h.includes('✏️')) && new Set(Object.values(hints)).size === 6, hints);
    for (const [lang, w, theme] of [['ar', 320, 'dark'], ['fr', 320, 'light'], ['sk', 360, 'dark']]) {
      await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 1, mobile: true });
      await E(`(() => { setLang(${J(lang)}); document.documentElement.dataset.theme = ${J(theme)}; setPlanManageMode(true); window.scrollTo(0, 0); return true; })()`);
      g = await geo();
      check(`${lang} ${w}px ${theme}: no overflow, Done in view and ≥ 44 px`, !g.overflow && g.inView && g.doneH >= 44, g);
      rc = await rowsCheck({ manage: true });
      check(`${lang} ${w}px ${theme}: manage rows fill the width, ≥ 44 px, nothing overlaps or overflows`, rc.bad.length === 0 && !rc.overflow, rc);
      await shot(`manage-${lang}-${w}-${theme}.png`);
      await E(`setPlanManageMode(false)`);
      rc = await rowsCheck({});
      check(`${lang} ${w}px ${theme}: normal rows are full width, ≥ 44 px, stacked and inside the screen (dir ${await E('document.documentElement.dir')})`, rc.bad.length === 0 && !rc.overflow && (lang !== 'ar' || await E(`document.documentElement.dir`) === 'rtl'), rc);
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
