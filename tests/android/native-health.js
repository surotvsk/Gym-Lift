'use strict';
/* GymQuest Android — Health Connect (fake GymHealth plugin in headless Chrome).

     node tests/android/native-health.js

   Off by default: finishing a workout makes no Health Connect calls and adds no `health` field.
   Turning it on asks for permission (denied → stays off with a note; Health Connect missing → note).
   On: a finished workout (with a running session) is written to Health Connect with its id and the
   real start/end window, then heart rate / calories are read for that window and stored on the
   history entry as entry.health = { start, end, hrAvg, hrMax, kcal, readAt } — only values that
   exist (never zeros); the result sheet and the day detail show them; with no data yet the day
   detail offers "Refresh heart rate", which fills them in later; coming back to the app retries
   recent workouts; undo and delete remove the session from Health Connect; Community share
   payloads never contain heart rate; the field survives reload and export; the web shows nothing. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls, fireNative } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;

/* rozbehnutý tréning s jednou odcvičenou sériou a 30 min trvaním, potom potvrdenie */
const FINISH = `(async () => {
  const plan = getPlan(activePlanIds()[0]);
  selectedPlan = plan.id;
  const sess = ensureSession(plan);
  sess.startedAt = Date.now() - 30 * 60 * 1000;
  const ex = plan.exercises[0];
  sess.completedSets[setSessionKey(ex, 0)] = true;
  saveState();
  finishWorkout();
  confirmFinish();
  await new Promise((r) => setTimeout(r, 300));
  return lastWorkoutId;
})()`;
const entryOf = (p, id) => p.eval(`JSON.parse(JSON.stringify(state.history.find((w) => w.id === ${JSON.stringify(id)}) || null))`);

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'nhealth', debugPort: 9943, native: true, returns: {
      'GymHealth.isAvailable': { available: true },
      'GymHealth.requestPermissions': { granted: ['READ_HEART_RATE', 'READ_ACTIVE_CALORIES_BURNED', 'WRITE_EXERCISE'] },
      'GymHealth.readStats': { hrAvg: 128.4, hrMax: 161, hrCount: 240, kcal: 312.6 },
      'GymHealth.writeWorkout': { ok: true }, 'GymHealth.deleteWorkout': { ok: true },
      'LocalNotifications.getPending': { notifications: [] } } });
    await wait(1000);
    await p.eval(`(seedSampleData(), saveState(), true)`);
    check('session start field used by the test exists', await p.eval(`(() => { const s = ensureSession(getPlan(activePlanIds()[0])); const ok = 'startedAt' in s; clearSession(); return ok; })()`));

    /* vypnuté */
    check('setting visible in the app, off by default', await p.eval(`(openSettings(), !document.getElementById('health-setting').hidden && !document.getElementById('health-switch').checked && !state.settings.healthConnect)`));
    await p.eval(`(document.getElementById('modal-settings').hidden = true, true)`);
    await clearNativeCalls(p);
    let id = await p.eval(FINISH);
    check('off: no Health Connect calls', (await nativeCalls(p, 'GymHealth')).length === 0);
    check('off: no health field', !(await entryOf(p, id)).health);
    await p.eval(`(document.getElementById('modal-result').hidden = true, true)`);

    /* zapnutie: Health Connect chýba */
    await p.eval(`(window.__nativeReturns['GymHealth.isAvailable'] = { available: false }, true)`);
    await p.eval(`(openSettings(), document.getElementById('health-switch').click(), true)`);
    await wait(300);
    check('not installed: stays off, note shown', await p.eval(`!state.settings.healthConnect && !document.getElementById('health-switch').checked
      && document.getElementById('health-status').textContent === t('health.unavailable')`));
    /* zapnutie: zamietnuté */
    await p.eval(`(window.__nativeReturns['GymHealth.isAvailable'] = { available: true }, window.__nativeReturns['GymHealth.requestPermissions'] = { granted: [] }, true)`);
    await p.eval(`(document.getElementById('health-switch').click(), true)`);
    await wait(300);
    check('denied: stays off, note shown', await p.eval(`!state.settings.healthConnect && !document.getElementById('health-switch').checked
      && document.getElementById('health-status').textContent === t('health.denied')`));
    /* zapnutie: povolené */
    await p.eval(`(window.__nativeReturns['GymHealth.requestPermissions'] = { granted: ['READ_HEART_RATE', 'READ_ACTIVE_CALORIES_BURNED', 'WRITE_EXERCISE'] }, true)`);
    await p.eval(`(document.getElementById('health-switch').click(), true)`);
    await wait(300);
    check('granted: on and saved', await p.eval(`state.settings.healthConnect === true && document.getElementById('health-switch').checked`));
    await p.eval(`(document.getElementById('modal-settings').hidden = true, true)`);

    /* tréning so zapnutým Health Connect */
    await clearNativeCalls(p);
    const before = Date.now();
    id = await p.eval(FINISH);
    await wait(300);
    const w = await nativeCalls(p, 'GymHealth', 'writeWorkout');
    const wa = (w[0] && w[0].args[0]) || {};
    check('workout written once with its id and title', w.length === 1 && wa.id === id && typeof wa.title === 'string' && wa.title.length > 0, wa);
    const span = Date.parse(wa.end) - Date.parse(wa.start);
    check('window = real duration (~30 min), ends now', Math.abs(span - 30 * 60 * 1000) < 5000 && Math.abs(Date.parse(wa.end) - before) < 10000, { span });
    const r = await nativeCalls(p, 'GymHealth', 'readStats');
    check('stats read for the same window', r.length >= 1 && r[0].args[0].start === wa.start && r[0].args[0].end === wa.end);
    let e = await entryOf(p, id);
    check('entry.health stored (rounded)', e.health && e.health.start === wa.start && e.health.end === wa.end && e.health.hrAvg === 128
      && e.health.hrMax === 161 && e.health.kcal === 313 && typeof e.health.readAt === 'string', e.health);
    check('result sheet shows heart rate + kcal', await p.eval(`(() => { const el = document.getElementById('result-health');
      return !!el && !el.hidden && el.textContent.includes('128') && el.textContent.includes('161') && el.textContent.includes('313'); })()`));
    await p.eval(`(document.getElementById('modal-result').hidden = true, true)`);
    check('day detail shows heart rate', await p.eval(`(openDay(todayISO()), document.getElementById('day-body').textContent.includes(t('health.hr', { avg: 128, max: 161 })))`));
    await p.eval(`(document.getElementById('modal-day').hidden = true, true)`);

    /* nastavenie patrí telefónu (povolenie je v telefóne), nie účtu / zálohe */
    check('healthConnect is a device-only setting (not synced)', await p.eval(`DEVICE_SETTING_KEYS.includes('healthConnect')`));
    /* povolenie odobraté v Health Connect → pri otvorení Nastavení sa prepínač vypne s poznámkou */
    await p.eval(`(window.__nativeReturns['GymHealth.checkPermissions'] = { granted: [] }, openSettings(), true)`);
    await wait(300);
    check('permission revoked: switch turns off with the note', await p.eval(`!state.settings.healthConnect && !document.getElementById('health-switch').checked
      && document.getElementById('health-status').textContent === t('health.denied')`));
    await p.eval(`(window.__nativeReturns['GymHealth.checkPermissions'] = { granted: ['READ_HEART_RATE', 'WRITE_EXERCISE'] }, state.settings.healthConnect = true, saveState(), true)`);
    await fireNative(p, 'App', 'resume', {});
    await wait(300);
    check('permission still granted: stays on after resume', await p.eval(`state.settings.healthConnect === true`));
    await p.eval(`(window.__nativeReturns['GymHealth.checkPermissions'] = { granted: [] }, true)`);
    await fireNative(p, 'App', 'resume', {});
    await wait(300);
    check('permission revoked while away: off after resume', await p.eval(`state.settings.healthConnect === false`));
    await p.eval(`(window.__nativeReturns['GymHealth.checkPermissions'] = { granted: ['READ_HEART_RATE', 'READ_ACTIVE_CALORIES_BURNED', 'WRITE_EXERCISE'] }, state.settings.healthConnect = true, saveState(), document.getElementById('modal-settings').hidden = true, true)`);

    /* Community nikdy */
    check('share payload has no heart rate', await p.eval(`!JSON.stringify(shareFromWorkout(state.history.find((x) => x.id === ${JSON.stringify(id)}))).match(/hr|kcal|health/i)`));

    /* zachovanie pri obnovení a v exporte */
    check('export contains health', await p.eval(`JSON.parse(backupPayload()).history.some((x) => x.id === ${JSON.stringify(id)} && x.health && x.health.hrAvg === 128)`));

    /* bez dát z hodiniek → neskôr Obnoviť */
    await p.eval(`(window.__nativeReturns['GymHealth.readStats'] = { hrCount: 0 }, true)`);
    const id2 = await p.eval(FINISH);
    await wait(300);
    e = await entryOf(p, id2);
    check('no data: window only, no zeros', e.health && e.health.start && !('hrAvg' in e.health) && !('hrMax' in e.health) && !('kcal' in e.health), e.health);
    check('no data: result sheet shows nothing', await p.eval(`document.getElementById('result-health').hidden`));
    await p.eval(`(document.getElementById('modal-result').hidden = true, openDay(todayISO()), true)`);
    check('no data: day detail offers Refresh', await p.eval(`!!document.querySelector('#day-body [data-health-refresh=' + JSON.stringify(${JSON.stringify(id2)}) + ']')`));
    await p.eval(`(window.__nativeReturns['GymHealth.readStats'] = { hrAvg: 120, hrMax: 150, hrCount: 100 }, true)`);
    await p.eval(`(document.querySelector('#day-body [data-health-refresh=' + JSON.stringify(${JSON.stringify(id2)}) + ']').click(), true)`);
    await wait(400);
    e = await entryOf(p, id2);
    check('refresh fills heart rate (no kcal from watch → none)', e.health.hrAvg === 120 && e.health.hrMax === 150 && !('kcal' in e.health), e.health);
    await p.eval(`(document.getElementById('modal-day').hidden = true, true)`);

    /* návrat do appky skúsi nedávne tréningy bez dát */
    await p.eval(`(window.__nativeReturns['GymHealth.readStats'] = { hrCount: 0 }, true)`);
    const id3 = await p.eval(FINISH);
    await wait(300);
    await p.eval(`(document.getElementById('modal-result').hidden = true, window.__nativeReturns['GymHealth.readStats'] = { hrAvg: 99, hrMax: 140, hrCount: 50 }, true)`);
    await fireNative(p, 'App', 'resume', {});
    await wait(500);
    check('resume fills recent workout without data', (await entryOf(p, id3)).health.hrAvg === 99);

    /* rýchle "Vrátiť späť" počas pomalého zápisu → zmazanie až po zápise (žiadne duchovia v Health Connect) */
    await p.eval(`(window.__nativeReturns['GymHealth.writeWorkout'] = { __delay: 800, value: { ok: true } }, true)`);
    await clearNativeCalls(p);
    const idq = await p.eval(FINISH);
    await p.eval(`(requestUndoWorkout(), document.getElementById('btn-generic-ok').click(), true)`);
    await wait(1500);
    const wq = (await nativeCalls(p, 'GymHealth', 'writeWorkout'))[0];
    const dq = (await nativeCalls(p, 'GymHealth', 'deleteWorkout'))[0];
    check('quick undo: delete is sent only after the write finished', !!wq && !!dq && dq.args[0].id === idq && dq.at >= wq.at + 750, { w: wq && wq.at, d: dq && dq.at });
    await p.eval(`(window.__nativeReturns['GymHealth.writeWorkout'] = { ok: true }, document.getElementById('modal-result').hidden = true, true)`);

    /* späť / zmazanie → zmazané aj z Health Connect */
    await clearNativeCalls(p);
    await p.eval(`(lastWorkoutId = ${JSON.stringify(id3)}, requestUndoWorkout(), document.getElementById('btn-generic-ok') ? document.getElementById('btn-generic-ok').click() : null, true)`);
    await wait(200);
    const d1 = await nativeCalls(p, 'GymHealth', 'deleteWorkout');
    check('undo deletes the Health Connect session', !(await entryOf(p, id3)) && d1.length === 1 && d1[0].args[0].id === id3, d1);
    await clearNativeCalls(p);
    await p.eval(`(requestDeleteWorkout(${JSON.stringify(id2)}), document.getElementById('btn-generic-ok').click(), true)`);
    await wait(200);
    const d2 = await nativeCalls(p, 'GymHealth', 'deleteWorkout');
    check('delete deletes the Health Connect session', !(await entryOf(p, id2)) && d2.length === 1 && d2[0].args[0].id === id2, d2);
    await clearNativeCalls(p);
    const old = await p.eval(`state.history.find((x) => !x.health).id`);
    await p.eval(`(requestDeleteWorkout(${JSON.stringify(old)}), document.getElementById('btn-generic-ok').click(), true)`);
    await wait(200);
    check('deleting a workout without health: no Health Connect call', (await nativeCalls(p, 'GymHealth', 'deleteWorkout')).length === 0);

    /* obnovenie stránky */
    await p.reload();
    await wait(800);
    check('health survives reload', (await entryOf(p, id)).health.hrAvg === 128);
    check('no console errors', errors.length === 0, errors.slice(0, 5));
    closeAll();

    const web = await openApp({ name: 'nhealth-web', debugPort: 9944 });
    await wait(800);
    check('web: setting hidden', await web.p.eval(`(openSettings(), document.getElementById('health-setting').hidden)`));
    check('web: no errors', web.errors.length === 0, web.errors);
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
