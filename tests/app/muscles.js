'use strict';
/* Gym-Lift — série a objem podľa svalovej skupiny (gym-basics fáza 2, úloha 4), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/muscles.js

   Kontroluje: muscleShare (hlavný sval 1, pomocné 0.5, vlastný/neznámy cvik = other), muscleWeek (pracovné série + drop série,
   objem = váha × opakovania × podiel, asistované len série, rozcvičky nikdy), muscleTrend (8 týždňov, najstarší prvý),
   hranicu týždňa cez weekKey (nedeľa 23:00 patrí do rovnakého týždňa ako v dlaždici Týždeň), presne jednu novú dlaždicu v Stats,
   list Svaly (navigácia ‹ ›, bez budúcich týždňov, štandard listu: dialóg, Esc, fokus, isBusy, späť), prázdny stav bez NaN,
   6 jazykov + RTL, svetlý/tmavý režim na 390 px, žiadne chyby v konzole. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-muscles');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('muscles-' + Date.now().toString(36), 9876, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + JSON.stringify(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const sheet = `document.getElementById('modal-muscles')`;
  const ev = (s) => p.eval(s);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const hidden = () => p.eval(`${sheet}.hidden`);
  const text = () => p.eval(`${sheet}.innerText`);
  const DAY = `const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };`;
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== empty user');
    await p.eval(`(state.history = [], saveState(), switchTab('pokrok'), setPokrokView('stats'), renderStatsGrid(), true)`);
    await wait(200);
    const cnt0 = await ev(`document.querySelectorAll('#stats-grid .bt').length`);
    check('empty: tile says "No sets this week"', /No sets this week/.test(await ev(`document.querySelector('#stats-grid [data-go="muscles"]').innerText`)), await ev(`(document.querySelector('#stats-grid [data-go="muscles"]') || document.body).innerText`));
    check('empty: no NaN anywhere on Stats', !/NaN|undefined/.test(await ev(`document.getElementById('stats-grid').innerText`)));
    await p.eval(`(openMuscles(), true)`); await wait(150);
    check('empty: sheet opens with the empty text, no NaN/undefined/raw key', !(await hidden()) && /No sets this week/.test(await text()) && !/NaN|undefined|muscles\./.test(await text()), await text());
    check('empty: total volume 0 kg', /0 kg/.test(await text()), await text());
    await esc(); await wait(60);

    console.log('== data helpers');
    await p.eval(`(() => { ${DAY}
      state.history = [
        { id: 'a1', date: day(0), planId: 'pp', planName: 'Push', exercises: [
          { name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 100, setsDone: 3, warmups: [{ weight: 40, reps: 10 }, { weight: 60, reps: 5 }] },
          { name: 'Zottman curl', sets: 2, reps: 10, weight: 12, setsDone: 2 }] },
        { id: 'a2', date: day(0), planId: 'pp', planName: 'Pull', exercises: [
          { name: 'Assisted Pull-ups', exId: 'assisted-pull-ups', sets: 2, reps: 8, weight: 30, setsDone: 2, assisted: true }] },
        { id: 'a3', date: day(0), planId: 'pp', planName: 'Drops', exercises: [
          { name: 'Lateral Raises', exId: 'lateral-raises', sets: 1, reps: 10, weight: 10, setsDone: 1, drops: [{ weight: 6, reps: 12 }] }] },
        { id: 'p1', date: day(7), planId: 'pp', planName: 'Legs', exercises: [
          { name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 120, setsDone: 4 }] }];
      saveState(); return true; })()`);
    const share = await ev(`JSON.stringify({ bench: muscleShare({ name: 'Bench Press', exId: 'bench-press' }), custom: muscleShare({ name: 'Zottman curl' }), junk: muscleShare(null), keys: MUSCLE_KEYS })`);
    const sh = JSON.parse(share);
    check('muscleShare bench: chest 1, arms 0.5, shoulders 0.5', (sh.bench.chest === 1 && sh.bench.arms === 0.5 && sh.bench.shoulders === 0.5 && Object.keys(sh.bench).length === 3), sh.bench);
    check('muscleShare custom / junk -> { other: 1 }', J(sh.custom) === '{"other":1}' && J(sh.junk) === '{"other":1}', sh);
    check('MUSCLE_KEYS = MUSCLE_CODES + other', J(sh.keys) === J(['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core', 'other']), sh.keys);
    const wk = JSON.parse(await ev(`JSON.stringify(muscleWeek(currentWeekKey()))`));
    check('this week: chest 3 (bench) , other 2 (custom curl)', near(wk.sets.chest, 3) && near(wk.sets.other, 2), wk.sets);
    check('this week: arms 2.5 (bench helper 1.5 + assisted pull-ups helper 1)', near(wk.sets.arms, 2.5), wk.sets);
    /* shoulders: bench 3×0.5 = 1.5; lateral raises (primary shoulders): 1 set + 1 drop = 2 */
    check('shoulders = 1.5 (bench helper) + 2 (lateral raise + its drop) = 3.5', near(wk.sets.shoulders, 3.5), wk.sets);
    check('assisted pull-ups add 2 sets to back (library primary), warm-ups never counted', near(wk.sets.back, 2) && near(wk.sets.chest, 3), wk.sets);
    /* objem: bench 3×5×100 = 1500 → chest 1500, arms 750, shoulders 750; curl other 240; raises 10×10 + 6×12 = 172 → shoulders +172 */
    check('volume: chest 1500, arms 750 (+0 curl is other), other 240', near(wk.volume.chest, 1500) && near(wk.volume.arms, 750) && near(wk.volume.other, 240), wk.volume);
    check('volume: shoulders = 750 + 172 (drop counted)', near(wk.volume.shoulders, 922), wk.volume);
    check('assisted: back volume 0 (sets only)', !wk.volume.back, wk.volume);
    check('total volume of the week = 1500 + 240 + 172', near(wk.totalVolume, 1912), wk.totalVolume);
    check('no NaN in the week data', !/NaN|null/.test(J(wk)), wk);
    const prevKey = await ev(`weekKey(addDays(new Date(), -7))`);
    const pw = JSON.parse(await ev(`JSON.stringify(muscleWeek(${J(prevKey)}))`));
    check('previous week: only the squat day (legs 4)', near(pw.sets.legs, 4) && !pw.sets.chest, pw.sets);
    const tr = JSON.parse(await ev(`JSON.stringify(muscleTrend())`));
    check('muscleTrend: 8 weeks, oldest first, ends with the current week', tr.length === 8, tr.map((x) => x.week));
    const curKey = await ev(`currentWeekKey()`);
    check('trend last = current week, previous = last week; sets match', tr[7].week === curKey && tr[6].week === prevKey && near(tr[7].sets.chest, 3) && near(tr[6].sets.legs, 4), tr.slice(6));
    check('trend weeks are ascending', tr.every((x, i) => i === 0 || tr[i - 1].week < x.week), tr.map((x) => x.week));

    console.log('== week boundary = weekKey (Sunday 23:00 workout)');
    const bd = (await ev(`(() => { ${DAY}
      const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); const lastSun = new Date(mon); lastSun.setDate(mon.getDate() - 1);
      state.history = [{ id: 'b1', date: fmt(sun), planId: 'pp', planName: 'Sun', endedAt: new Date(sun.getFullYear(), sun.getMonth(), sun.getDate(), 23, 0).getTime(), exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 5, weight: 50, setsDone: 2 }] },
        { id: 'b2', date: fmt(lastSun), planId: 'pp', planName: 'LastSun', exercises: [{ name: 'Squat', exId: 'squats', sets: 3, reps: 5, weight: 50, setsDone: 3 }] }];
      saveState(); renderStatsGrid();
      const cur = muscleWeek(currentWeekKey()), prev = muscleWeek(weekKey(addDays(new Date(), -7)));
      const weekTile = document.querySelector('#stats-grid .bt-lime .bt-v').firstChild.textContent;
      return { chestCur: cur.sets.chest || 0, legsCur: cur.sets.legs || 0, legsPrev: prev.sets.legs || 0, weekTile, sunKey: weekKey(parseDate(fmt(sun))), cur: currentWeekKey() }; })()`));
    check('Sunday workout is in the current week (as the Week tile counts it: 1 workout)', bd.chestCur === 2 && bd.sunKey === bd.cur && String(bd.weekTile).trim() === '1', bd);
    check('last week\'s Sunday belongs to the previous week only', bd.legsCur === 0 && bd.legsPrev === 3, bd);

    console.log('== Stats tile');
    await p.eval(`(() => { ${DAY}
      const mon = (n) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      state.history = [
        { id: 'a1', date: day(0), planId: 'pp', planName: 'Push', exercises: [
          { name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 100, setsDone: 3 },
          { name: 'Zottman curl', sets: 2, reps: 10, weight: 12, setsDone: 2 }] },
        { id: 'p1', date: mon(7), planId: 'pp', planName: 'Legs', exercises: [{ name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 120, setsDone: 4 }] },
        { id: 'p2', date: mon(14), planId: 'pp', planName: 'Legs', exercises: [{ name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 120, setsDone: 4 }] },
        { id: 'p3', date: mon(13), planId: 'pp', planName: 'Legs', exercises: [{ name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 120, setsDone: 4 }] }];
      saveState(); switchTab('pokrok'); setPokrokView('stats'); renderStatsGrid(); return true; })()`);
    await wait(150);
    const tileTxt = (await ev(`document.querySelector('#stats-grid [data-go="muscles"]').innerText.replace(/\\s+/g, ' ').trim()`));
    check('tile reads "Chest · 3 sets"', /Chest · 3 sets/.test(tileTxt), tileTxt);
    const total = await ev(`document.querySelectorAll('#stats-grid .bt').length`);
    const recent = await ev(`document.querySelectorAll('#stats-grid [data-day]').length`);
    check('exactly one new tile vs f9590a9 (12 fixed tiles + recent days + 1 = ' + (12 + recent + 1) + ')', total === 12 + recent + 1 && (await ev(`document.querySelectorAll('#stats-grid [data-go="muscles"]').length`)) === 1, { total, recent, empty: cnt0 });
    check('tile is neutral: no colour class (bt-lime/lav/peach/sky/dark)', await ev(`!/bt-(lime|lav|peach|sky|dark)/.test(document.querySelector('#stats-grid [data-go="muscles"]').className)`));
    check('tile sits after the Records / Achievements tiles', await ev(`(() => { const l = [...document.querySelectorAll('#stats-grid .bt')]; const i = l.findIndex((x) => x.dataset.go === 'muscles'); return l[i - 1].dataset.go === 'motivation'; })()`));

    console.log('== sheet: open, navigate, standard');
    await p.eval(`(() => { const t = document.querySelector('#stats-grid [data-go="muscles"]'); t.focus(); t.click(); return true; })()`); await wait(200);
    check('tap on the tile opens #modal-muscles', !(await hidden()));
    check('labelled modal dialog', await ev(`(() => { const d = ${sheet}.querySelector('.modal'); const l = d.getAttribute('aria-labelledby'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(l) && document.getElementById(l).textContent.trim().length > 0; })()`));
    check('focus moved into the sheet', await ev(`${sheet}.contains(document.activeElement)`));
    check('isBusy() is true while open', await ev(`isBusy()`));
    const rows = await ev(`Array.from(${sheet}.querySelectorAll('.mu-row')).map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
    check('rows sorted by sets: Chest 3, Other 2, then Shoulders / Arms 1.5', rows.length === 4 && /^Chest/.test(rows[0]) && /^Other/.test(rows[1]), rows);
    check('zero muscles are hidden (no Back, Legs, Glutes, Core)', !rows.some((r) => /Back|Legs|Glutes|Core/.test(r)), rows);
    check('one decimal where needed: Arms 1.5', rows.some((r) => /Arms 1\.5/.test(r)), rows);
    check('each row has a sparkline (8 weeks, 1 polyline) and a bar', await ev(`Array.from(${sheet}.querySelectorAll('.mu-row')).every((r) => r.querySelectorAll('svg.xp-compact polyline').length === 1 && !!r.querySelector('.mu-bar'))`));
    check('week label "This week"; next is disabled; no future weeks', /This week/.test(await ev(`document.getElementById('muscles-week').textContent`)) && await ev(`document.getElementById('btn-muscles-next').disabled`));
    check('total volume shown in kg: 1500 + 240 = 1740 kg', /1740 kg/.test(await text()), await text());
    check('note: counting rule and 10–20 guidance, no target/colour', /1 set/.test(await text()) && /10–20 sets/.test(await text()), await text());
    await p.eval(`(document.getElementById('btn-muscles-prev').click(), true)`); await wait(100);
    const rows1 = await ev(`Array.from(${sheet}.querySelectorAll('.mu-row')).map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
    check('‹ shows last week: Legs 4 first, then its helpers Glutes 2, Core 2', rows1.length === 3 && /^Glutes 2/.test(rows1[1]) && /^Legs 4/.test(rows1[0]) && /Last week/.test(await ev(`document.getElementById('muscles-week').textContent`)), rows1);
    check('next is enabled after ‹', await ev(`!document.getElementById('btn-muscles-next').disabled`));
    await p.eval(`(document.getElementById('btn-muscles-prev').click(), true)`); await wait(100);
    check('2 weeks ago: Legs 8 (two squat days), label "Week of ..."', /Legs\s+8/.test(await text()) && /Week of/.test(await ev(`document.getElementById('muscles-week').textContent`)), await text());
    await p.eval(`(() => { for (let i = 0; i < 30; i++) { const bt = document.getElementById('btn-muscles-prev'); if (bt.disabled) break; bt.click(); } return true; })()`); await wait(100);
    check('‹ stops at the oldest week of the history (disabled)', await ev(`document.getElementById('btn-muscles-prev').disabled`));
    check('focus is not lost when a button becomes disabled (stays inside the sheet)', await ev(`${sheet}.contains(document.activeElement) && document.activeElement !== document.body`));
    await p.eval(`(() => { for (let i = 0; i < 30; i++) { const bt = document.getElementById('btn-muscles-next'); if (bt.disabled) break; bt.click(); } return true; })()`); await wait(100);
    check('› returns to this week and stops there', /This week/.test(await ev(`document.getElementById('muscles-week').textContent`)) && await ev(`document.getElementById('btn-muscles-next').disabled && ${sheet}.contains(document.activeElement)`));
    check('buttons are >= 44 px', await ev(`['btn-muscles-prev', 'btn-muscles-next', 'btn-muscles-close'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width >= 43.5 && r.height >= 43.5; })`));
    check('no colour judgement: bars use one accent colour only', await ev(`new Set(Array.from(${sheet}.querySelectorAll('.mu-bar > i')).map((i) => getComputedStyle(i).backgroundColor)).size === 1`));
    check('no NaN / undefined anywhere in the sheet', !/NaN|undefined|\[object/.test(await text()));
    await esc(); await wait(100);
    check('Escape closes, focus returns to the Muscles tile', (await hidden()) && await ev(`document.activeElement.dataset.go === 'muscles'`));
    await p.eval(`(document.querySelector('#stats-grid [data-go="muscles"]').click(), true)`); await wait(100);
    check('reopens on This week (state reset)', /This week/.test(await ev(`document.getElementById('muscles-week').textContent`)));
    await p.eval(`(document.getElementById('btn-muscles-close').click(), true)`); await wait(60);
    check('close button closes; isBusy() false again', (await hidden()) && !(await ev(`isBusy()`)));
    check('listed in NATIVE_BACK_CLOSE', await ev(`NATIVE_BACK_CLOSE.some((e) => e[0] === 'modal-muscles' && !!document.querySelector(e[1]))`));
    await p.eval(`(openMuscles(), true)`); await wait(60);
    await p.eval(`(history.back && 0, document.querySelector(NATIVE_BACK_CLOSE.find((e) => e[0] === 'modal-muscles')[1]).click(), true)`); await wait(60);
    check('native back selector closes the sheet', await hidden());
    check('bentoGo("muscles") opens the sheet', await ev(`(bentoGo('muscles'), !${sheet}.hidden)`));
    await esc(); await wait(60);

    console.log('== 1000 entries are fast');
    const t = await ev(`(() => { ${DAY}
      const bak = state.history; state.history = [];
      for (let i = 0; i < 1000; i++) state.history.push({ id: 'k' + i, date: day(i % 400), planId: 'pp', planName: 'X', exercises: [
        { name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 80, setsDone: 3 }, { name: 'Squat', exId: 'squats', sets: 3, reps: 5, weight: 100, setsDone: 3 }, { name: 'Zottman', sets: 2, reps: 8, weight: 10, setsDone: 2 }] });
      const t0 = performance.now(); renderStatsGrid(); openMuscles(); const t1 = performance.now(); closeMuscles(); state.history = bak; return t1 - t0; })()`);
    check('Stats render + open sheet with 1000 entries < 300 ms (' + Math.round(t) + ' ms)', t < 300, t);

    console.log('== languages / RTL / themes at 390 px');
    await p.eval(`(() => { ${DAY}
      state.history = [
        { id: 'a1', date: day(0), planId: 'pp', planName: 'Push', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 100, setsDone: 3 }, { name: 'Zottman curl', sets: 2, reps: 10, weight: 12, setsDone: 2 }, { name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 120, setsDone: 4 }] },
        { id: 'p1', date: day(7), planId: 'pp', planName: 'Pull', exercises: [{ name: 'Bent Over Rows', exId: 'bent-over-rows', sets: 4, reps: 8, weight: 60, setsDone: 4 }] },
        { id: 'p2', date: day(14), planId: 'pp', planName: 'Pull', exercises: [{ name: 'Bent Over Rows', exId: 'bent-over-rows', sets: 3, reps: 8, weight: 60, setsDone: 3 }] }];
      saveState(); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('pokrok'), setPokrokView('stats'), renderStatsGrid(), openMuscles(), true)`); await wait(150);
      const x = await ev(`(() => { const m = ${sheet}.querySelector('.modal'); const tile = document.querySelector('#stats-grid [data-go="muscles"]').innerText;
        return { dir: document.documentElement.dir, raw: ${sheet}.innerText + ' ' + tile, over: m.scrollWidth <= m.clientWidth + 1, rows: ${sheet}.querySelectorAll('.mu-row').length,
          miss: Object.keys(I18N.en).filter((k) => k.startsWith('muscles.') && I18N[${J(lang)}][k] === undefined), same: ${J(lang)} !== 'en' && ${J(lang)} !== 'sk' ? Object.keys(I18N.en).filter((k) => k.startsWith('muscles.') && I18N[${J(lang)}][k] === I18N.en[k]) : [] }; })()`);
      check(lang + ': no raw key / NaN / undefined, no overflow, rows drawn, all muscles.* keys translated', !/muscles\.|NaN|undefined/.test(x.raw) && x.over && x.rows >= 4 && x.miss.length === 0, x);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        if (process.env.GQ_SCREENSHOTS !== '0') {
        const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'muscles-ar.png'), Buffer.from(s.data, 'base64'));
        }
      }
      await esc(); await wait(60);
    }
    await p.eval(`(setLang('en'), true)`);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), switchTab('pokrok'), setPokrokView('stats'), renderStatsGrid(), openMuscles(), true)`); await wait(200);
      if (process.env.GQ_SCREENSHOTS !== '0') {
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'muscles-' + theme + '.png'), Buffer.from(s.data, 'base64'));
      }
      check(theme + ': sheet fits 390 px', await ev(`(() => { const m = ${sheet}.querySelector('.modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().width <= 390; })()`));
      await esc(); await wait(60);
    }
    check('no console errors', logs.length === 0, logs);
  } catch (e) { fail++; console.log('  FAIL threw ' + (e && e.stack || e)); }
  b.killHard(true); await server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
