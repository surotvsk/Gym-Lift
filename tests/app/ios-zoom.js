'use strict';
/* GymQuest — the iPhone zoom bug from the 2026-10-27 screen recording (real headless Chrome, iPhone 16 size).

     [GQ_TEST_PORT=8134] node tests/app/ios-zoom.js

   Safari on iPhone (and the app added to the Home Screen) zooms the whole page when a text field with a font
   smaller than 16 px gets focus, and it does not zoom back out; a quick second tap (e.g. on a plan tile) zooms
   too, unless the page sets touch-action: manipulation. Chrome does neither, so this test checks the two
   conditions Safari uses, not the zoom itself — a real iPhone is still the final check. It also replays the
   recording's steps: edit a plan, type an exercise, save, leave, reload; and "Save to my plans" under a shared
   workout must ask first and remember where the copy came from. */
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8124);
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-ios-zoom');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + J(info) : '')); };

/* Všetky textové polia v DOM (aj skryté – ich písmo je rovnaké aj po otvorení), ktoré by iPhone priblížil. */
const SMALL_FIELDS = `(() => [...document.querySelectorAll('input, select, textarea')]
  .filter((e) => !['checkbox', 'radio', 'file', 'range', 'hidden', 'color'].includes(e.type))
  .map((e) => ({ id: e.id || e.className || e.tagName, fs: parseFloat(getComputedStyle(e).fontSize) }))
  .filter((x) => x.fs < 16))()`;
const TOUCH = (sel) => `(() => { const e = document.querySelector(${J(sel)}); return e ? getComputedStyle(e).touchAction : 'missing'; })()`;

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('ioszoom-' + Date.now().toString(36), 10097, path.join(WORK, 'profiles'));
  try {
    const p = await b.launch();
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
    await p.navigate(BASE);
    await waitFor(() => p.eval(`typeof startEditPlan === 'function' && !!document.getElementById('bento-grid')`), 20000, 'app');
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return 1; })()`);

    const vp = await p.eval(`document.querySelector('meta[name=viewport]').content`);
    check('pinch zoom stays possible (no user-scalable=no / maximum-scale)', !/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(vp), vp);

    /* 1. Úprava plánu (začiatok nahrávky): polia cvikov nesmú spustiť priblíženie. */
    await p.eval(`(switchTab('trening'), startEditPlan('push'), 1)`);
    await wait(500);
    const rows = await p.eval(`document.querySelectorAll('#edit-rows .edit-row').length`);
    check('Edit plan shows the exercise rows', rows > 0, rows);
    check('no text field anywhere is smaller than 16 px (iPhone zooms on those)', (await p.eval(SMALL_FIELDS)).length === 0, await p.eval(SMALL_FIELDS));
    const nameFs = await p.eval(`parseFloat(getComputedStyle(document.querySelector('#edit-rows .edit-name')).fontSize)`);
    const numFs = await p.eval(`parseFloat(getComputedStyle(document.querySelector('#edit-rows .edit-num')).fontSize)`);
    check('exercise name and number fields are 16 px', nameFs >= 16 && numFs >= 16, { nameFs, numFs });
    const overflow = await p.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check('Edit plan has no sideways overflow at iPhone 16 width', overflow <= 0, overflow);

    /* 2. Rovnaký postup ako na videu: napísať cvik, uložiť, odísť, obnoviť stránku – musí zostať uložený. */
    await p.eval(`(() => {
      const row = document.querySelector('#edit-rows .edit-row');
      const set = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
      set(row.querySelector('.edit-name'), 'Dumbbell curls test');
      const nums = row.querySelectorAll('.edit-num');
      set(nums[0], '2'); set(nums[1], '15'); set(nums[2], '8');
      return 1;
    })()`);
    await p.eval(`(saveEditPlan(), 1)`);
    await wait(300);
    const saved = await p.eval(`(() => { const e = state.plans.push.exercises[0]; return { name: e.name, sets: e.sets, reps: e.reps, weight: e.weight }; })()`);
    check('edited exercise is saved (name, sets, reps, kg)', saved.name === 'Dumbbell curls test' && saved.sets === 2 && saved.reps === 15 && saved.weight === 8, saved);
    await p.eval(`(switchTab('pokrok'), switchTab('dnes'), switchTab('trening'), 1)`);
    await p.navigate(BASE);
    await waitFor(() => p.eval(`typeof state !== 'undefined' && !!state.plans && !!state.plans.push`), 20000, 'reload');
    const afterReload = await p.eval(`(() => { const e = state.plans.push.exercises[0]; return { name: e.name, sets: e.sets, reps: e.reps, weight: e.weight }; })()`);
    check('…and still there after leaving the tab and reloading', J(afterReload) === J(saved), afterReload);

    /* 3. Dvojité ťuknutie na dlaždicu plánu / tlačidlo nesmie približovať; ťahanie cvikov si drží vlastné správanie. */
    await p.eval(`(switchTab('trening'), 1)`);
    await wait(300);
    const tile = await p.eval(TOUCH('#screen-trening button, #screen-trening [data-plan]'));
    const tab = await p.eval(TOUCH('.tab'));
    const body = await p.eval(`getComputedStyle(document.body).touchAction`);
    check('plan tiles, tab bar and page ignore double-tap zoom (touch-action: manipulation)', [tile, tab, body].every((v) => v === 'manipulation'), { tile, tab, body });
    await p.eval(`(startEditPlan('push'), 1)`);
    await wait(300);
    const handle = await p.eval(`(() => { const e = document.querySelector('#edit-rows .drag-handle, #edit-rows [class*=drag]'); return e ? getComputedStyle(e).touchAction : 'no-handle'; })()`);
    check('drag handle keeps its own touch-action', handle === 'none' || handle === 'no-handle', handle);
    await p.eval(`(cancelEditPlan(), 1)`);

    /* 4. „Uložiť do mojich plánov“: najprv otázka; Zrušiť nič nemení; Uložiť pridá kópiu s pôvodom. */
    const share = { name: 'Shared, Biceps', exercises: [{ n: 'Dumbell curls', s: 2, r: 15, w: 8, u: true }, { n: 'hammer curls', s: 3, r: 10, w: 7 }] };
    const before = await p.eval(`(window.__plansBefore = JSON.stringify(state.plans), Object.keys(state.plans).length)`);
    await p.eval(`(communityPostShares['post-1'] = ${J(share)}, communitySaveShared('post', 'post-1'), 1)`);
    const asked = await p.eval(`({ open: !document.getElementById('modal-generic').hidden, title: document.getElementById('generic-title').textContent })`);
    check('Save to my plans asks first (names the plan)', asked.open && /Shared, Biceps/.test(asked.title), asked);
    check('…nothing is saved before the answer', (await p.eval(`Object.keys(state.plans).length`)) === before);
    await p.eval(`(closeGeneric(), 1)`);
    check('Cancel adds no plan and changes nothing', (await p.eval(`JSON.stringify(state.plans) === window.__plansBefore`)));
    await p.eval(`(communitySaveShared('post', 'post-1'), confirmGeneric(), 1)`);
    const copy = await p.eval(`(() => { const pl = Object.values(state.plans).find((x) => x.customName === 'Shared, Biceps'); return pl ? { source: pl.source, ex: pl.exercises.map((e) => [e.name, e.sets, e.reps, e.weight, !!e.unilateral]) } : null; })()`);
    check('Save adds one copy with the card values', copy && copy.ex.length === 2 && copy.ex[0][3] === 8 && copy.ex[0][4] === true, copy);
    check('…and remembers where it came from (post id)', copy && copy.source && copy.source.kind === 'post' && copy.source.ref === 'post-1' && !!copy.source.at, copy && copy.source);
    const othersSame = await p.eval(`(() => { const b = JSON.parse(window.__plansBefore); return Object.keys(b).every((k) => JSON.stringify(b[k]) === JSON.stringify(state.plans[k])); })()`);
    check('…and leaves every other plan exactly as it was', othersSame);

    /* 5. Nové (prázdne) zariadenie nemá žiadny cudzí plán. */
    const names = await p.eval(`Object.values(state.plans).map((x) => planDisplayName(x))`);
    check('defaults contain no personal plan (only built-in / own ones)', !names.some((n) => /cecky/i.test(n)), names);
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
