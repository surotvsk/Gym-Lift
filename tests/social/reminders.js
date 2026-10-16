'use strict';
/* GymQuest reminders (migration 0012 + Edge Function `reminders`). LOCAL test stack only.
   Needs 0012 applied, the functions served locally with REMINDER_SECRET (and `reminders` with JWT
   verification off), the Vault secrets gq_reminders_url / gq_reminders_secret pointing at the local
   function, and PUSH_TEST_ENDPOINT_PREFIX for the mock push service (push-mock.js, port 9871).
   Env: GQ_REMINDER_SECRET (the same secret).   Usage: node tests/social/reminders.js [filter] */
const path = require('path');
const L = require('./lib');
const { startMock, device, decrypt, vapidOk, received } = require('./push-mock');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
const REPO = path.resolve(__dirname, '..', '..');
const SECRET = process.env.GQ_REMINDER_SECRET || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FN = L.URL_ + '/functions/v1/reminders';

async function member(tag) {
  const u = await L.newUser('rem-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
const base = { tz: 'UTC', water_on: false, water_every: 120, water_from: '08:00', water_to: '21:00', meals_on: false,
  meal_times: ['08:00', '12:30', '18:30'], workout_on: false, workout_days: [1, 3, 5], workout_time: '17:00' };
const set = (u, p) => u.c.rpc('reminders_set', { p: Object.assign({}, base, p) });
/* UTC "HH:MM" n minutes ago; null near midnight (a window would cross into the next day). */
function hhmmAgo(min) {
  const d = new Date(Date.now() - min * 60000);
  if (d.getUTCDate() !== new Date().getUTCDate() || d.getUTCHours() * 60 + d.getUTCMinutes() > 23 * 60 + 30) return null;
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
const isoDow = () => ((new Date().getUTCDay() + 6) % 7) + 1;
const dueFor = async (u) => {
  const r = await L.admin.rpc('reminders_due');
  if (r.error) throw new Error('reminders_due: ' + errText(r));
  return r.data.filter((x) => (x.subs || []).some((s) => s.endpoint.includes(u.tag)));
};

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('version, access and validation', async () => {
  check('community_social_version() is 6 or later', Number(sqlVal('select public.community_social_version()')) >= 6);
  check('cron job gymquest-reminders every 5 minutes', sqlVal(`select schedule from cron.job where jobname = 'gymquest-reminders'`) === '*/5 * * * *');
  const a = await member('val');
  let r = await a.c.rpc('reminders_get');
  check('defaults before saving: ON (0013) and marked as never saved', !r.error && r.data.water_on === true && r.data.meals_on === true && r.data.workout_on === true
    && r.data.saved === false && r.data.water_every === 120 && J(r.data.meal_times) === J(['08:00', '12:30', '18:30']), J(r.data));
  r = await set(a, { tz: 'Europe/Bratislava', water_on: true, water_every: 90, meals_on: true, meal_times: ['07:30', '13:00'], workout_on: true, workout_days: [2, 4], workout_time: '18:15' });
  check('saving valid settings', !r.error && r.data.tz === 'Europe/Bratislava' && r.data.water_every === 90 && J(r.data.meal_times) === J(['07:30', '13:00']) && J(r.data.workout_days.sort()) === J([2, 4]), errText(r) + J(r.data));
  check('after saving: saved = true', (await a.c.rpc('reminders_get')).data.saved === true);
  await set(a, { water_on: false, meals_on: false, workout_on: false });
  check('switching everything off is kept (not turned back on)', (await a.c.rpc('reminders_get')).data.water_on === false);
  await set(a, { tz: 'Europe/Bratislava', water_on: true, water_every: 90, meals_on: true, meal_times: ['07:30', '13:00'], workout_on: true, workout_days: [2, 4], workout_time: '18:15' });
  check('turning water on starts counting from now (no immediate reminder)', sqlVal(`select (now() - last_water) < interval '1 minute' from public.push_reminders where user_id = ${lit(a.id)}`) === 't');
  for (const [what, p] of [['unknown time zone', { tz: 'Mars/Olympus' }], ['bad time', { water_from: '25:00' }], ['water from after to', { water_from: '22:00', water_to: '08:00' }],
    ['interval below 30 min', { water_every: 5 }], ['7 meal times', { meal_times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'] }],
    ['meal at 23:45', { meal_times: ['23:45'] }], ['day 8', { workout_days: [8] }], ['workout at 23:50', { workout_time: '23:50' }]]) {
    r = await set(a, p);
    check('refused: ' + what, !!r.error, J(r.data));
  }
  check('no direct table access', !!(await a.c.from('push_reminders').select('*')).error);
  check('members cannot call reminders_due', !!(await a.c.rpc('reminders_due')).error);
  check('members cannot call reminders_dispatch', !!(await a.c.rpc('reminders_dispatch')).error);
  check('anon cannot read settings', !!(await L.anon().rpc('reminders_get')).error);
});

scenario('who is due: water interval, meal and workout windows, never twice', async () => {
  const a = await member('due');
  const d = device('due-' + L.runTag);
  a.tag = d.id;
  await a.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: 'sk' });
  const t5 = hhmmAgo(5);
  if (!t5) { check('skipped near midnight UTC (windows would cross days)', true); return; }
  let r = await set(a, { water_on: true, water_every: 30, water_from: '00:00', water_to: '23:59', meals_on: true, meal_times: [t5], workout_on: true, workout_days: [isoDow()], workout_time: t5 });
  check('settings saved', !r.error, errText(r));
  let due = await dueFor(a);
  check('water is not due right after switching it on', !due.some((x) => x.kinds.includes('water')), J(due));
  check('meal (5 min after the time) and workout (today, 5 min after) are due', due.length === 1 && due[0].kinds.includes('meal') && due[0].kinds.includes('workout'), J(due));
  check('the device and its language come along', due.length === 1 && due[0].subs.length === 1 && due[0].subs[0].lang === 'sk');
  due = await dueFor(a);
  check('asking again right away: nothing (marked as sent)', due.length === 0, J(due));
  sql(`update public.push_reminders set last_water = now() - interval '31 minutes' where user_id = ${lit(a.id)};`);
  due = await dueFor(a);
  check('water due after its 30-minute interval', due.length === 1 && J(due[0].kinds) === J(['water']), J(due));
  check('and not again right after', (await dueFor(a)).length === 0);
  const t30 = hhmmAgo(30);
  if (t30) {
    await set(a, { meals_on: true, meal_times: [t30], workout_on: true, workout_days: [isoDow()], workout_time: t30 });
    sql(`update public.push_reminders set last_meal = null, last_workout = null where user_id = ${lit(a.id)};`);
    check('30 minutes after the time: outside the 20-minute window, nothing', (await dueFor(a)).length === 0);
  }
  await set(a, { workout_on: true, workout_days: [(isoDow() % 7) + 1], workout_time: t5 });
  sql(`update public.push_reminders set last_workout = null where user_id = ${lit(a.id)};`);
  check('workout on another weekday: nothing', !(await dueFor(a)).some((x) => x.kinds.includes('workout')));
  await a.c.rpc('push_unsubscribe', { p_endpoint: d.endpoint });
  sql(`update public.push_reminders set last_water = now() - interval '2 hours' where user_id = ${lit(a.id)};`);
  check('no registered device: nothing is due (and nothing marked)', (await L.admin.rpc('reminders_due')).data.every((x) => !(x.subs || []).some((s) => s.endpoint === d.endpoint)));
});

scenario('end to end: cron dispatch → pg_net → reminders function → encrypted notification', async () => {
  if (!SECRET) { check('GQ_REMINDER_SECRET set', false); return; }
  let r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('function refuses calls without the secret', r.status === 401, r.status);
  r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gq-reminder': SECRET.slice(0, -1) + 'x' }, body: '{}' });
  check('function refuses a wrong secret', r.status === 401, r.status);
  const a = await member('e2e');
  const d = device('e2e-' + L.runTag);
  await a.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: 'en' });
  await set(a, { water_on: true, water_every: 30, water_from: '00:00', water_to: '23:59' });
  sql(`update public.push_reminders set last_water = now() - interval '45 minutes' where user_id = ${lit(a.id)};`);
  const req = sqlVal('select public.reminders_dispatch()');
  check('dispatch queued one HTTP request (pg_net)', /^\d+$/.test(req), req);
  for (let i = 0; i < 60 && !received.some((x) => x.id === d.id); i++) await wait(500);
  const got = received.filter((x) => x.id === d.id);
  check('the device received exactly one reminder', got.length === 1, String(got.length));
  if (got.length) {
    check('VAPID signature valid', vapidOk(got[0].headers.authorization) === '', vapidOk(got[0].headers.authorization));
    let p = null; try { p = decrypt(d, got[0].body); } catch (e) { p = { error: String(e) }; }
    check('decrypted: water reminder in English', p && p.type === 'reminder' && p.kind === 'water' && p.body === '💧 Time to drink some water' && p.tag === 'gq-reminder-water', J(p));
  }
  check('marked as sent (no second notification)', sqlVal(`select (now() - last_water) < interval '2 minutes' from public.push_reminders where user_id = ${lit(a.id)}`) === 't');
  const status = sqlVal(`select coalesce(status_code::text, 'pending') from net._http_response where id = ${req}`);
  check('the HTTP call from the database got 200', status === '200', status);
});

scenario('cleanup and rollback', async () => {
  const a = await member('cl');
  await set(a, { water_on: true });
  const r = await L.admin.rpc('community_leave_cleanup', { p_user: a.id });
  check('leaving Community removes the reminders', !r.error && sqlVal(`select count(*) from public.push_reminders where user_id = ${lit(a.id)}`) === '0', errText(r));
  const undone = L.rollbackFrom(12);
  check('after rollback: version 5, table and cron job gone', sqlVal('select public.community_social_version()') === '5'
    && sqlVal(`select to_regclass('public.push_reminders') is null and not exists (select 1 from cron.job where jobname = 'gymquest-reminders')`) === 't');
  L.reapply(undone);
  check('0013 (and later) re-applied too (defaults on)', undone.length >= 2 && undone.some((m) => m.n === 13) && sqlVal(`select column_default from information_schema.columns where table_name = 'push_reminders' and column_name = 'water_on'`) === 'true');
  check('re-applied: version ' + undone.versionBefore + ' again and the job is back', sqlVal('select public.community_social_version()') === undone.versionBefore
    && sqlVal(`select count(*) from cron.job where jobname = 'gymquest-reminders'`) === '1');
  await wait(1500);
});

(async () => {
  const mock = await startMock();
  const M = await L.newUser('rem-mod'); L.makeModerator(M);
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  mock.close();
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
