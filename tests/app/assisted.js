'use strict';
/* GymQuest — asistované cviky (v100, spec §3.5), v reálnom headless Chrome. Bez účtov a siete.

     GQ_TEST_PORT=8190 node tests/app/assisted.js      (GQ_SHOTS = priečinok na snímky obrazovky, voliteľné)

   Checks: knižnica má "Assisted dips/pull-ups (machine)" v 6 jazykoch (názov, postup, chyby); session s
   asistovanými zhybmi 30/25/25 -> popis "Assistance", po Dokončiť ďalšia pomoc 25; žiadny rekord, míľnik
   ani Best lift z asistencie; "vs last time" = menej pomoci je pokrok; vlastný riadok "Dips" označený ako
   asistovaný ukazuje Assistance a obyčajné Dips zostanú nedotknuté; história nesie `assisted: true`;
   editor: prepínač (knižnica zapnutý+neaktívny, vlastný aktívny, zabudovaný neasistovaný bez prepínača),
   uloženie značku zachová a šíri; zdieľanie nesie `a`; popisy sa vojdú pri 320 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-assisted');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const LANGS = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('as-' + Date.now().toString(36), 9893, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const E = (code) => p.eval(code);
  const logs = [];
  await p.c.send('Log.enable');
  await p.c.send('Runtime.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const shot = async (file) => {
    if (!SHOTS) return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, 'base64'));
  };
  const view = (w) => p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true });
  const heads = (i) => E(`(() => { const ex = document.querySelectorAll('#exercise-list .exercise')[${i}]; return ex ? [...ex.querySelectorAll('.set-heads .set-cap')].map((c) => { const f = c.querySelector('.cap-f'); return (getComputedStyle(f).display === 'none' ? c.querySelector('.cap-s') : f).textContent; }) : null; })()`);
  try {
    await view(393);
    await p.navigate(BASE);
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== library (6 languages)');
    check('both entries exist, assisted: true, listed, never merged with dips/pull-ups', await E(`(() => {
      const a = libraryEntry('assisted-dips'), c = libraryEntry('assisted-pull-ups');
      return !!a && !!c && a.assisted === true && c.assisted === true && libraryAll().includes(a) && libraryAll().includes(c)
        && exerciseIdentity({ id: 'assisted-dips' }) === 'assisted-dips' && exerciseIdentity({ id: 'dips' }) === 'dips'
        && !libraryEntry('dips').assisted && !libraryEntry('pull-ups').assisted; })()`));
    check('alternatives to dips / pull-ups (harderVariation) and all fields present', await E(`(() => {
      const a = libraryEntry('assisted-dips'), c = libraryEntry('assisted-pull-ups'); const ref = libraryEntry('machine-chest-press');
      return a.alternatives.some((x) => x[0] === 'dips' && x[1] === 'harderVariation') && c.alternatives.some((x) => x[0] === 'pull-ups' && x[1] === 'harderVariation')
        && Object.keys(ref).filter((k) => k !== 'alternatives').every((k) => k in a && k in c)
        && [a, c].every((e) => e.alternatives.every((x) => libraryEntry(x[0]) && ALT_WHY_CODES.includes(x[1]))); })()`));
    check('media list for them is empty without errors', await E(`exerciseMediaList(libraryEntry('assisted-dips')).length === 0 && exerciseMediaList(libraryEntry('assisted-pull-ups')).length === 0`));
    const names = {};
    for (const lang of LANGS) {
      const r = await E(`(setLang(${J(lang)}), ['assisted-dips', 'assisted-pull-ups'].map((id) => ['', '.how', '.mistakes'].map((s) => t('exercise.' + id + s))))`);
      names[lang] = r[0][0] + '|' + r[1][0];
      check(lang + ': names, how-to and mistakes translated (not the key, not empty)', r.flat().every((x) => x && !/^exercise\./.test(x)), r);
    }
    check('names differ between the 6 languages', new Set(Object.values(names)).size === 6, names);
    check('the session keys exist in all 6 languages', await E(`${J(LANGS)}.every((l) => ['session.assistance', 'assisted.line', 'assisted.toggle', 'trening.compareAssistLess', 'trening.compareAssistMore', 'trening.compareAssistLessReps']
      .every((k) => typeof I18N[l][k] === 'string' && I18N[l][k].length > 0))`));
    await E(`(setLang('en'), true)`);

    console.log('== isAssisted');
    check('library entry, flagged row, plain rows', await E(`isAssisted({ id: 'assisted-dips' }) && isAssisted({ name: 'x', assisted: true }) && !isAssisted({ id: 'dips' }) && !isAssisted({ name: 'Dips' }) && !isAssisted(null)`));

    /* Základ: obyčajný cvik s rekordom (Best lift), plán s tromi riadkami, minulý tréning v rovnakom pláne. */
    await E(`(() => {
      state.plans['atest'] = { id: 'atest', builtin: false, customName: 'Assist test', location: null,
        exercises: [{ id: 'assisted-pull-ups', name: 'Assisted pull-ups (machine)', sets: 3, reps: 8, weight: 30 },
                    { name: 'Bar dips', sets: 3, reps: 8, weight: 20, assisted: true },
                    { id: 'dips', name: 'Dips', sets: 3, reps: 8, weight: 10 }] };
      state.plans['atest2'] = { id: 'atest2', builtin: false, customName: 'Assist test 2', location: null,
        exercises: [{ name: 'Bar dips', sets: 2, reps: 6, weight: 15, assisted: true }] };
      for (const id of ['atest', 'atest2']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
      state.history = [
        { id: 'h-base', date: '2020-01-01', planId: 'bench', planName: 'Bench', xp: 10, exercises: [{ name: 'Bench press', exId: 'bench-press', sets: 3, reps: 5, weight: 60, setsDone: 3 }] },
        { id: 'h-prev', date: '2020-02-01', planId: 'atest', planName: 'Assist test', xp: 10, exercises: [
          { name: 'Assisted pull-ups (machine)', exId: 'assisted-pull-ups', sets: 3, reps: 8, weight: 35, setsDone: 3, assisted: true },
          { name: 'Dips', exId: 'dips', sets: 3, reps: 8, weight: 50, setsDone: 3 }] }];
      backfillState(); saveState(); switchTab('dnes'); renderAll(); return true; })()`);
    const base = await E(`({ rec: personalRecords().map((r) => r.name + ':' + r.weight), ach: Object.keys(evaluateAchievements()).sort(), pr: prStats().prEvents,
      lift: (renderAll(), document.getElementById('bt-lift-v').textContent + '|' + document.getElementById('bt-lift-line').textContent) })`);
    check('baseline: Best lift tile shows Bench 60 kg, old assisted history ignored', base.lift === '60 kg|Bench press' && J(base.rec) === J(['Bench press:60', 'Dips:50']), base);

    console.log('== session: captions, "vs last time", row text');
    await E(`(() => { selectedPlan = 'atest'; switchTab('trening'); renderTrening(); return true; })()`); await wait(250);
    check('assisted pull-ups caption: Assistance / Reps', J(await heads(0)) === J(['Assistance', 'Reps']), await heads(0));
    check('custom row marked assisted: Assistance', J(await heads(1)) === J(['Assistance', 'Reps']), await heads(1));
    check('ordinary Dips: Weight / Reps (unaffected)', J(await heads(2)) === J(['Weight', 'Reps']), await heads(2));
    const meta = await E(`[...document.querySelectorAll('#exercise-list .exercise')].map((e) => e.querySelector('.exercise-meta').textContent.replace(/\\s+/g, ' ').trim())`);
    check('row meta: "3 × 8 · Assistance 30 kg" / ordinary "10 kg"', /Assistance 30 kg/.test(meta[0]) && /Assistance 20 kg/.test(meta[1]) && /10 kg/.test(meta[2]) && !/Assistance/.test(meta[2]), meta);
    const hints = await E(`[...document.querySelectorAll('#exercise-list .exercise .compare-hint')].map((e) => e.textContent.trim())`);
    check('pull-ups 30 vs last 35 -> "5 kg less assistance" as progress (up)', /▲ 5 kg less assistance vs last time/.test(hints[0]) && (await E(`!!document.querySelector('#exercise-list .exercise .compare-hint .up')`)), hints);
    check('custom assisted row without history: First time', hints[1] === 'First time', hints);
    check('a "Dips" row marked assisted vs an old ordinary Dips record: no comparison (first time); ordinary Dips vs it is fine', await E(`comparisonHint({ id: 'dips', name: 'Dips', assisted: true, sets: 3, reps: 8, weight: 20 }, 'atest') === 'First time'
      && /50|▼/.test(comparisonHint({ id: 'dips', name: 'Dips', sets: 3, reps: 8, weight: 10 }, 'atest'))`));
    check('weight input aria-label says Assistance', await E(`document.querySelector('#exercise-list .exercise .set-weight').getAttribute('aria-label') === 'Assistance, Set 1'`), await E(`document.querySelector('#exercise-list .exercise .set-weight').getAttribute('aria-label')`));
    check('assisted weight placeholder is 0, not BW', await E(`document.querySelector('#exercise-list .exercise .set-weight').placeholder === '0'`));
    /* Zhoršenie: viac pomoci = červená šípka. */
    check('unchanged assistance and reps: "Same assistance as last time (35 kg)"', await E(`comparisonHint(Object.assign({}, state.plans.atest.exercises[0], { weight: 35 }), 'atest').indexOf('Same assistance as last time (35 kg)') >= 0`));
    check('hint for more assistance (40 vs 35)', await E(`(() => { const ex = Object.assign({}, state.plans.atest.exercises[0], { weight: 40 }); return /▼ 5 kg more assistance/.test(comparisonHint(ex, 'atest')); })()`));

    /* Zachytenie snímok obrazovky relácie (en/ar, svetlá/tmavá, 393 px; fr 320 px) po zadaní váh. */
    await E(`(() => { const a = state.plans.atest.exercises[0]; ensureSession(getPlan('atest'));
      setSetWeight(a, 1, 25); setSetWeight(a, 2, 25);
      toggleSetMark('done', a, 0, true); toggleSetMark('done', a, 1, true); toggleSetMark('done', a, 2, true);
      const b = state.plans.atest.exercises[2]; setSetWeight(b, 0, 10); toggleSetMark('done', b, 0, true); toggleSetMark('done', b, 1, true);
      const c = state.plans.atest.exercises[1]; toggleSetMark('done', c, 0, true); toggleSetMark('done', c, 1, true);
      saveState(); renderTrening(); return true; })()`); await wait(250);
    const sessionShots = async () => {
      for (const [lang, theme, w] of [['en', 'light', 393], ['en', 'dark', 393], ['ar', 'light', 393], ['ar', 'dark', 393], ['fr', 'light', 320], ['es', 'dark', 320]]) {
        await view(w);
        await E(`(localStorage.setItem('gymquest_theme', ${J(theme)}), applyTheme(), setLang(${J(lang)}), renderTrening(), document.querySelector('#exercise-list .exercise').scrollIntoView(), true)`); await wait(250);
        await shot('session-' + lang + '-' + theme + '-' + w + '.png');
      }
    };
    await sessionShots();
    await E(`(localStorage.removeItem('gymquest_theme'), applyTheme(), setLang('en'), true)`); await view(393);

    console.log('== captions fit (320 px; short captions, all 6 languages)');
    const capBad = [];
    await view(320);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      for (const theme of ['light', 'dark']) {
        await E(`(localStorage.setItem('gymquest_theme', ${J(theme)}), applyTheme(), setLang(${J(lang)}), renderTrening(), true)`); await wait(150);
        const bad = await E(`(() => { const out = []; document.querySelectorAll('#exercise-list .exercise').forEach((ex, i) => {
          [...ex.querySelectorAll('.set-cap'), ex.querySelector('.exercise-meta'), ex.querySelector('.exercise-name')].forEach((c) => { if (c.scrollWidth > c.clientWidth + 1) out.push(i + ':' + c.className + ':' + c.textContent.trim()); });
          const r = ex.getBoundingClientRect(); ex.querySelectorAll('*').forEach((c) => { const q = c.getBoundingClientRect(); if (q.width && c.offsetParent && (q.right > innerWidth + 1 || q.left < -1)) out.push(i + ':off-screen:' + (c.className || c.tagName)); }); });
          return out.slice(0, 4); })()`);
        if (bad.length) capBad.push([lang, theme, bad]);
      }
    }
    check('no clipped caption (Weight/Assistance/Reps short forms), meta or name and nothing off-screen at 320 px', capBad.length === 0, capBad);
    check('at 320 px the short captions show (en: Assist / Reps; fr: Assist. / Rép.), full words stay in aria-labels', await E(`(setLang('en'), renderTrening(), true)`) && J(await heads(0)) === J(['Assist', 'Reps']) && (await E(`(setLang('fr'), renderTrening(), true)`)) && J(await heads(2)) === J(['Kg', 'Rép.']) && await E(`document.querySelector('#exercise-list .set-weight').getAttribute('aria-label').indexOf('Assistance') === 0`), [await heads(0), await heads(2)]);
    await E(`(localStorage.removeItem('gymquest_theme'), applyTheme(), setLang('en'), true)`); await view(393);

    console.log('== finish: next working weight, history entry, no PR / milestone / Best lift');
    await E(`(() => { document.getElementById('modal-confirm').hidden = false; confirmFinish(); return true; })()`); await wait(250);
    const after = await E(`({ w0: state.plans.atest.exercises[0].weight, mem: state.settings.exerciseMemory['assisted-pull-ups'],
      hist: state.history.find((h) => h.id !== 'h-base' && h.id !== 'h-prev'),
      rec: personalRecords().map((r) => r.name + ':' + r.weight), ach: Object.keys(evaluateAchievements()).sort(), pr: prStats().prEvents,
      lift: (renderAll(), document.getElementById('bt-lift-v').textContent + '|' + document.getElementById('bt-lift-line').textContent) })`);
    check('next session assistance = 25 (30/25/25 -> lowest repeated)', after.w0 === 25 && after.mem && after.mem.weight === 25, { w0: after.w0, mem: after.mem });
    const h = after.hist;
    const hp = h && h.exercises.find((e) => e.exId === 'assisted-pull-ups');
    const hd = h && h.exercises.find((e) => e.name === 'Bar dips');
    const ho = h && h.exercises.find((e) => e.exId === 'dips');
    check('history: assisted pull-ups entry has assisted: true, setWeights 30/25/25, weight = lowest 25', hp && hp.assisted === true && J(hp.setWeights) === J([30, 25, 25]) && hp.weight === 25, hp);
    check('history: custom assisted row has assisted: true; ordinary Dips has no assisted key', hd && hd.assisted === true && ho && !('assisted' in ho), { hd, ho });
    check('no new records from assisted values (only Bench 60 and ordinary Dips 50 / 10 remain)', J(after.rec) === J(['Bench press:60', 'Dips:50']), after.rec);
    check('ordinary Dips still counts for records/milestones of its own', await E(`evaluateAchievements()['ms-Dips-50'] !== undefined`));
    check('no ms- milestone for assisted names (Assisted pull-ups / Bar dips 20)', !after.ach.some((k) => /^ms-Assisted/.test(k)) && !after.ach.some((k) => /^ms-Bar dips/.test(k)), after.ach.filter((k) => k.startsWith('ms-')));
    check('prStats unchanged by assisted values', after.pr === base.pr, { before: base.pr, after: after.pr });
    check('Best lift tile unchanged (Bench press 60 kg)', after.lift === base.lift, after.lift);
    check('day view shows "Assistance 30 · 25 · 25 kg"', await E(`(openDay(todayISO()), document.body.innerText.includes('Assistance 30 · 25 · 25 kg'))`));
    check('plan changes later do not change an old history line (flag on the record)', await E(`(() => { state.plans.atest.exercises[0].id = 'cx-x'; const t1 = historyWeightText(state.history.find((h) => h.id !== 'h-base' && h.id !== 'h-prev').exercises[0]); return t1 === 'Assistance 30 · 25 · 25 kg'; })()`));
    for (const [lang, theme, w] of [['en', 'light', 393], ['en', 'dark', 393], ['ar', 'light', 393], ['ar', 'dark', 393], ['fr', 'light', 320]]) {
      await view(w);
      await E(`(localStorage.setItem('gymquest_theme', ${J(theme)}), applyTheme(), setLang(${J(lang)}), openDay(todayISO()), true)`); await wait(300);
      await shot('history-' + lang + '-' + theme + '-' + w + '.png');
    }
    await E(`(localStorage.removeItem('gymquest_theme'), applyTheme(), setLang('en'), closeDay(), true)`);
    await view(393);
    await E(`(() => { state.plans.atest.exercises[0].id = 'assisted-pull-ups'; saveState(); location.reload(); return true; })()`); await wait(600);
    check('survives a reload (state kept)', await E(`state.history.some((h) => h.exercises.some((e) => e.assisted === true))`));

    console.log('== editor toggle');
    await E(`(() => { setLang('en'); switchTab('trening'); selectedPlan = 'atest'; startEditPlan('atest'); return true; })()`); await wait(300);
    const ed = await E(`[...document.querySelectorAll('#edit-rows .edit-row')].map((r) => { const box = r.querySelector('.edit-assist'); const c = r.querySelector('.edit-assisted');
      return { hidden: box.hidden, checked: c.checked, disabled: c.disabled, h: box.hidden ? 0 : r.querySelector('.edit-assist .edit-side-toggle').getBoundingClientRect().height }; })`);
    check('library assisted row: toggle ON and disabled', ed[0].checked && ed[0].disabled && !ed[0].hidden, ed[0]);
    check('custom assisted row: toggle ON and enabled (>= 44 px)', ed[1].checked && !ed[1].disabled && ed[1].h >= 44, ed[1]);
    check('library ordinary Dips: no toggle (cannot be confused with Assisted dips)', ed[2].hidden === true, ed[2]);
    await E(`(document.querySelectorAll('#edit-rows .edit-row')[1].scrollIntoView(), true)`);
    for (const [lang, theme, w] of [['en', 'light', 393], ['en', 'dark', 393], ['ar', 'light', 393], ['ar', 'dark', 393], ['fr', 'light', 320]]) {
      await view(w);
      await E(`(localStorage.setItem('gymquest_theme', ${J(theme)}), applyTheme(), setLang(${J(lang)}), document.querySelectorAll('#edit-rows .edit-row')[0].scrollIntoView(), true)`); await wait(300);
      await shot('editor-' + lang + '-' + theme + '-' + w + '.png');
    }
    await E(`(localStorage.removeItem('gymquest_theme'), applyTheme(), setLang('en'), true)`); await view(393); await wait(150);
    /* Prepnutie vlastného riadku vypne/zapne značku v návrhu; premenovanie ordinary Dips na vlastný ukáže prepínač. */
    await E(`(() => { const c = document.querySelectorAll('#edit-rows .edit-assisted')[1]; c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    check('toggling off removes assisted from the draft row only', await E(`editDraft[1].assisted === undefined && editDraft[0].assisted === undefined`));
    await E(`(() => { const c = document.querySelectorAll('#edit-rows .edit-assisted')[1]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    check('toggling on sets assisted: true', await E(`editDraft[1].assisted === true`));
    await E(`(() => { const n = document.querySelectorAll('#edit-rows .edit-name')[2]; n.value = 'Dips x'; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    check('renaming the ordinary library Dips makes it custom and shows an enabled toggle (still not assisted)', await E(`(() => { const r = document.querySelectorAll('#edit-rows .edit-row')[2]; const c = r.querySelector('.edit-assisted');
      return !r.querySelector('.edit-assist').hidden && !c.disabled && !c.checked && editDraft[2].assisted === undefined; })()`));
    await E(`(() => { const n = document.querySelectorAll('#edit-rows .edit-name')[2]; n.value = 'Dips'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await E(`(() => { saveEditPlan(); return true; })()`); await wait(200);
    const saved = await E(`({ a: state.plans.atest.exercises.map((e) => e.assisted === true), id0: state.plans.atest.exercises[0].id, other: state.plans.atest2.exercises[0].assisted === true })`);
    check('save keeps assisted on the custom row; library row unflagged (library decides)', saved.a[1] === true && saved.id0 === 'assisted-pull-ups', saved);
    /* Šírenie: vypnutie značky v prvom pláne ju zruší aj v druhom pláne s rovnakým cvikom. */
    await E(`(() => { startEditPlan('atest'); const c = document.querySelectorAll('#edit-rows .edit-assisted')[1]; c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); saveEditPlan(); return true; })()`); await wait(200);
    const prop = await E(`({ a: state.plans.atest.exercises[1].assisted === true, b: state.plans.atest2.exercises[0].assisted === true, mem: (state.settings.exerciseMemory || {})[exerciseIdentity(state.plans.atest.exercises[1])] })`);
    check('un-marking in one plan propagates to the same custom exercise in another plan', prop.a === false && prop.b === false, prop);
    await E(`(() => { startEditPlan('atest'); const c = document.querySelectorAll('#edit-rows .edit-assisted')[1]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); saveEditPlan(); return true; })()`); await wait(200);
    check('marking propagates too', await E(`state.plans.atest.exercises[1].assisted === true && state.plans.atest2.exercises[0].assisted === true`));

    console.log('== a row named "Dips" marked assisted (maps to the library id)');
    await E(`(() => { state.plans['atest3'] = { id: 'atest3', builtin: false, customName: 'Assist test 3', location: null,
        exercises: [{ name: 'Dips', sets: 2, reps: 6, weight: 18, assisted: true }] };
      state.planOrder.push('atest3'); backfillState(); delete state.settings.exerciseMemory.dips; state.plans.atest.exercises[2].weight = 10; saveState(); return true; })()`);
    check('backfill gave the assisted "Dips" row its own cx- id (not the library dips)', await E(`(() => { const r = state.plans.atest3.exercises[0]; return /^cx-/.test(r.id) && r.id === exerciseIdentity({ name: 'Dips' }) && r.assisted === true && !r.builtin; })()`), await E(`state.plans.atest3.exercises[0]`));
    check('an old {id: "dips", assisted: true} row converts back to cx- (idempotent)', await E(`(() => { state.plans.atest3.exercises[0] = { id: 'dips', builtin: true, name: 'Dips', sets: 2, reps: 6, weight: 18, assisted: true }; backfillState(); const a = JSON.stringify(state.plans.atest3.exercises[0]); backfillState(); return /^cx-/.test(state.plans.atest3.exercises[0].id) && a === JSON.stringify(state.plans.atest3.exercises[0]); })()`));
    check('"Dips" + assisted flag: Assistance caption, ordinary Dips elsewhere still Weight', await E(`(() => { selectedPlan = 'atest3'; renderTrening(); const a = [...document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-heads .set-cap')].map((c) => { const f = c.querySelector('.cap-f'); return (getComputedStyle(f).display === 'none' ? c.querySelector('.cap-s') : f).textContent; });
      selectedPlan = 'atest'; renderTrening(); const b = [...document.querySelectorAll('#exercise-list .exercise')[2].querySelectorAll('.set-heads .set-cap')].map((c) => { const f = c.querySelector('.cap-f'); return (getComputedStyle(f).display === 'none' ? c.querySelector('.cap-s') : f).textContent; });
      return a[0] === 'Assistance' && b[0] === 'Weight'; })()`));
    await E(`(() => { selectedPlan = 'atest3'; ensureSession(getPlan('atest3')); const a = state.plans.atest3.exercises[0]; toggleSetMark('done', a, 0, true); toggleSetMark('done', a, 1, true);
      document.getElementById('modal-confirm').hidden = false; confirmFinish(); return true; })()`); await wait(250);
    check('finishing it does not write the ordinary Dips memory or the ordinary Dips row', await E(`!(state.settings.exerciseMemory || {}).dips && state.plans.atest.exercises[2].weight === 10`), await E(`J = JSON.stringify, [(state.settings.exerciseMemory || {}).dips, state.plans.atest.exercises[2].weight]`));
    /* Scenár A: obyčajné Dips sa dokončia s 60 kg – asistovaný riadok "Dips" sa nezmení. */
    await E(`(() => { state.plans.atest.exercises[2].weight = 60; saveState(); selectedPlan = 'atest'; ensureSession(getPlan('atest')); const d = state.plans.atest.exercises[2]; toggleSetMark('done', d, 0, true); toggleSetMark('done', d, 1, true);
      document.getElementById('modal-confirm').hidden = false; confirmFinish(); return true; })()`); await wait(250);
    check('A: finishing ordinary Dips (60 kg) writes memory "dips" but NOT into the assisted "Dips" row (keeps 18, assisted)', await E(`state.settings.exerciseMemory.dips.weight === 60 && state.plans.atest3.exercises[0].weight === 18 && state.plans.atest3.exercises[0].assisted === true`), await E(`[state.settings.exerciseMemory.dips, state.plans.atest3.exercises[0]]`));
    check('B: seeding a new ordinary Dips row comes from ordinary memory, assisted false', await E(`(() => { const src = exerciseSharedSource('dips', 'atest3'); const row = exerciseOtherPlanRow('dips', 'x'); return src.weight === 60 && src.assisted === false && (!row || row.assisted !== true); })()`));
    check('B: adding the library Dips in the editor of the assisted plan gives weight 60, not assisted', await E(`(() => { startEditPlan('atest3'); const row = { id: 'dips', name: 'Dips', sets: 3, reps: 8, weight: 0, builtin: true }; editDraft.push(row); seedDraftRow(row); const ok = row.weight === 60 && row.assisted !== true; cancelEditPlan(); return ok; })()`));
    check('editor keeps the toggle visible (and ON) for that row so it can be turned off', await E(`(() => { startEditPlan('atest3'); const c = document.querySelector('#edit-rows .edit-assisted'); const ok = !document.querySelector('#edit-rows .edit-assist').hidden && c.checked && !c.disabled; cancelEditPlan(); return ok; })()`));

    /* Vypnutie značky: riadok sa po uložení a backfille vráti k identite knižničného dips; váha zostáva vlastná (nič sa neprevezme). */
    await E(`(() => { startEditPlan('atest3'); const c = document.querySelector('#edit-rows .edit-assisted'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); saveEditPlan(); backfillState(); return true; })()`); await wait(200);
    check('toggle OFF on custom "Dips": maps back to library dips, keeps its own weight 18, adopts nothing, not assisted', await E(`(() => { const r = state.plans.atest3.exercises[0]; return r.id === 'dips' && r.weight === 18 && r.assisted !== true && state.settings.exerciseMemory.dips.weight === 60; })()`), await E(`state.plans.atest3.exercises[0]`));

    console.log('== sharing carries the flag');
    const sh = await E(`(() => { const x = shareFromPlan(state.plans.atest); const wk = shareFromWorkout(state.history.find((h) => h.planId === 'atest' && h.id !== 'h-prev'));
      return { plan: x.exercises.map((e) => !!e.a), wk: wk.exercises.map((e) => !!e.a), card: shareCardHtml(wk, 'post', 'x', true).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ') }; })()`);
    check('shared plan: pull-ups and custom Bar dips flagged, ordinary Dips not', J(sh.plan) === J([true, true, false]), sh.plan);
    check('shared workout card says "Assistance" for them', /Assistance 30 · 25 · 25 kg/.test(sh.card), sh.card);
    check('saving a shared custom assisted row keeps the flag', await E(`(() => { const n = Object.keys(state.plans).length; const nm = shareSaveAsPlan({ name: 'S', exercises: [{ n: 'Bar dips', s: 2, r: 5, w: 20, a: true }] }); const pl = Object.values(state.plans).find((q) => q.customName === nm);
      return Object.keys(state.plans).length === n + 1 && pl.exercises[0].assisted === true; })()`));

    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    check('test crashed', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
