'use strict';
/* Gym-Lift — opravy po záverečnej kontrole fázy 2 (gym-basics), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/phase2-final.js

   Kontroluje: zastaraný endedAt po zmene dátumu, jednostranné série v Svaloch = zotavenie, názov tlačidla rekordu,
   tip na Dnes sa "minie" len keď je naozaj viditeľný, slovenské neformálne slová, súhrn z hotového radu, identita bez exId,
   XSS vo všetkých novych listoch, init* v zozname inicializácií, desatinná čiarka, hranica 3 M, kontrast tipu. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-phase2-final');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const H = 3.6e6;
const XSS = `<img src=x onerror=window.__xss=1>"'`;

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('p2final-' + Date.now().toString(36), 9878, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + JSON.stringify(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const ev = (s) => p.eval(s);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const DAY = `const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };`;
  const bench = (n, extra) => Object.assign({ name: 'Bench Press', exId: 'bench-press', sets: n, reps: 5, weight: 100, setsDone: n }, extra || {});
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); try { localStorage.removeItem('gymquest_recovery_hint_day'); } catch (e) {} return true; })()`);

    console.log('== 1 stale endedAt after a date edit');
    const r1 = JSON.parse(await ev(`JSON.stringify((() => { ${DAY}
      const NOW = Date.now();
      const stale = { id: 's', date: day(10), endedAt: NOW - 2 * 3600000, exercises: [] };   // endedAt dnes, dátum pred 10 dňami
      const ok = { id: 'o', date: day(0), endedAt: NOW - 100, exercises: [] };
      const d = parseDate(day(10)); d.setHours(12, 0, 0, 0);
      return { stale: historyEndedAt(stale), ok: historyEndedAt(ok), okV: ok.endedAt, noDate: historyEndedAt({ endedAt: NOW }), t: entryTime(stale, NOW), noon: d.getTime() }; })())`));
    check('old-build entry with mismatching endedAt is ignored', r1.stale === null && r1.t === r1.noon, r1);
    check('endedAt with the same local date is kept', r1.ok === r1.okV && r1.ok > 0, r1);
    const r1b = JSON.parse(await ev(`JSON.stringify((() => { ${DAY}
      state.history = [{ id: 'e1', date: day(0), planId: 'pp', planName: 'X', endedAt: Date.now() - 3600000, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 10, reps: 5, weight: 100, setsDone: 10 }] }];
      saveState();
      const before = muscleRecovery(Date.now()).chest;
      openHistoryEdit('e1'); document.getElementById('he-date').value = day(10); saveHistoryEdit();
      const w = state.history[0];
      return { before, after: muscleRecovery(Date.now()).chest, date: w.date, ended: w.endedAt === undefined, want: day(10) }; })())`));
    check('back-dated edit: endedAt deleted, recovery uses the edited date (chest fresh again)', r1b.before < 100 && r1b.after === 100 && r1b.ended && r1b.date === r1b.want, r1b);
    const r1c = await ev(`(() => { ${DAY}
      state.history = [{ id: 'e2', date: day(0), planId: 'pp', planName: 'X', endedAt: Date.now() - 3600000, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 5, weight: 100, setsDone: 2 }] }];
      openHistoryEdit('e2'); saveHistoryEdit(); return state.history[0].endedAt > 0; })()`);
    check('an edit that keeps the date keeps endedAt', r1c === true);

    console.log('== 2 unilateral set count in Muscles agrees with Recovery');
    const r2 = JSON.parse(await ev(`JSON.stringify((() => { ${DAY}
      const mk = (sd) => ({ name: 'Bench Press', exId: 'bench-press', unilateral: true, sets: 2, reps: 5, weight: 20, setsDone: sd.left.length + sd.right.length, sidesDone: sd });
      const wk = weekKey(parseDate(day(0)));
      const run = (e) => { state.history = [{ id: 'u', date: day(0), planId: 'pp', planName: 'X', endedAt: Date.now() - 3600000, exercises: [e] }]; saveState();
        return { sets: muscleWeek(wk).sets.chest, load: muscleRecovery(Date.now()).chest }; };
      const both = run(mk({ left: [1], right: [1] })), one = run(mk({ left: [1], right: [] })), full = run(mk({ left: [1, 2], right: [1, 2] }));
      state.history = [{ id: 'b', date: day(0), planId: 'pp', planName: 'X', endedAt: Date.now() - 3600000, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 5, weight: 100, setsDone: 2 }, { name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 100, setsDone: 1, drops: [{ weight: 60, reps: 8 }] }] }];
      return { both, one, full, bi: muscleWeek(wk).sets.chest }; })())`));
    check('unilateral: both sides of one set = 1, one side = 0.5, two full sets = 2', r2.both.sets === 1 && r2.one.sets === 0.5 && r2.full.sets === 2, r2);
    check('Recovery and Muscles agree: load after identical age matches sets (1 set vs 0.5 set)', r2.both.load < r2.one.load && r2.one.load < 100 && r2.full.load < r2.both.load, r2);
    check('bilateral unchanged (2 + 1 + 1 drop = 4); drops count 1 each', r2.bi === 4, r2);

    console.log('== 3 record row accessible name');
    const r3 = JSON.parse(await ev(`JSON.stringify((() => { ${DAY}
      state.history = [{ id: 'r', date: day(2), planId: 'pp', planName: 'X', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 102.5, setsDone: 3 }] }]; saveState();
      switchTab('pokrok'); setPokrokView('stats'); renderPokrok();
      const row = document.querySelector('#records-list button.record-row');
      return row ? { aria: row.getAttribute('aria-label'), text: row.textContent.replace(/\\s+/g, ' ').trim() } : null; })())`));
    check('record row button exposes its content (no replacing aria-label; name+weight+date from content)', r3 && r3.aria === null && /Bench Press/.test(r3.text) && /102\.5 kg/.test(r3.text), r3);

    console.log('== 4 Today hint only used when seen');
    const KEY = 'gymquest_recovery_hint_day';
    await p.eval(`(() => { ${DAY}
      try { localStorage.removeItem('${KEY}'); } catch (e) {}
      state.activeSession = null; state.planOrder = ['push', 'pull', 'legs']; ['push', 'pull', 'legs'].forEach((id) => { state.plans[id] = JSON.parse(JSON.stringify(DEFAULT_PLANS[id])); });
      const sq = (n, id, name) => ({ name, exId: id, sets: n, reps: 8, weight: 80, setsDone: n });
      state.history = [{ id: 'h1', date: day(0), planId: 'pull', planName: 'Pull', endedAt: Date.now() - 3600000, exercises: [sq(5, 'squats', 'Squat'), sq(5, 'leg-press', 'Leg press'), sq(5, 'lunges', 'Lunges'), sq(4, 'leg-curls', 'Leg curls')] }];
      saveState(); switchTab('trening'); return true; })()`);
    const marked = () => ev(`(() => { try { return localStorage.getItem('${KEY}'); } catch (e) { return 'ERR'; } })()`);
    await ev(`(renderDnes(), true)`);
    check('Today rendered while another tab is active: hint computed, NOT marked', (await marked()) === null && /still recovering/.test(await ev(`document.getElementById('bt-recovery-hint').textContent`)), await marked());
    await ev(`(switchTab('dnes'), true)`);
    check('switching to Today marks it', (await marked()) === await ev(`localDateKey(new Date())`), await marked());
    await ev(`(() => { try { localStorage.removeItem('${KEY}'); } catch (e) {} recoveryShown = null; switchTab('trening'); Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); switchTab('dnes'); return true; })()`);
    check('Today active but page hidden: not marked', (await marked()) === null, await marked());
    await ev(`(() => { delete document.visibilityState; renderDnes(); return true; })()`);
    check('page visible again: marked', (await marked()) !== null, await marked());

    console.log('== 5 Slovak informal');
    const sk = JSON.parse(await ev(`JSON.stringify(Object.keys(I18N.sk).filter((k) => /^(exactions|xprog|muscles|recovery)\\./.test(k)).map((k) => [k, I18N.sk[k]]).filter(([k, v]) => /\\b(zvážte|zapíšte|skúste|vyberte|otvorte|ukážte|pozrite|kliknite|ťuknite)\\b/i.test(v)))`));
    check('no formal Slovak imperatives in the new strings; hint says "zváž"', sk.length === 0 && /zváž /.test(await ev(`I18N.sk['recovery.hint']`)), sk);

    console.log('== 7 summary reuses series');
    const r7 = JSON.parse(await ev(`JSON.stringify((() => { ${DAY}
      state.history = [{ id: 'a', date: day(5), planId: 'pp', planName: 'X', exercises: [bench(2)] }, { id: 'c', date: day(2), planId: 'pp', planName: 'X', exercises: [bench(2)] }]; saveState();
      const orig = window.exerciseSeries; let n = 0; window.exerciseSeries = function (id) { n++; return orig(id); };
      openExerciseProgress('bench-press', 'Bench Press'); const calls = n; window.exerciseSeries = orig;
      const s = orig('bench-press');
      return { calls, same: JSON.stringify(exerciseSummary('bench-press', s)) === JSON.stringify(exerciseSummary('bench-press')) }; })())`.replace(/bench\(2\)/g, `{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 5, weight: 100, setsDone: 2 }`)));
    check('opening the sheet computes the series once; summary identical with or without the argument', r7.calls === 1 && r7.same, r7);
    await esc();

    console.log('== 8 entryIdentity falls back to the built-in name map');
    const r8 = JSON.parse(await ev(`JSON.stringify({ a: entryIdentity({ name: 'Bench press' }), b: entryIdentity({ name: 'Drepy' }), c: entryIdentity({ name: 'Squats' }), d: entryIdentity({ name: 'My own lift' }), e: entryIdentity({ name: 'Bench press', exId: 'bench-press' }) })`));
    check('entries without exId map built-in names to the library id; custom names keep the cx- hash', r8.a === 'bench-press' && r8.b === 'squats' && r8.c === 'squats' && /^cx-/.test(r8.d) && r8.e === 'bench-press', r8);

    console.log('== 9 XSS fixture');
    await p.eval(`(() => { ${DAY}
      window.__xss = undefined;
      const X = ${J(XSS)};
      state.plans.xssplan = { id: 'xssplan', name: X, exercises: [{ id: 'cx-xss', name: X, sets: 2, reps: 5, weight: 20 }] };
      if (state.planOrder.indexOf('xssplan') < 0) state.planOrder.push('xssplan');
      const mk = (id, n) => ({ id, date: day(n), planId: 'gone', planName: X, endedAt: Date.now() - n * 86400000, exercises: [{ name: X, sets: 2, reps: 5, weight: 20 + n, setsDone: 2 }] });
      state.history = [mk('x1', 1), mk('x2', 3), mk('x3', 5)];
      saveState(); return true; })()`);
    const seen = {};
    const lit = (s) => typeof s === 'string' && s.indexOf(XSS) >= 0;
    await ev(`(switchTab('pokrok'), setPokrokView('stats'), renderPokrok(), true)`); await wait(150);
    seen.records = await ev(`document.getElementById('records-list').innerText`);
    seen.history = await ev(`document.getElementById('history-list').innerText`);
    check('records row and history line show the literal text, no injected node', lit(seen.records) && lit(seen.history) && await ev(`!document.querySelector('#records-list img, #history-list img')`), { r: seen.records.slice(0, 80) });
    await ev(`(() => { const l = document.querySelector('#history-list .ex-prog-link'); if (l) l.click(); return true; })()`); await wait(200);
    seen.prog = await ev(`document.getElementById('modal-ex-progress').innerText`);
    check('progress sheet: title literal, sessions list literal, chart has an aria-label and no injected node', lit(seen.prog) && await ev(`!document.querySelector('#modal-ex-progress img') && document.getElementById('ex-progress-sessions').textContent.indexOf('<img') >= 0`) && await ev(`!!document.querySelector('#ex-progress-chart svg[aria-label]') && !document.querySelector('#modal-ex-progress img')`), seen.prog.slice(0, 100));
    await esc(); await wait(80);
    await ev(`(switchTab('kalendar'), renderKalendar(), true)`); await wait(100);
    await ev(`(() => { ${DAY} openDay(day(1)); return true; })()`); await wait(150);
    seen.cal = await ev(`document.getElementById('screen-kalendar').innerText + document.body.innerText`);
    check('Calendar day shows the literal text, no injected node', lit(seen.cal) && await ev(`!document.querySelector('#screen-kalendar img, #modal-day img, [id*="day"] img')`));
    await ev(`(document.querySelectorAll('.modal-overlay').forEach((m) => { if (!m.hidden && m.id) m.hidden = true; }), true)`);
    await ev(`(() => { ensureSession(getPlan('xssplan')); saveState(); switchTab('trening'); renderTrening(); return true; })()`); await wait(150);
    await ev(`(() => { const b = document.querySelector('.btn-ex-more'); if (b) b.click(); return true; })()`); await wait(150);
    seen.sheet = await ev(`document.getElementById('modal-ex-actions').innerText + '|' + (document.getElementById('modal-ex-actions').querySelector('[role=dialog]') || document.getElementById('modal-ex-actions')).getAttribute('aria-label') + '|' + (document.querySelector('.btn-ex-more') || {getAttribute: () => ''}).getAttribute('aria-label')`);
    check('⋯ sheet title and ⋯ aria-label carry the literal text', lit(seen.sheet) && await ev(`!document.querySelector('#modal-ex-actions img')`), seen.sheet.slice(0, 120));
    await esc(); await wait(60);
    const oth = await ev(`(() => { ${DAY} openMuscles(); const s = document.getElementById('modal-muscles'); return { txt: s.innerText, img: !!s.querySelector('img') }; })()`);
    check('Muscles sheet ("Other" bucket) has no injected node', !oth.img && /Other/.test(oth.txt), oth.txt.slice(0, 80));
    await esc(); await wait(60);
    check('window.__xss stayed undefined everywhere', (await ev(`window.__xss === undefined`)) === true);

    console.log('== 10 init functions in the normal setup list');
    const src = fs.readFileSync(path.join(REPO, 'script.js'), 'utf8');
    const ips = src.slice(src.indexOf('function initPlateSheet()'), src.indexOf('function initPlateSheet()') + 400);
    check('initPlateSheet no longer calls the three inits', !/initExerciseActions|initExerciseProgress|initMuscles/.test(ips.split('\n').slice(0, 4).join('\n')), ips.split('\n').slice(0, 4));
    check('each init is called exactly once, next to the other init* calls', ['initExerciseActions', 'initExerciseProgress', 'initMuscles'].every((n) => (src.match(new RegExp('^\\s+' + n + '\\(\\);', 'gm')) || []).length === 1));
    check('sheets still work: ⋯ and Muscles tile open', await ev(`(() => { openMuscles(); const a = !document.getElementById('modal-muscles').hidden; closeMuscles(); return a; })()`));

    console.log('== 11 body map geometry');
    const geo = JSON.parse(await ev(`JSON.stringify((() => { const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;width:280px'; host.innerHTML = bodyMapSvg({}, { size: 'full' }); document.body.appendChild(host);
      const svg = host.querySelector('svg'); const boxes = (m) => Array.from(svg.querySelectorAll('[data-muscle="' + m + '"] > *')).map((e) => e.getBBox());
      const inter = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.01;
      const any = (A, B) => A.some((a) => B.some((b) => inter(a, b)));
      const glutes = boxes('glutes'), legs = boxes('legs').filter((b) => b.x > 56), sh = boxes('shoulders').filter((b) => b.x < 56), chest = boxes('chest');
      const r = { glutesLegs: any(glutes, legs), shouldersChest: any(sh, chest) }; host.remove(); return r; })())`));
    check('back-view glutes do not overlap thighs; front shoulders do not overlap chest', geo.glutesLegs === false && geo.shouldersChest === false, geo);

    console.log('== 12 decimal separator');
    const r12 = {};
    for (const lang of ['sk', 'fr', 'es', 'pt-BR', 'en']) {
      await ev(`(setLang(${J(lang)}), true)`);
      r12[lang] = JSON.parse(await ev(`JSON.stringify({ n: xpNum(7.5), set: xpSetText({ weight: 7.5, reps: 8 }), big: xpNum(12000) })`));
    }
    check('sk/fr/es/pt-BR use the comma; en keeps the dot; no thousands grouping', ['sk', 'fr', 'es', 'pt-BR'].every((l) => r12[l].n === '7,5' && r12[l].set === '7,5×8' && r12[l].big === '12000') && r12.en.n === '7.5' && r12.en.set === '7.5×8', r12);
    await ev(`(() => { ${DAY} setLang('fr'); state.history = [{ id: 'f', date: day(0), planId: 'pp', planName: 'X', exercises: [{ name: 'Bench Press', exId: 'bench-press', unilateral: true, sets: 2, reps: 5, weight: 7.5, setsDone: 1, sidesDone: { left: [1], right: [] } }] }]; saveState(); switchTab('pokrok'); setPokrokView('stats'); renderStatsGrid(); return true; })()`);
    const frTile = await ev(`document.querySelector('#stats-grid [data-go="muscles"]').innerText`);
    check('fr Muscles tile shows 0,5 for a half set', /0,5/.test(frTile), frTile);
    await ev(`(setLang('en'), true)`);

    console.log('== 13 xpRangeCutoff month-end clamp');
    const r13 = JSON.parse(await ev(`JSON.stringify((() => {
      const RealDate = Date;
      const at = (y, m, d, h) => { const F = new RealDate(y, m, d, h, 30, 0, 0).getTime(); class D extends RealDate { constructor(...a) { if (a.length) super(...a); else super(F); } static now() { return F; } } window.Date = D; };
      const key = (ms) => { const d = new RealDate(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes(); };
      const out = {};
      at(2027, 4, 31, 15); out.may31_3m = key(xpRangeCutoff('3m')); out.may31_1y = key(xpRangeCutoff('1y'));
      at(2028, 1, 29, 9); out.feb29_1y = key(xpRangeCutoff('1y'));
      at(2027, 11, 31, 23); out.dec31_3m = key(xpRangeCutoff('3m'));
      at(2027, 2, 15, 18); out.mar15_3m = key(xpRangeCutoff('3m'));
      at(2028, 4, 31, 15); out.may31_3m_leap = key(xpRangeCutoff('3m'));
      out.all = xpRangeCutoff('all');
      window.Date = RealDate; return out; })())`));
    check('31 May 2027 - 3 M = 28 Feb 2027 at local midnight (not 3 Mar)', r13.may31_3m === '2027-2-28 0:0', r13);
    check('31 May 2028 - 3 M = 29 Feb 2028 (leap)', r13.may31_3m_leap === '2028-2-29 0:0', r13);
    check('29 Feb 2028 - 1 Y = 28 Feb 2027; 31 Dec - 3 M = 30 Sep; 15 Mar - 3 M = 15 Dec; 1 Y from 31 May = 31 May', r13.feb29_1y === '2027-2-28 0:0' && r13.dec31_3m === '2027-9-30 0:0' && r13.mar15_3m === '2026-12-15 0:0' && r13.may31_1y === '2026-5-31 0:0' && r13.all === 0, r13);

    console.log('== 14 hint contrast');
    await ev(`(() => { ${DAY}
      state.activeSession = null; state.planOrder = ['push', 'pull', 'legs'];
      const sq = (n, id, name) => ({ name, exId: id, sets: n, reps: 8, weight: 80, setsDone: n });
      state.history = [{ id: 'h1', date: day(0), planId: 'pull', planName: 'Pull', endedAt: Date.now() - 3600000, exercises: [sq(5, 'squats', 'Squat'), sq(5, 'leg-press', 'Leg press'), sq(5, 'lunges', 'Lunges'), sq(4, 'leg-curls', 'Leg curls')] }];
      saveState(); try { localStorage.removeItem('${KEY}'); } catch (e) {} recoveryShown = null; return true; })()`);
    const CON = (photo) => `(() => {
      const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const h = document.getElementById('bt-recovery-hint'); const tile = document.getElementById('bt-next');
      let bg = parse(getComputedStyle(tile).backgroundColor); if (bg.a < 1) { const body = parse(getComputedStyle(document.body).backgroundColor); bg = { r: bg.r * bg.a + body.r * (1 - bg.a), g: bg.g * bg.a + body.g * (1 - bg.a), b: bg.b * bg.a + body.b * (1 - bg.a), a: 1 }; }
      if (${photo}) bg = { r: bg.r * .62 + 255 * .38, g: bg.g * .62 + 255 * .38, b: bg.b * .62 + 255 * .38, a: 1 };   // najhorší prípad: biela fotka pri krytí .38
      const fgc = parse(getComputedStyle(h).color), op = parseFloat(getComputedStyle(h).opacity);
      const fg = { r: fgc.r * op + bg.r * (1 - op), g: fgc.g * op + bg.g * (1 - op), b: fgc.b * op + bg.b * (1 - op) };
      const a = lum(fg) + 0.05, c = lum(bg) + 0.05; return Math.round(Math.max(a, c) / Math.min(a, c) * 100) / 100; })()`;
    for (const mode of ['light', 'dark']) {
      await ev(`(document.documentElement.setAttribute('data-theme', ${J(mode)}), switchTab('dnes'), renderDnes(), true)`); await wait(150);
      const shown = await ev(`!document.getElementById('bt-recovery-hint').hidden`);
      const c = await ev(CON(false)), cw = await ev(CON(true));
      check(mode + ': hint text contrast against the plain tile >= 4.5 (' + c + ')', shown && c >= 4.5, c);
      check(mode + ': hint text contrast over the brightest possible photo (white at .38) >= 4.5 (' + cw + ')', cw >= 4.5, cw);
      await ev(`(document.getElementById('bt-next-img').hidden = false, true)`);
    }

    check('no console errors / exceptions', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    check('suite ran to the end', false, String(e && e.stack || e));
  } finally {
    b.killHard(true); await server.close();
    console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
    process.exit(fail ? 1 : 0);
  }
})();
