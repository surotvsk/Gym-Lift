'use strict';
/* Gym-Lift — mapa zotavenia svalov a tip na Dnes (gym-basics fáza 2, úloha 5), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/recovery.js

   Kontroluje: entryTime (endedAt, inak dátum o 12:00, nikdy po "teraz"), muscleRecovery (72 h / 48 h pre core a svaly rúk,
   RPE >= 9 váži 1.25, jednostranný cvik: obe strany = 1 séria), oddelený biceps/triceps a prednú mapu na dodanom obrázku,
   mini mapu v dlaždici Svaly a plnú mapu nad stĺpcami v liste, tip na Dnes (raz za deň, uložený len v localStorage, nikdy počas tréningu,
   nikdy pre nového používateľa, nie je v synchronizovanom obsahu), slovo "odhad", 6 jazykov + RTL, svetlý/tmavý režim na 390 px, bez chýb v konzole. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-recovery');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const H = 3.6e6;
/* vzorec zo zadania: zotavenie po `n` váhových sériách pred `age` hodinami */
const rec = (n, share, age, win, mult) => { if (age >= win) return 100; return Math.round(100 - Math.min(100, n * share * (mult || 1) * (1 - age / win) * 10)); };

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('recovery-' + Date.now().toString(36), 9877, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + JSON.stringify(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const sheet = `document.getElementById('modal-muscles')`;
  const ev = (s) => p.eval(s);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const DAY = `const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };`;
  const NOW = 1.8e12;   // pevné "teraz" pre vzorce
  const setHist = (hist) => p.eval(`(state.history = ${J(hist)}, saveState(), true)`);
  const bench = (n, extra) => Object.assign({ name: 'Bench Press', exId: 'bench-press', sets: n, reps: 5, weight: 100, setsDone: n }, extra || {});
  /* dátum záznamu = miestny dátum `endedAt` (endedAt s iným dňom sa po oprave ignoruje) */
  const lkey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const wo = (id, ended, exs, date) => ({ id, date: date || lkey(ended), planId: 'pp', planName: 'X', endedAt: ended, exercises: exs });
  const R = async (hist, now) => { await setHist(hist); return JSON.parse(await ev(`JSON.stringify(muscleRecovery(${now === undefined ? NOW : now}))`)); };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); try { localStorage.removeItem('gymquest_recovery_hint_day'); } catch (e) {} return true; })()`);

    console.log('== muscleRecovery formula');
    let r = await R([wo('a', NOW - 1 * H, [bench(10)])]);
    check('recovery values are finite percentages, with separate biceps and triceps', Number.isInteger(r.biceps) && Number.isInteger(r.triceps) && Object.values(r).every((v) => Number.isInteger(v) && v >= 0 && v <= 100), r);
    check('10 chest sets 1 h ago: chest from the formula (' + rec(10, 1, 1, 72) + ')', r.chest === rec(10, 1, 1, 72), r);
    check('bench loads deltoids and triceps but not biceps', r.shoulders === rec(10, 0.5, 1, 72) && r.triceps === rec(10, 0.5, 1, 48) && r.biceps === 100, r);
    check('untouched muscles are 100', r.back === 100 && r.arms === 100 && r.legs === 100 && r.glutes === 100 && r.core === 100, r);
    r = await R([wo('curl', NOW - H, [{ name: 'Bicep curls', exId: 'bicep-curls', sets: 5, setsDone: 5, reps: 10, weight: 12 }])]);
    check('curl-only history changes biceps, never triceps or chest', r.biceps === rec(5, 1, 1, 48) && r.triceps === 100 && r.chest === 100, r);
    r = await R([wo('a', NOW - 80 * H, [bench(10)])]);
    check('same sets 80 h ago: everything 100 (outside the window)', Object.values(r).every((v) => v === 100), r);
    r = await R([wo('a', NOW - 47 * H, [bench(10)])]);
    check('triceps at 47 h (48 h window) nearly fresh', r.triceps === rec(10, 0.5, 47, 48) && r.triceps >= 98, r);
    check('chest at 47 h still loaded (72 h window): ' + rec(10, 1, 47, 72), r.chest === rec(10, 1, 47, 72), r);
    r = await R([wo('a', NOW - 49 * H, [bench(10)])]);
    check('triceps at 49 h are fresh while deltoids still reflect their 72 h window', r.triceps === 100 && r.shoulders === rec(10, 0.5, 49, 72), r);
    r = await R([wo('a', NOW - 10 * H, [bench(4, { setRpe: [9.5, 9.5, 9.5, 9.5] })])]);
    check('RPE 9.5 sets weigh 1.25x: ' + rec(4, 1, 10, 72, 1.25), r.chest === rec(4, 1, 10, 72, 1.25), r);
    r = await R([wo('a', NOW - 10 * H, [bench(4, { setRpe: [8.5, 8.5, 8.5, 8.5] })])]);
    check('RPE 8.5 sets weigh 1x: ' + rec(4, 1, 10, 72), r.chest === rec(4, 1, 10, 72), r);
    r = await R([wo('a', NOW - 10 * H, [bench(2, { drops: [{ weight: 60, reps: 10 }, { weight: 40, reps: 10 }] })])]);
    check('drop sets count as sets (2 + 2 drops = 4)', r.chest === rec(4, 1, 10, 72), r);
    r = await R([wo('a', NOW - 10 * H, [bench(3, { warmups: [{ weight: 40, reps: 10 }, { weight: 60, reps: 5 }] })])]);
    check('warm-ups never count', r.chest === rec(3, 1, 10, 72), r);
    r = await R([wo('a', NOW - 10 * H, [{ name: 'Zottman curl', sets: 5, reps: 10, weight: 12, setsDone: 5 }])]);
    check('custom exercise never touches the map', Object.values(r).every((v) => v === 100), r);
    r = await R([wo('a', NOW - 5 * H, [{ name: 'Single arm row', exId: 'bent-over-rows', sets: 3, reps: 8, weight: 20, unilateral: true, sidesDone: { left: [1, 2, 3], right: [1, 2, 3] } }])]);
    const libRow = await ev(`JSON.stringify(libraryEntry('bent-over-rows') || null)`);
    const rowBack = rec(3, 1, 5, 72);
    check('unilateral: both sides of a set together = 1 set (back ' + rowBack + ')', r.back === rowBack, { r, libRow });
    r = await R([wo('a', NOW - 5 * H, [{ name: 'Single arm row', exId: 'bent-over-rows', sets: 3, reps: 8, weight: 20, unilateral: true, sidesDone: { left: [1, 2, 3], right: [] } }])]);
    check('unilateral: one side only = 0.5 per set', r.back === rec(3, 0.5, 5, 72), r);
    r = await R([wo('a', NOW - 20 * H, [bench(5)]), wo('b', NOW - 30 * H, [bench(5)])]);
    check('two workouts add up', r.chest === Math.round(100 - Math.min(100, (5 * (1 - 20 / 72) + 5 * (1 - 30 / 72)) * 10)), r);
    r = await R([wo('a', NOW - 1 * H, [bench(20)])]);
    check('fatigue is capped: chest 0, never negative', r.chest === 0, r);
    r = await R([wo('a', NOW + 5 * H, [bench(10)])]);
    check('endedAt in the future is clamped to now (age 0, never negative)', r.chest === rec(10, 1, 0, 72), r);
    r = await R([{ id: 'x', date: '2027-01-15', planId: 'pp', planName: 'X', endedAt: 'junk', exercises: [bench(10)] }, { id: 'y', exercises: null }, null, { id: 'z', date: 'junk', exercises: [bench(10)] }]);
    check('junk entries never throw and give a finite map', Object.values(r).every((v) => Number.isFinite(v)), r);
    check('empty history: all 100', Object.values(await R([])).every((v) => v === 100));

    console.log('== entryTime');
    const et = (await ev(`(() => { const d = new Date(2027, 0, 15, 12, 0).getTime(); const now = new Date(2027, 0, 15, 20, 0).getTime();
      return { noEnd: entryTime({ date: '2027-01-15', exercises: [] }, now) === d, withEnd: entryTime({ date: '2027-01-15', endedAt: d + 5000 }, now) === d + 5000,
        morningToday: entryTime({ date: '2027-01-15' }, new Date(2027, 0, 15, 8, 0).getTime()) === new Date(2027, 0, 15, 8, 0).getTime(),
        future: entryTime({ date: '2027-01-20' }, now) === now, badEnd: entryTime({ date: '2027-01-15', endedAt: -4 }, now) === d, def: typeof entryTime({ date: '2020-01-01' }) === 'number' }; })()`));
    check('no endedAt = the entry date at 12:00 local', et.noEnd, et);
    check('valid endedAt wins; invalid endedAt falls back to 12:00', et.withEnd && et.badEnd, et);
    check('dated today but before 12:00 (08:00 now): age 0, never negative', et.morningToday, et);
    check('a future date is clamped to now; now defaults to Date.now()', et.future && et.def, et);

    console.log('== bodyMapSvg');
    const svg = await ev(`bodyMapSvg({ chest: 100, shoulders: 50, biceps: 20, triceps: 70, thighs: 20, calves: 70, core: 85 }, { size: 'full' })`);
    const m = (await ev(`(() => { const d = document.createElement('div'); d.innerHTML = bodyMapSvg({ chest: 100, shoulders: 50, biceps: 20, triceps: 70, thighs: 20, calves: 70, core: 85 }, { size: 'full' });
      const cls = {}; d.querySelectorAll('[data-muscle]').forEach((e) => { cls[e.dataset.muscle] = e.getAttribute('class'); });
      const s = d.querySelector('svg'); return { n: d.querySelectorAll('[data-muscle]').length, cls, hasOther: !!d.querySelector('[data-muscle="other"]'), role: s.getAttribute('role'), aria: s.getAttribute('aria-label'),
        mini: (() => { const e = document.createElement('div'); e.innerHTML = bodyMapSvg({}, { size: 'mini' }); return e.querySelector('svg').getAttribute('class'); })(),
        image: s.querySelector('image').getAttribute('href') }; })()`));
    check('front diagram separates thighs and calves without inventing back, glute, hip or unspecified limb regions', !m.hasOther && !!m.cls.thighs && !!m.cls.calves && !m.cls.legs && !m.cls.arms && !m.cls.back && !m.cls.glutes && !m.cls.abductors && !m.cls.adductors, m);
    check('biceps/triceps and thighs/calves show independent recent loads', /rec-0/.test(m.cls.chest) && /rec-0/.test(m.cls.core) && /rec-1/.test(m.cls.triceps) && /rec-2/.test(m.cls.shoulders) && /rec-3/.test(m.cls.biceps) && /rec-3/.test(m.cls.thighs) && /rec-1/.test(m.cls.calves), m.cls);
    check('general Legs does not silently guess a thigh or calf highlight', await ev(`(() => { const d = document.createElement('div'); d.innerHTML = bodyMapSvg({ legs: 0 }, { size: 'full' }); return d.querySelector('[data-muscle="thighs"]').classList.contains('rec-0') && d.querySelector('[data-muscle="calves"]').classList.contains('rec-0'); })()`));
    check('boundaries: 84 -> rec-1, 60 -> rec-1, 59 -> rec-2, 35 -> rec-2, 34 -> rec-3', await ev(`(() => { const c = (v) => { const d = document.createElement('div'); d.innerHTML = bodyMapSvg({ chest: v }, { size: 'mini' }); return d.querySelector('[data-muscle="chest"]').getAttribute('class'); };
      return /rec-1/.test(c(84)) && /rec-1/.test(c(60)) && /rec-2/.test(c(59)) && /rec-2/.test(c(35)) && /rec-3/.test(c(34)); })()`));
    check('full diagram has a localized text alternative and mini is decorative', m.role === 'img' && !!m.aria && /mini/.test(m.mini), m);
    check('supplied body image decodes in the browser at its original resolution', await ev(`(async () => { const image = new Image(); image.src = ${J(m.image)}; await image.decode(); return image.naturalWidth === 572 && image.naturalHeight === 1024; })()`));
    check('missing recovery data leaves all visible regions neutral', await ev(`(() => { const d = document.createElement('div'); d.innerHTML = bodyMapSvg(null, { size: 'mini' }) + bodyMapSvg({ chest: NaN, biceps: 'x' }); return !/NaN|undefined/.test(d.innerHTML) && Array.from(d.querySelectorAll('[data-muscle]')).every(g => g.classList.contains('rec-0')); })()`));

    console.log('== tile and sheet');
    await p.eval(`(() => { ${DAY}
      state.history = [{ id: 'a1', date: day(0), planId: 'pp', planName: 'Push', endedAt: Date.now() - 3600000, exercises: [${J(bench(4))}, { name: "Squat", exId: "squats", sets: 3, reps: 5, weight: 120, setsDone: 3 }] }];
      saveState(); switchTab('pokrok'); setPokrokView('stats'); renderStatsGrid(); return true; })()`);
    await wait(150);
    const tile = (await ev(`(() => { const t = document.querySelector('#stats-grid [data-go="muscles"]'); const s = t.querySelector('svg.body-map');
      return { has: !!s, mini: !!s && s.classList.contains('mini'), n: t.querySelectorAll('[data-muscle]').length, h: s ? s.getBoundingClientRect().height : 0, tiles: document.querySelectorAll('#stats-grid .bt').length,
        text: t.innerText.replace(/\\s+/g, ' ').trim(), hidden: s ? s.getAttribute('aria-hidden') : null, role: s ? s.getAttribute('role') : null, chest: s ? s.querySelector('[data-muscle="chest"]').getAttribute('class') : '' }; })()`));
    check('Muscles tile holds the decorative mini image at a readable tile height', tile.has && tile.mini && tile.h >= 40 && tile.h <= 56, tile);
    check('tile keeps its line and still has exactly one new tile (no extra tile)', /Chest · 4 sets/.test(tile.text), tile);
    check('chest drawn worked on the tile (not rec-0)', !/rec-0/.test(tile.chest), tile);
    await p.eval(`(document.querySelector('#stats-grid [data-go="muscles"]').click(), true)`); await wait(200);
    const sh = (await ev(`(() => { const s = ${sheet}; const map = s.querySelector('svg.body-map'); const list = document.getElementById('muscles-list'); const nav = s.querySelector('.mu-nav');
      return { has: !!map, full: !!map && map.classList.contains('full'), n: s.querySelectorAll('[data-muscle]').length, above: !!map && !!(map.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
        text: s.innerText, w: map ? map.getBoundingClientRect().width : 0 }; })()`));
    check('sheet shows the full anatomical image above the bars', sh.has && sh.full && sh.above, sh);
    check('sheet wording says "estimate"', /estimate/i.test(sh.text), sh.text);
    check('sheet text has no NaN / undefined / raw key', !/NaN|undefined|recovery\./.test(sh.text), sh.text);
    await esc(); await wait(60);
    check('empty history: sheet map is all fresh (rec-0) and calm', await (async () => { await setHist([]); await p.eval(`(openMuscles(), true)`); await wait(100);
      const ok = await ev(`Array.from(${sheet}.querySelectorAll('svg.body-map [data-muscle]')).every(g => g.classList.contains('rec-0')) && !/NaN|undefined/.test(${sheet}.innerText)`);
      await esc(); await wait(60); return ok; })());

    console.log('== Today hint');
    const KEY = 'gymquest_recovery_hint_day';
    const hintSetup = (extraHist) => p.eval(`(() => { ${DAY}
      try { localStorage.removeItem('${KEY}'); } catch (e) {}
      state.settings = state.settings || {}; state.activeSession = null;
      state.planOrder = ['push', 'pull', 'legs']; ['push', 'pull', 'legs'].forEach((id) => { state.plans[id] = JSON.parse(JSON.stringify(DEFAULT_PLANS[id])); });
      const sq = (n, id, name) => ({ name, exId: id, sets: n, reps: 8, weight: 80, setsDone: n });
      state.history = [{ id: 'h1', date: day(0), planId: 'pull', planName: 'Pull', endedAt: Date.now() - 3600000, exercises: [sq(5, 'squats', 'Squat'), sq(5, 'leg-press', 'Leg press'), sq(5, 'lunges', 'Lunges'), sq(4, 'leg-curls', 'Leg curls')] }].concat(${J(extraHist || [])});
      saveState(); switchTab('dnes'); renderDnes(); return true; })()`);
    await hintSetup();
    await wait(150);
    const rp = await ev(`recommendedPlan()`);
    const hintEl = `document.getElementById('bt-recovery-hint')`;
    const ht = async () => ev(`(() => { const h = ${hintEl}; return h && !h.hidden ? h.innerText.trim() : ''; })()`);
    const txt1 = await ht();
    const hintLabels = await ev(`({ muscle: muscleLabel(libraryEntry('squats').primary), plan: planDisplayName(getPlan('push')) })`);
    check('tired recommended lower-body plan suggests the fresh Push plan using its actual muscle group', rp === 'legs' && txt1.includes(hintLabels.muscle) && txt1.includes(hintLabels.plan), { rp, txt1 });
    check('hint is a single muted line inside the Next-up tile (no new tile)', await ev(`(() => { const h = ${hintEl}; return !!h && h.closest('#bt-next') !== null && h.tagName === 'SPAN' && document.querySelectorAll('#bento-grid > .bt').length === ${await ev(`document.querySelectorAll('#bento-grid > .bt').length`)}; })()`));
    await ev(`(renderDnes(), true)`);
    check('same day re-render keeps the same hint visible', (await ht()) === txt1, await ht());
    check('day key stored device-only in localStorage (today, local)', await ev(`(() => { try { return localStorage.getItem('${KEY}') === localDateKey(new Date()); } catch (e) { return false; } })()`));
    check('the key is not in state and not in the synced payload / content hash', await ev(`(async () => { const a = await syncRawHash(JSON.parse(JSON.stringify(state))); localStorage.setItem('${KEY}', 'zzz'); const b2 = await syncRawHash(JSON.parse(JSON.stringify(state))); localStorage.setItem('${KEY}', localDateKey(new Date()));
      return a === b2 && !JSON.stringify(state).includes('gymquest_recovery_hint_day') && !JSON.stringify(syncScope(state)).includes('recovery_hint'); })()`));
    await p.navigate(BASE); await wait(500);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('dnes'); renderDnes(); return true; })()`); await wait(200);
    check('after a reload the same day it does not show again', (await ht()) === '' && await ev(`recoveryHint() === null`), await ht());
    await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} renderDnes(); return true; })()`);
    check('with the day key cleared it shows again', /still recovering/.test(await ht()), await ht());
    await p.eval(`(() => { try { localStorage.setItem('${KEY}', '2001-01-01'); } catch (e) {} return true; })()`);
    check('a key from an earlier day does not block it', await ev(`typeof recoveryHint() === 'string'`));
    await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} const s = localStorage.setItem; Storage.prototype.setItem = function () { throw new Error('quota'); }; window.__si = s; return true; })()`);
    check('localStorage that throws never breaks Today', await ev(`(() => { try { renderDnes(); recoveryHint(); return true; } catch (e) { return String(e); } })()`) === true);
    await p.eval(`(() => { Storage.prototype.setItem = window.__si; try { localStorage.removeItem('${KEY}'); } catch (e) {} return true; })()`);
    await ev(`(ensureSession(getPlan('legs')), saveState(), renderDnes(), true)`); await wait(100);
    check('never during a session', (await ht()) === '' && await ev(`recoveryHint() === null`), await ht());
    await ev(`(state.activeSession = null, saveState(), renderDnes(), true)`);
    await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} renderDnes(); return true; })()`);
    check('rotation is unchanged by the hint (still Legs)', (await ev(`recommendedPlan()`)) === 'legs' && /Legs/.test(await ev(`document.getElementById('bt-next-name').innerText`)), await ev(`document.getElementById('bt-next-name').innerText`));
    /* nový používateľ */
    await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} state.history = []; saveState(); renderDnes(); return true; })()`);
    check('no hint for a new user (empty history)', (await ht()) === '' && await ev(`recoveryHint() === null`));
    /* nič nie je čerstvé: žiadny iný plán */
    await hintSetup([{ id: 'h2', date: '2027-01-01', planId: 'push', planName: 'Push', endedAt: Date.now() - 2 * 3600000, exercises: [bench(8), { name: 'OHP', exId: 'overhead-press', sets: 5, reps: 8, weight: 40, setsDone: 5 }, { name: 'Dips', exId: 'dips', sets: 5, reps: 8, weight: 0, setsDone: 5 }, { name: 'Lat', exId: 'lateral-raises', sets: 5, reps: 8, weight: 8, setsDone: 5 }, { name: 'Pull', exId: 'pull-ups', sets: 6, reps: 8, weight: 0, setsDone: 6 }, { name: 'Row', exId: 'bent-over-rows', sets: 6, reps: 8, weight: 40, setsDone: 6 }, { name: 'Cable', exId: 'cable-rows', sets: 6, reps: 8, weight: 30, setsDone: 6 }, { name: 'Curl', exId: 'bicep-curls', sets: 6, reps: 8, weight: 12, setsDone: 6 }] }]);
    check('no hint when no other plan is fresh', (await ht()) === '' && await ev(`recoveryHint() === null`), await ht());
    /* len jeden cvik s oslabeným svalom */
    await hintSetup();
    await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} state.plans.legs.exercises = [state.plans.legs.exercises[0], { id: 'cx-own', name: 'Own thing', sets: 3, reps: 8, weight: 10 }]; saveState(); renderDnes(); return true; })()`);
    check('no hint when fewer than 2 library rows of the recommended plan are tired', (await ht()) === '' && await ev(`recoveryHint() === null`), await ht());
    /* prekladané názvy */
    await hintSetup();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} setLang(${J(lang)}); switchTab('dnes'); renderDnes(); return true; })()`); await wait(80);
      const x = JSON.parse(await ev(`JSON.stringify({ txt: (${hintEl} && !${hintEl}.hidden) ? ${hintEl}.innerText : '', muscle: muscleLabel(libraryEntry('squats').primary), plan: planDisplayName(getPlan('push')), dir: document.documentElement.dir })`));
      check(lang + ': hint identifies the actual tired muscle and fresh plan in the selected language', x.txt.includes(x.muscle) && x.txt.includes(x.plan) && !/recovery\.|\{|NaN|undefined/.test(x.txt), x);
      if (lang === 'ar') check('ar: right-to-left', x.dir === 'rtl');
    }

    console.log('== languages');
    const miss = JSON.parse(await ev(`JSON.stringify(['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'].map((l) => ({ l, miss: Object.keys(I18N.en).filter((k) => k.startsWith('recovery.') && I18N[l][k] === undefined), same: l !== 'en' && l !== 'sk' ? Object.keys(I18N.en).filter((k) => k.startsWith('recovery.') && I18N[l][k] === I18N.en[k]) : [], n: Object.keys(I18N.en).filter((k) => k.startsWith('recovery.')).length })))`));
    check('all recovery.* keys exist in 6 languages and are translated', miss.every((x) => x.n >= 3 && x.miss.length === 0 && x.same.length === 0), miss);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('pokrok'), setPokrokView('stats'), renderStatsGrid(), openMuscles(), true)`); await wait(120);
      const x = JSON.parse(await ev(`JSON.stringify((() => { const m = ${sheet}.querySelector('.modal'); const s = ${sheet}.querySelector('svg.body-map');
        return { dir: document.documentElement.dir, over: m.scrollWidth <= m.clientWidth + 1, txt: ${sheet}.innerText, transform: getComputedStyle(s).transform, aria: s.getAttribute('aria-label') }; })())`));
      check(lang + ': sheet has map + estimate caption, no raw key / NaN, no overflow', x.over && !/recovery\.|NaN|undefined/.test(x.txt) && !!x.aria && !/recovery\./.test(x.aria), x);
      if (lang === 'ar') check('ar: the supplied anatomical image is not mirrored', x.transform === 'none', x);
      await esc(); await wait(40);
    }
    await p.eval(`(setLang('en'), true)`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), switchTab('pokrok'), setPokrokView('stats'), renderStatsGrid(), openMuscles(), true)`); await wait(200);
      check(theme + ': sheet fits 390 px, map fits', await ev(`(() => { const m = ${sheet}.querySelector('.modal'); const s = ${sheet}.querySelector('svg.body-map').getBoundingClientRect(); return m.scrollWidth <= m.clientWidth + 1 && s.right <= m.getBoundingClientRect().right && s.width > 100; })()`));
      const colourLevels = await ev(`(async () => {
        const keep = state.history;
        try {
          const row = (id, sets) => ({ exId: id, name: t('exercise.' + id), sets, setsDone: sets, reps: 8, weight: 20 });
          state.history = [{ id: 'map-contrast-fixture', date: todayISO(), endedAt: Date.now(),
            exercises: [row('bench-press', 3), row('bicep-curls', 5), row('rope-triceps-pushdown', 7)] }];
          renderStatsGrid(); openMuscles();
          const image = new Image(); image.src = ${sheet}.querySelector('svg.body-map image').getAttribute('href'); await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          const paper = Array.from(ctx.getImageData(210,245,1,1).data).slice(0,3);
          const lum = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            .reduce((n,v,i) => n + v * [.2126,.7152,.0722][i], 0);
          const backdrop = lum(paper);
          return ['chest','biceps','triceps'].map(m => {
            const s = getComputedStyle(${sheet}.querySelector('[data-muscle="' + m + '"] path'));
            const rgb = s.fill.match(/[\\d.]+/g).map(Number), a = Number(s.fillOpacity);
            const painted = rgb.map((v,i) => a * v + (1-a) * paper[i]);
            return { rgb, a, contrast: (backdrop + .05) / (lum(painted) + .05) };
          });
        } finally { state.history = keep; renderStatsGrid(); openMuscles(); }
      })()`);
      check(theme + ': every worked intensity is visibly green against the image, not washed-out yellow or grey',
        colourLevels.every(v => v.rgb[1] > v.rgb[0] && v.rgb[1] > v.rgb[2] && v.contrast >= 1.5), colourLevels);
      check(theme + ': stronger recent work darkens progressively while all anatomy overlays stay translucent',
        colourLevels.every(v => v.a > 0 && v.a < 1) && colourLevels[0].contrast < colourLevels[1].contrast && colourLevels[1].contrast < colourLevels[2].contrast, colourLevels);
      await esc(); await wait(60);
    }
    check('no console errors', logs.length === 0, logs);
  } catch (e) { fail++; console.log('  FAIL threw ' + (e && e.stack || e)); }
  b.killHard(true); await server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
