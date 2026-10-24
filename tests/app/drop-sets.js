'use strict';
/* GymQuest — drop sets during a workout (v69), in real headless Chrome. No accounts and no
   network: the app runs with empty Community config.

     node tests/app/drop-sets.js

   Checks: every exercise offers "+ Drop set"; a drop set starts ~20 % lighter than the last set
   (rounded to 2.5 kg) with the same reps; reps/weight are editable and only that drop set changes;
   done/undone; remove; at most 5; survives a reload; the plan is unchanged; the set count and XP
   are unchanged; only completed drop sets go to history ({ weight, reps }); history, Calendar and
   the shared card show "Drop sets: 50 kg × 8 · 40 kg × 6"; replacing the exercise and undoing the
   replacement removes the replacement's drop sets; 6 languages; RTL; 390 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-drops');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('drops-' + Date.now().toString(36), 9872, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['dtest'] = { id: 'dtest', builtin: false, customName: 'Drop test', location: null,
        exercises: [{ id: 'cx-d1', name: 'Curl test', sets: 3, reps: 10, weight: 62.5 },
          { id: 'cx-d2', name: 'Row test', sets: 2, reps: 10, weight: 40 }] };
      if (!state.planOrder.includes('dtest')) state.planOrder.push('dtest');
      selectedPlan = 'dtest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const ex0 = `document.querySelectorAll('#exercise-list .exercise')[0]`;
    const drops = () => p.eval(`Array.from(${ex0}.querySelectorAll('.drop-item')).map((d) => d.querySelector('.drop-label').textContent + '|' + d.querySelector('.drop-reps').textContent + '|' + d.querySelector('.drop-weight').textContent + '|' + (d.querySelector('.drop-done').classList.contains('done') ? 'done' : '-'))`);
    const clickIn = (sel, i) => p.eval(`(${ex0}.querySelectorAll(${J(sel)})[${i || 0}].click(), true)`);

    console.log('== adding drop sets');
    check('every exercise has a "+ Drop set" button', (await p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')).every((e) => !!e.querySelector('.btn-add-drop') && e.querySelector('.btn-add-drop').textContent.includes('Drop set'))`)));
    check('no drop rows before adding', J(await drops()) === '[]');
    /* Posledná séria 70 kg × 8 (zmenená váha a opakovania) → drop séria 55 kg (70 × 0,8 = 56 → 55) × 8. */
    await p.eval(`(setSetWeight(getPlan('dtest').exercises[0], 2, '70'), setSetReps(getPlan('dtest').exercises[0], 2, '8'), renderTrening(), true)`);
    await clickIn('.btn-add-drop');
    check('drop set 1: ~20 % lighter than the last set (rounded to 2.5) and the same reps', J(await drops()) === J(['⬇ Drop set 1|8×|55|-']), await drops());
    check('adding a drop set starts the workout', !!(await p.eval('getSession()')));
    await clickIn('.btn-add-drop');
    check('drop set 2 continues from drop set 1 (55 → 45)', J(await drops()) === J(['⬇ Drop set 1|8×|55|-', '⬇ Drop set 2|8×|45|-']), await drops());
    /* úprava: drop 2 → 40 kg a 6 opakovaní */
    await clickIn('.drop-weight', 1);
    check('weight editor opens with the drop weight and its own note', await p.eval(`!!document.querySelector('.drop-editor') && document.querySelector('.set-weight-input').value === '45' && document.querySelector('.set-weight-note').textContent === t('drop.editorNote')`));
    await p.eval(`(document.querySelector('.drop-editor .btn:nth-of-type(1)').click(), document.querySelector('.set-weight-ok').click(), true)`);
    await clickIn('.drop-reps', 1);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '6'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait(200);
    check('only drop set 2 changed (42.5 kg × 6)', J(await drops()) === J(['⬇ Drop set 1|8×|55|-', '⬇ Drop set 2|6×|42.5|-']), await drops());
    await clickIn('.drop-reps', 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '0'; document.querySelector('.set-reps-ok').click(); return true; })()`);
    check('an invalid value is refused (editor stays open)', (await p.eval(`!!document.querySelector('.drop-editor')`)) && J(await drops()) === J(['⬇ Drop set 1|8×|55|-', '⬇ Drop set 2|6×|42.5|-']));
    await p.eval(`(closeSetWeightEditor(), true)`);
    check('the normal sets did not change', J(await p.eval(`Array.from(${ex0}.querySelectorAll('.set-item:not(.drop-item) .set-weight')).map((x) => x.textContent)`)) === J(['62.5', '62.5', '70']));
    for (let k = 0; k < 3; k++) await clickIn('.btn-add-drop');
    check('at most 5 drop sets; then the button disappears', (await p.eval(`${ex0}.querySelectorAll('.drop-item').length`)) === 5 && !(await p.eval(`!!${ex0}.querySelector('.btn-add-drop')`)));
    for (let k = 0; k < 3; k++) await clickIn('.drop-remove', 4 - k);
    check('✕ removes a drop set', (await drops()).length === 2, await drops());
    await clickIn('.drop-done', 0); await clickIn('.drop-done', 1); await clickIn('.drop-done', 1);
    check('drop set ✓ toggles (1 done, 2 not)', J(await drops()) === J(['⬇ Drop set 1|8×|55|done', '⬇ Drop set 2|6×|42.5|-']), await drops());
    await clickIn('.drop-done', 1);
    /* hotové normálne série 1–3 a Row séria 1 */
    for (const i of [0, 1, 2]) await p.eval(`(${ex0}.querySelectorAll('.set-item:not(.drop-item) .set-btn')[${i}].click(), true)`);
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelectorAll('.set-btn')[0].click(), true)`);
    check('the set count ignores drop sets ("4 of 5")', (await p.eval(`totalSetsDone()`)) === 4 && (await p.eval(`planExerciseCount(getPlan('dtest'))`)) === 5);
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(300);
    check('drop sets survive a reload', J(await drops()) === J(['⬇ Drop set 1|8×|55|done', '⬇ Drop set 2|6×|42.5|done']), await drops());
    check('the plan is unchanged (3 × 10 × 62.5, no drop sets)', await p.eval(`(() => { const e = state.plans['dtest'].exercises[0]; return e.sets === 3 && e.reps === 10 && e.weight === 62.5 && !('drops' in e) && !JSON.stringify(state.plans).includes('drop'); })()`), await p.eval(`state.plans['dtest'].exercises[0]`));
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(${ex0}.querySelector('.drops').scrollIntoView({ block: 'center' }), true)`);
    await wait(300);
    check('390 px: no horizontal overflow with drop sets', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
    let s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'drops-390.png'), Buffer.from(s.data, 'base64'));
    await p.c.send('Emulation.clearDeviceMetricsOverride');

    console.log('== saved history');
    /* Drop séria 3 pridaná, ale NEDOKONČENÁ → nesmie ísť do histórie. */
    await clickIn('.btn-add-drop');
    const xpBefore = await p.eval(`BASE_XP + totalSetsDone() * XP_PER_SET`);
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const h = await p.eval(`state.history[state.history.length - 1]`);
    check('only the completed drop sets are saved ({ weight, reps })', J(h.exercises[0].drops) === J([{ weight: 55, reps: 8 }, { weight: 42.5, reps: 6 }]), h.exercises[0].drops);
    check('an exercise without drop sets has none', h.exercises[1].drops === undefined, h.exercises[1]);
    check('XP is the same as without drop sets', h.xp === xpBefore, { xp: h.xp, xpBefore });
    check('setsDone counts only the normal sets', h.exercises[0].setsDone === 3);
    await p.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), setPokrokView('progress'), true)`);
    await wait(300);
    const text = 'Drop sets: 55 kg × 8 · 42.5 kg × 6';
    check('Progress history shows "' + text + '"', (await p.eval(`document.body.innerText`)).includes(text));
    await p.eval(`(switchTab('kalendar'), openDay(todayISO()), true)`);
    await wait(300);
    check('the Calendar day window shows the drop sets', (await p.eval(`document.getElementById('modal-day').innerText`)).includes(text));
    await p.eval(`(closeDay(), true)`);
    const a = await p.eval(`shareFromWorkout(state.history[state.history.length - 1])`);
    check('the shared workout carries the drop sets', J(a.exercises[0].dr) === J([[55, 8], [42.5, 6]]) && a.exercises[1].dr === undefined, a.exercises);
    const card = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(a)}, 'msg', 1); document.body.appendChild(d); const tx = d.innerText; d.remove(); return tx; })()`);
    check('the shared card shows the drop sets', card.includes(text), card);
    const bad = { kind: 'workout', name: 'X', exercises: [{ n: 'E', s: 1, r: 5, w: 10, d: 1, dr: [['<b>', 3], [20, 0], 'x', [15, 4]] }] };
    const card2 = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(bad)}, 'msg', 1); return { tx: d.innerText, b: !!d.querySelector('b') }; })()`);
    check('a malformed drop list from someone else is filtered (no HTML, no invalid rows)', !card2.b && card2.tx.includes('15 kg × 4') && !card2.tx.includes('<b>'), card2);
    const id = await p.eval(`state.history[state.history.length - 1].id`);
    await p.eval(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="weight"]'); inp.value = '65'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    check('editing the workout in history keeps its drop sets', J(await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0].drops`)) === J([{ weight: 55, reps: 8 }, { weight: 42.5, reps: 6 }]));

    console.log('== replacing an exercise');
    await p.eval(`(() => { switchTab('trening'); selectedPlan = 'dtest'; renderTrening(); return true; })()`);
    await p.eval(`(${ex0}.querySelectorAll('.set-item:not(.drop-item) .set-btn')[0].click(), true)`);   // 1 hotová séria pred výmenou
    await clickIn('.btn-add-drop');
    check('drop sets are stored per exercise in the running workout', J(await p.eval(`Object.keys(getSession().drops || {})`)) === J(['cx-d1']));
    await p.eval(`(${ex0}.querySelector('.exercise-swap').click(), true)`);
    await wait(200);
    await p.eval(`(applySubstitution('hammer-curl'), true)`);
    await wait(300);
    const slot = await p.eval(`exerciseSlots(getPlan('dtest'))[0].slot`);
    const subKey = await p.eval(`(() => { const st = substitutionSteps(${J(slot)}); return st.length ? String(st[st.length - 1].key) : null; })()`);
    check('the exercise was replaced', !!subKey, subKey);
    check('the closed original keeps its drop set, locked (no add button)', await p.eval(`(() => { const e = document.querySelector('#exercise-list .exercise.exercise-closed'); return !!e && e.querySelectorAll('.drop-item').length === 1 && Array.from(e.querySelectorAll('.drop-item button')).every((x) => x.disabled) && !e.querySelector('.btn-add-drop'); })()`));
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelector('.btn-add-drop').click(), true)`);
    await wait(200);
    check('the replacement gets its own drop sets', (await p.eval(`(getSession().drops[${J(subKey)}] || []).length`)) === 1);
    await p.eval(`(requestUndoSubstitution(${J(slot)}), true)`);
    await wait(300);
    if (await p.eval(`!document.getElementById('modal-generic').hidden`)) await p.eval(`(confirmGeneric(), true)`);
    await wait(200);
    check('undoing the replacement removes its drop sets, the original keeps its own', await p.eval(`!(getSession().drops || {})[${J(subKey)}] && ((getSession().drops || {})['cx-d1'] || []).length === 1`), await p.eval(`getSession().drops`));

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      const r = await p.eval(`(() => { const e = ${ex0}; return { add: e.querySelector('.btn-add-drop').textContent, label: e.querySelector('.drop-label').textContent,
        aria: Array.from(e.querySelectorAll('.drop-item button')).map((x) => x.getAttribute('aria-label')).join('|'), title: e.querySelector('.btn-add-drop').title,
        hist: historyDropsText(state.history[state.history.length - 1].exercises[0]), dir: document.documentElement.dir }; })()`);
      check(lang + ': drop set texts translated', !/drop\.|setReps\.|setWeight\./.test(r.add + r.label + r.aria + r.title + r.hist) && r.add.includes(await p.eval(`t('drop.add')`)), r);
      if (lang === 'ar') {
        check('ar: right-to-left', r.dir === 'rtl');
        await p.eval(`(${ex0}.querySelector('.drops').scrollIntoView({ block: 'center' }), true)`);
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'drops-ar.png'), Buffer.from(s2.data, 'base64'));
      }
    }
    await p.eval(`(setLang('en'), true)`);

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
