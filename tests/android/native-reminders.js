'use strict';
/* GymQuest Android — water / meal / workout reminders scheduled on the phone (LocalNotifications).

     node tests/android/native-reminders.js

   nativeReminderSchedule(data) turns the account's reminder settings (reminders_get shape) into
   daily / weekly local notifications: water every N minutes from..to inclusive (same window as the
   server's reminders_due), meals at their times, workout on the chosen ISO days (Mon=1) converted to
   Android's weekday (Sun=1); texts in the app language; ids water 1000+, meals 2000+, workout 3000+;
   ≤ 64 total. nativeRemindersApply() cancels the old ones and schedules the new list only when this
   phone has notifications on for the signed-in account and permission is granted; saving the
   reminders card, coming back to the app and turning notifications off / signing out re-apply or cancel. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls, fireNative } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const ME = '11111111-2222-3333-4444-555555555555';
const DATA = { water_on: true, water_every: 60, water_from: '08:00', water_to: '20:00', meals_on: true,
  meal_times: ['08:00', '12:30', '18:30'], workout_on: true, workout_days: [1, 3, 5], workout_time: '18:00', tz: 'Europe/Bratislava', saved: true };

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'nrem', debugPort: 9940, native: true,
      returns: { 'LocalNotifications.checkPermissions': { display: 'granted' }, 'LocalNotifications.getPending': { notifications: [{ id: 1003 }, { id: 2001 }, { id: 42 }] } } });
    await wait(1000);
    const sched = (d) => p.eval(`nativeReminderSchedule(${JSON.stringify(d)})`);

    let l = await sched(DATA);
    const water = l.filter((n) => n.id >= 1000 && n.id < 2000);
    check('water 60 min 08:00–20:00 → 13 slots', water.length === 13, water.length);
    check('water first 08:00, last 20:00', water[0] && water[0].schedule.on.hour === 8 && water[0].schedule.on.minute === 0
      && water[12].schedule.on.hour === 20 && water[12].schedule.on.minute === 0, water.map((n) => n.schedule.on));
    const meals = l.filter((n) => n.id >= 2000 && n.id < 3000);
    check('3 meals at 08:00, 12:30, 18:30', meals.length === 3 && meals[1].schedule.on.hour === 12 && meals[1].schedule.on.minute === 30);
    const wk = l.filter((n) => n.id >= 3000);
    check('Mon/Wed/Fri → Android weekdays 2,4,6 at 18:00', JSON.stringify(wk.map((n) => n.schedule.on.weekday)) === '[2,4,6]'
      && wk.every((n) => n.schedule.on.hour === 18 && n.schedule.on.minute === 0), wk.map((n) => n.schedule.on));
    check('Sunday (ISO 7) → Android weekday 1', (await sched(Object.assign({}, DATA, { workout_days: [7] }))).filter((n) => n.id >= 3000)[0].schedule.on.weekday === 1);
    check('unique ids', new Set(l.map((n) => n.id)).size === l.length);
    check('english texts', water[0].body === '💧 Time to drink some water' && meals[0].body === '🍽️ Time to eat' && /workout time/.test(wk[0].body), [water[0].body, meals[0].body, wk[0].body]);
    check('channel reminders, allowWhileIdle', l.every((n) => n.channelId === 'reminders' && n.schedule.allowWhileIdle === true));
    await p.eval(`(setLang('sk'), true)`);
    check('slovak texts', (await sched(DATA))[0].body === '💧 Čas napiť sa vody');
    await p.eval(`(setLang('en'), true)`);
    check('all off → nothing', (await sched(Object.assign({}, DATA, { water_on: false, meals_on: false, workout_on: false }))).length === 0);
    check('null → nothing', (await sched(null)).length === 0);
    l = await sched(Object.assign({}, DATA, { water_every: 30, water_from: '00:00', water_to: '23:30', meal_times: ['07:00', '10:00', '13:00', '16:00', '19:00', '22:00'], workout_days: [1, 2, 3, 4, 5, 6, 7] }));
    check('worst case stays ≤ 64', l.length <= 64, l.length);

    /* zapnuté upozornenia pre prihláseného → naplánuje */
    await p.eval(`(communityProfile = { id: ${JSON.stringify(ME)} }, pushDeviceWrite({ uid: ${JSON.stringify(ME)} }), remindersData = ${JSON.stringify(DATA)}, true)`);
    await clearNativeCalls(p);
    await p.eval(`nativeRemindersApply()`);
    const cancels = await nativeCalls(p, 'LocalNotifications', 'cancel');
    const scheds = await nativeCalls(p, 'LocalNotifications', 'schedule');
    check('apply: cancels only our pending ids (1003, 2001)', cancels.length === 1
      && JSON.stringify(cancels[0].args[0].notifications.map((n) => n.id).sort()) === '[1003,2001]', cancels);
    check('apply: schedules 13 + 3 + 3', scheds.length === 1 && scheds[0].args[0].notifications.length === 19, scheds.length && scheds[0].args[0].notifications.length);

    /* návrat do appky → znova */
    await clearNativeCalls(p);
    await fireNative(p, 'App', 'resume', {});
    await wait(200);
    check('resume re-applies', (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 1);

    /* uloženie karty pripomienok (falošný Supabase klient) */
    await p.eval(`(() => {
      window.__fakeSb = { rpc: async (fn, args) => (fn === 'reminders_set' ? { data: Object.assign({}, args.p, { saved: true }) } : { data: null }) };
      communityClient = () => window.__fakeSb;
      communityVersion = 6;
      const box = document.createElement('div'); box.id = 'rem-test-box'; document.body.appendChild(box);
      return true; })()`);
    await p.eval(`(document.getElementById('rem-test-box').innerHTML = remindersCardHtml(), true)`);
    check('reminders card shown when notifications are on', await p.eval(`!!document.getElementById('rem-water-on')`));
    await p.eval(`(document.getElementById('rem-water-on').checked = false, true)`);
    await clearNativeCalls(p);
    await p.eval(`remindersSave()`);
    await wait(200);
    const s2 = await nativeCalls(p, 'LocalNotifications', 'schedule');
    check('save → rescheduled without water', s2.length === 1 && !s2[0].args[0].notifications.some((n) => n.id < 2000), s2.length && s2[0].args[0].notifications.length);

    /* bez povolenia → nič nové */
    await p.eval(`(window.__nativeReturns['LocalNotifications.checkPermissions'] = { display: 'denied' }, true)`);
    await clearNativeCalls(p);
    await p.eval(`nativeRemindersApply()`);
    check('permission denied: cancel only, no schedule', (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 0
      && (await nativeCalls(p, 'LocalNotifications', 'cancel')).length === 1);
    await p.eval(`(window.__nativeReturns['LocalNotifications.checkPermissions'] = { display: 'granted' }, true)`);

    /* štart bez siete: profil ani nastavenia pripomienok ešte nie sú načítané → pripomienky zostanú
       (naplánujú sa z posledných známych nastavení), nič sa len tak nezruší */
    await p.eval(`(remindersData = ${JSON.stringify(DATA)}, true)`);
    await p.eval(`nativeRemindersApply()`);   // úspešné naplánovanie uloží posledné nastavenia
    await p.eval(`(communityProfile = null, remindersData = null, true)`);
    await clearNativeCalls(p);
    await fireNative(p, 'App', 'resume', {});
    await wait(300);
    const off1 = await nativeCalls(p, 'LocalNotifications', 'schedule');
    check('offline start (profile + settings not loaded): reminders rescheduled from the last known settings',
      off1.length === 1 && off1[0].args[0].notifications.length === 19, off1.length && off1[0].args[0].notifications.length);
    await p.eval(`(() => { try { localStorage.removeItem('gymquest_reminders_last'); } catch (e) {} return true; })()`);
    await clearNativeCalls(p);
    await p.eval(`nativeRemindersApply()`);
    check('nothing known yet: existing reminders are left alone (no cancel)', (await nativeCalls(p, 'LocalNotifications', 'cancel')).length === 0
      && (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 0);

    /* odhlásený (záznam zariadenia zrušený) / iný účet → zruší */
    await p.eval(`(communityProfile = { id: ${JSON.stringify(ME)} }, remindersData = ${JSON.stringify(DATA)}, true)`);
    await clearNativeCalls(p);
    await p.eval(`(communityProfile = { id: 'aaaaaaaa-0000-0000-0000-000000000000' }, nativeRemindersApply())`);
    check('another account signed in: cancel only', (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 0
      && (await nativeCalls(p, 'LocalNotifications', 'cancel')).length === 1);
    await p.eval(`(communityProfile = { id: ${JSON.stringify(ME)} }, true)`);
    await clearNativeCalls(p);
    await p.eval(`pushDisable(null)`);
    await wait(200);
    check('notifications off on this phone: reminders cancelled', (await nativeCalls(p, 'LocalNotifications', 'cancel')).length >= 1
      && (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 0);

    check('no console errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
