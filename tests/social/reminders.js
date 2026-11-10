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
  check('community_social_version() is 11 or later (0019)', Number(sqlVal('select public.community_social_version()')) >= 11);
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
    ['day 8', { workout_days: [8] }], ['workout at 23:50', { workout_time: '23:50' }]]) {
    r = await set(a, p);
    check('refused: ' + what, !!r.error, J(r.data));
  }
  r = await set(a, { meal_times: ['23:45'] });
  check('a meal at 23:45 is accepted since 0019 (slots work over midnight)', !r.error && J(r.data.meal_times) === J(['23:45']), errText(r));
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
    sql(`update public.push_reminders set last_meal = null, sent = '{}', last_workout = null where user_id = ${lit(a.id)};`);
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

/* ---- 0019: reminders v2 ---- */
const customOf = (u) => u.c.rpc('reminders_get').then((r) => r.data);
const C1 = { id: 'c1', text: 'Take creatine', time: '09:15', days: [1, 2, 3, 4, 5, 6, 7] };
/* A time zone where the local time is between 01:00 and 22:00 right now (windows do not cross midnight). */
function midDayTz() {
  for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Tokyo', 'Europe/Bratislava']) {
    const h = Number(sqlVal(`select extract(hour from now() at time zone ${lit(tz)})`));
    if (h >= 1 && h <= 21) return tz;
  }
  return 'UTC';
}
const localAgo = (tz, min) => sqlVal(`select to_char((now() - interval '${min} minutes') at time zone ${lit(tz)}, 'HH24:MI')`);
const localDow = (tz) => Number(sqlVal(`select extract(isodow from now() at time zone ${lit(tz)})`));

scenario('0019: new keys, validation, old apps keep the stored values', async () => {
  const a = await member('v2');
  let g = await customOf(a);
  check('defaults: water_mode interval, no water times, no own reminders; all old keys still there',
    g.water_mode === 'interval' && J(g.water_times) === '[]' && J(g.custom) === '[]'
    && ['water_on', 'water_every', 'water_from', 'water_to', 'meals_on', 'meal_times', 'workout_on', 'workout_days', 'workout_time', 'tz', 'saved'].every((k) => k in g), J(g));
  let r = await set(a, { tz: 'Europe/Bratislava', water_on: true, water_mode: 'times', water_times: ['10:03', '08:00', '10:03', '15:47'], custom: [C1, { id: 'c2', text: '  Stretch\t\n now  ', time: '21:00', days: [3, 1, 3] }] });
  check('saved: water times de-duplicated and sorted, own reminders normalised (trim, control chars to space, days sorted)',
    !r.error && r.data.water_mode === 'times' && J(r.data.water_times) === J(['08:00', '10:03', '15:47'])
    && r.data.custom.length === 2 && r.data.custom[1].text === 'Stretch now' && J(r.data.custom[1].days) === '[1,3]', errText(r) + J(r.data));
  // old app (v105/v106): the old key set only
  r = await set(a, { tz: 'Europe/Bratislava', water_on: true, water_every: 60, meals_on: true });
  g = r.data;
  check('old key set: water_mode, water_times and custom are kept (not wiped)', !r.error && g.water_mode === 'times'
    && J(g.water_times) === J(['08:00', '10:03', '15:47']) && g.custom.length === 2 && g.custom[0].id === 'c1' && g.water_every === 60, errText(r) + J(g));
  check('old keys of an old app are still saved normally', g.meals_on === true && g.tz === 'Europe/Bratislava');
  r = await set(a, { water_mode: 'interval' });
  check('only water_mode sent: times and own reminders kept', !r.error && r.data.water_mode === 'interval' && r.data.water_times.length === 3 && r.data.custom.length === 2, J(r.data));
  r = await set(a, { custom: [] });
  check('custom: [] clears the own reminders (explicit), water times kept', !r.error && r.data.custom.length === 0 && r.data.water_times.length === 3, J(r.data));
  const long61 = 'x'.repeat(61), ok60 = 'y'.repeat(60);
  const bad = [['water_mode "daily"', { water_mode: 'daily' }], ['water_mode number', { water_mode: 1 }], ['13 water times', { water_times: Array.from({ length: 13 }, (_, i) => String(i).padStart(2, '0') + ':00') }],
    ['water time 24:00', { water_times: ['24:00'] }], ['water_times not an array', { water_times: '08:00' }], ['custom not an array', { custom: {} }],
    ['11 own reminders', { custom: Array.from({ length: 11 }, (_, i) => ({ id: 'i' + i, text: 't', time: '08:00', days: [1] })) }],
    ['empty text', { custom: [{ id: 'x', text: '', time: '08:00', days: [1] }] }], ['whitespace / control-only text', { custom: [{ id: 'x', text: ' \t\n\u0007 ', time: '08:00', days: [1] }] }],
    ['61-character text', { custom: [{ id: 'x', text: long61, time: '08:00', days: [1] }] }], ['text not a string', { custom: [{ id: 'x', text: 5, time: '08:00', days: [1] }] }],
    ['id with a space', { custom: [{ id: 'a b', text: 't', time: '08:00', days: [1] }] }], ['missing id', { custom: [{ text: 't', time: '08:00', days: [1] }] }],
    ['duplicate id', { custom: [{ id: 'd', text: 't', time: '08:00', days: [1] }, { id: 'd', text: 'u', time: '09:00', days: [1] }] }],
    ['time 8:00', { custom: [{ id: 'x', text: 't', time: '8:00', days: [1] }] }], ['no days', { custom: [{ id: 'x', text: 't', time: '08:00', days: [] }] }],
    ['day 8', { custom: [{ id: 'x', text: 't', time: '08:00', days: [8] }] }], ['entry not an object', { custom: ['x'] }]];
  for (const [what, p] of bad) { r = await set(a, p); check('refused: ' + what, !!r.error, J(r.data)); }
  check('refused requests changed nothing', (await customOf(a)).custom.length === 0);
  r = await set(a, { custom: [{ id: 'ok', text: ok60, time: '23:59', days: [7] }] });
  check('60-character text and a 23:59 time are accepted', !r.error && r.data.custom[0].text === ok60 && r.data.custom[0].time === '23:59', errText(r));
  r = await set(a, { custom: [{ id: 'h', text: '<img src=x onerror=alert(1)> & "q"', time: '10:00', days: [1] }] });
  check('HTML-looking text is kept verbatim as plain text (it is never rendered as HTML)', !r.error && r.data.custom[0].text === '<img src=x onerror=alert(1)> & "q"', J(r.data));
  r = await set(a, { custom: Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, text: 'n' + i, time: '08:00', days: [1] })), water_times: Array.from({ length: 12 }, (_, i) => String(i).padStart(2, '0') + ':30') });
  check('10 own reminders and 12 water times are accepted', !r.error && r.data.custom.length === 10 && r.data.water_times.length === 12, errText(r));
  check('direct access to the new columns is still closed', !!(await a.c.from('push_reminders').select('custom')).error);
  check('helper functions are not callable by members', !!(await a.c.rpc('reminders_keys', { p_meals: [], p_water: [], p_custom: [] })).error
    && !!(await a.c.rpc('reminders_slot_due', { p_now: new Date().toISOString(), p_tz: 'UTC', p_time: '10:00', p_sent: {}, p_key: 'k', p_days: null })).error);
});

scenario('0019: slot due calculation for any HH:MM (5-minute runs, DST, once per day)', async () => {
  /* pg_temp simulation: the 5-minute job at a given second offset, state = the "sent" marks. Returns the local dates it fired on. */
  const sim = (tz, hhmm, startUtc, days, jitter) => sql(`
    create or replace function pg_temp.sim(p_tz text, p_t time, p_start timestamptz, p_days int, p_jit int) returns text language plpgsql as $f$
    declare run timestamptz := p_start + make_interval(secs => p_jit); sent jsonb := '{}'; d date; fires text := '';
    begin
      while run < p_start + make_interval(days => p_days) loop
        d := public.reminders_slot_due(run, p_tz, p_t, sent, 'k', null);
        if d is not null then sent := sent || jsonb_build_object('k', d::text); fires := fires || d::text || ' '; end if;
        run := run + interval '5 minutes';
      end loop;
      return btrim(fires);
    end $f$;
    select pg_temp.sim(${lit(tz)}, ${lit(hhmm)}, ${lit(startUtc)}, ${days}, ${jitter});`);
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const times = ['00:00', '00:03', '10:03', '12:30', '18:57', '23:45', '23:55', '23:59'];
  for (let h = 0; h < 4; h++) for (const m of [0, 10, 30, 59]) times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  for (let h = 1; h <= 3; h++) for (const m of [5, 25, 35, 45]) times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  const cases = [['Europe/Bratislava', '2026-03-29', 'spring forward 02:00 -> 03:00'], ['Europe/Bratislava', '2026-10-25', 'fall back 03:00 -> 02:00'],
    ['America/New_York', '2026-03-08', 'spring forward'], ['America/New_York', '2026-11-01', 'fall back'], ['Australia/Lord_Howe', '2026-10-04', '30-minute shift'], ['UTC', '2026-06-15', 'no DST']];
  for (const [tz, day, what] of cases) {
    let wrong = [];
    for (const jit of [0, 37, 299]) {
      for (const t of times) {
        const fires = sim(tz, t, addDays(day, -2) + ' 00:00+00', 6, jit).split(' ').filter(Boolean);
        const want = [addDays(day, -1), day, addDays(day, 1)];
        // every local date of the interior fires exactly once: never skipped, never twice
        if (!want.every((w) => fires.filter((f) => f === w).length === 1)) wrong.push(t + '/j' + jit + ':' + fires.join(','));
      }
    }
    check(`${tz} ${day} (${what}): ${times.length} times x 3 run offsets fire exactly once per local date`, wrong.length === 0, wrong.slice(0, 4).join(' | '));
  }
  const one = (tz, hhmm, startUtc, mins) => sqlVal(`select public.reminders_slot_due(${lit(startUtc)}::timestamptz + interval '${mins} minutes', ${lit(tz)}, ${lit(hhmm)}, '{}', 'k', null)`);
  check('10:03 is not due in the 10:00 run, due in the 10:05 run (UTC)', one('UTC', '10:03', '2026-06-15 10:00+00', 0) === '' && one('UTC', '10:03', '2026-06-15 10:00+00', 5) === '2026-06-15');
  check('10:03 is still due in the 10:20 run, but not in the 10:25 run (20-minute window)', one('UTC', '10:03', '2026-06-15 10:00+00', 20) === '2026-06-15' && one('UTC', '10:03', '2026-06-15 10:00+00', 25) === '');
  check('a slot at 23:55 reaches the 00:00 run of the next day (date is the slot date)', one('UTC', '23:55', '2026-06-15 00:00+00', 24 * 60) === '2026-06-15');
  check('time zone is respected (10:03 in Tokyo = 01:03 UTC)', one('Asia/Tokyo', '10:03', '2026-06-15 01:05+00', 0) === '2026-06-15' && one('Asia/Tokyo', '10:03', '2026-06-15 10:05+00', 0) === '');
  check('weekday filter (own reminders)', sqlVal(`select public.reminders_slot_due('2026-06-15 10:05+00'::timestamptz, 'UTC', '10:03', '{}', 'k', '{2}'::smallint[])`) === ''
    && sqlVal(`select public.reminders_slot_due('2026-06-15 10:05+00'::timestamptz, 'UTC', '10:03', '{}', 'k', '{1}'::smallint[])`) === '2026-06-15');   // 2026-06-15 is a Monday
});

scenario('0019: who is due — water at exact times, own reminders (weekdays, no retroactive send, once)', async () => {
  const a = await member('v2due');
  const d = device('v2due-' + L.runTag);
  a.tag = d.id;
  await a.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: 'en' });
  const tz = midDayTz();
  const t5 = localAgo(tz, 5), t1h = localAgo(tz, 60), tFut = sqlVal(`select to_char((now() + interval '3 hours') at time zone ${lit(tz)}, 'HH24:MI')`);
  const dow = localDow(tz), other = (dow % 7) + 1;
  // everything added AFTER its time today is not sent retroactively
  let r = await set(a, { tz, water_on: true, water_mode: 'times', water_times: [t5, t1h], custom: [{ id: 'late', text: 'Late one', time: t5, days: [1, 2, 3, 4, 5, 6, 7] }] });
  check('settings saved', !r.error, errText(r));
  check('a water time / own reminder added after its time today is not sent retroactively', (await dueFor(a)).length === 0);
  // simulate "the 5-minute run is the first one after the slot": remove the marks
  sql(`update public.push_reminders set sent = '{}' where user_id = ${lit(a.id)};`);
  let due = await dueFor(a);
  check('water time 5 minutes ago: one water reminder (also the 1-hour-ago slot is outside the window), own reminder with its text',
    due.length === 1 && J(due[0].kinds) === J(['water']) && due[0].custom.length === 1 && due[0].custom[0].id === 'late' && due[0].custom[0].text === 'Late one', J(due));
  check('asking again right away: nothing (marked as sent)', (await dueFor(a)).length === 0);
  // weekday filter
  r = await set(a, { tz, water_on: false, custom: [{ id: 'wd', text: 'Other day', time: t5, days: [other] }, { id: 'wd2', text: 'Today', time: tFut, days: [dow] }] });
  sql(`update public.push_reminders set sent = '{}' where user_id = ${lit(a.id)};`);
  check('own reminder on another weekday / later today: nothing', (await dueFor(a)).length === 0);
  // text-only edit does not re-send; time edit is a new slot
  r = await set(a, { tz, custom: [{ id: 'wd', text: 'Other day', time: t5, days: [dow] }] });
  sql(`update public.push_reminders set sent = '{}' where user_id = ${lit(a.id)};`);
  due = await dueFor(a);
  check('own reminder today within its window: due, kinds empty', due.length === 1 && due[0].kinds.length === 0 && due[0].custom[0].text === 'Other day', J(due));
  r = await set(a, { tz, custom: [{ id: 'wd', text: 'Edited text', time: t5, days: [dow] }] });
  check('editing only the text does not send it again today', (await dueFor(a)).length === 0);
  // old app saves again: marks survive
  r = await set(a, { tz, water_on: true, water_every: 120 });
  check('an old app saving again does not re-send an already sent own reminder (switching water on again may send its water slots, not the own reminder)', (await dueFor(a)).every((x) => x.custom.length === 0));
  // meals: arbitrary times, two meals 30 minutes apart are both sent (no 40-minute suppression)
  const m25 = localAgo(tz, 25), m1 = localAgo(tz, 1);
  r = await set(a, { tz, water_on: false, meals_on: true, meal_times: [m1], custom: [] });
  due = await dueFor(a);
  check('a meal 1 minute ago is due once', due.length === 1 && J(due[0].kinds) === J(['meal']), J(due));
  r = await set(a, { tz, meals_on: true, meal_times: [m1, m25] });
  due = await dueFor(a);
  check('a second meal slot is not suppressed by the first (m25 is outside its 20-minute window: nothing)', due.length === 0, J(due));
  await a.c.rpc('push_unsubscribe', { p_endpoint: d.endpoint });
});

scenario('0019 fixes: old apps keep meals 4-6, no retroactive send over midnight / time zone change, text hardening', async () => {
  const a = await member('v2fix');
  // a v107 app saved 5 meals; an old app (v105/v106) then saves its 3 inputs (exact old payload: no water_mode, 3 meal times)
  await set(a, { water_mode: 'interval', meals_on: true, meal_times: ['07:00', '10:00', '13:00', '16:00', '19:00'], custom: [C1] });
  const OLD = { tz: 'UTC', water_on: true, water_every: 90, water_from: '08:00', water_to: '21:00', meals_on: true, meal_times: ['07:30', '10:00', '13:00'],
    workout_on: true, workout_days: [1, 3, 5], workout_time: '17:00' };
  let r = await a.c.rpc('reminders_set', { p: OLD });
  check('old app payload (3 meal inputs): its 3 times replace the first 3, stored meals 4-5 are kept', !r.error && J(r.data.meal_times) === J(['07:30', '10:00', '13:00', '16:00', '19:00']) && r.data.custom.length === 1, errText(r) + J(r.data));
  r = await a.c.rpc('reminders_set', { p: Object.assign({}, OLD, { meal_times: ['07:30'] }) });
  check('old app with fewer inputs (one meal): still keeps stored meals 4-5', !r.error && J(r.data.meal_times) === J(['07:30', '16:00', '19:00']), J(r.data));
  r = await set(a, { water_mode: 'interval', meal_times: ['08:00', '09:00'], custom: [C1] });
  check('a v107 payload (water_mode present) replaces the meals exactly (no leftovers)', !r.error && J(r.data.meal_times) === J(['08:00', '09:00']), J(r.data));
  const b = await member('v2fix2');
  r = await b.c.rpc('reminders_set', { p: OLD });
  check('old app, first save: nothing special', !r.error && r.data.meal_times.length === 3);
  // fresh mark: fixed "now" around midnight
  const fm = (now, tz, t, meal) => sqlVal(`select public.reminders_fresh_mark(${lit(now)}::timestamptz, ${lit(tz)}, ${lit(t)}, ${meal ? 'true' : 'false'})`);
  check('00:05 + slot 23:50: yesterday is still in its window -> pre-marked yesterday', fm('2026-06-16 00:05+00', 'UTC', '23:50', false) === '2026-06-15');
  check('00:25 + slot 23:50: window over -> no mark (a future slot, nothing to suppress)', fm('2026-06-16 00:25+00', 'UTC', '23:50', false) === '');
  check('10:05 + slot 10:03: marked today; slot 10:30 not marked', fm('2026-06-16 10:05+00', 'UTC', '10:03', false) === '2026-06-16' && fm('2026-06-16 10:05+00', 'UTC', '10:30', false) === '');
  check('meals are not marked for today (as before) but are for yesterday over midnight', fm('2026-06-16 10:05+00', 'UTC', '10:03', true) === '' && fm('2026-06-16 00:05+00', 'UTC', '23:50', true) === '2026-06-15');
  check('time zone applies (00:05 in Tokyo = 15:05 UTC)', fm('2026-06-15 15:05+00', 'Asia/Tokyo', '23:50', false) === '2026-06-15');
  // the marked yesterday really suppresses the look-back: simulate the run right after the save
  check('with that mark the 00:05 run sends nothing, without it it would', sqlVal(`select public.reminders_slot_due('2026-06-16 00:05+00'::timestamptz, 'UTC', '23:50', '{"k":"2026-06-15"}', 'k', null) is null`) === 't'
    && sqlVal(`select public.reminders_slot_due('2026-06-16 00:05+00'::timestamptz, 'UTC', '23:50', '{}', 'k', null)`) === '2026-06-15');
  // time zone change through the real RPC: slots of the new zone are fresh and pre-marked, no immediate send
  const d = device('v2fixtz-' + L.runTag);
  await b.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: 'en' });
  b.tag = d.id;
  const tzA = 'Pacific/Auckland', tzB = midDayTz() === tzA ? 'UTC' : midDayTz(), dow = localDow(tzB);
  const t5 = localAgo(tzB, 5);
  await set(b, { tz: tzA, water_on: true, water_mode: 'times', water_times: [t5], custom: [{ id: 'tz1', text: 'tz', time: t5, days: [1, 2, 3, 4, 5, 6, 7] }] });
  sql(`update public.push_reminders set sent = '{}' where user_id = ${lit(b.id)};`);
  await set(b, { tz: tzB, water_on: true, water_mode: 'times', water_times: [t5], custom: [{ id: 'tz1', text: 'tz', time: t5, days: [1, 2, 3, 4, 5, 6, 7] }] });
  check('changing the time zone does not send the just-passed slots in the new zone', (await dueFor(b)).length === 0, J(await dueFor(b)));
  // hardening
  r = await set(b, { custom: [{ id: 'long', text: ' '.repeat(600) + 'x', time: '10:00', days: [1] }] });
  check('refused: 601 characters of text (even if mostly whitespace)', !!r.error, J(r.data));
  r = await set(b, { custom: [{ id: 'ok2', text: ' '.repeat(100) + 'x', time: '10:00', days: [1] }] });
  check('whitespace padding up to 500 characters is trimmed and accepted', !r.error && r.data.custom[0].text === 'x', errText(r));
});

scenario('0019: end to end — own reminder text and exact-time water reach the device as plain text', async () => {
  if (!SECRET) { check('GQ_REMINDER_SECRET set', false); return; }
  const a = await member('v2e2e');
  const d = device('v2e2e-' + L.runTag);
  await a.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: 'sk' });
  const tz = midDayTz();
  const t3 = localAgo(tz, 3), dow = localDow(tz);
  const txt = '<b>Kreatín</b> & "víno" 💪';
  await set(a, { tz, water_on: true, water_mode: 'times', water_times: [t3], custom: [{ id: 'e1', text: txt, time: t3, days: [dow] }] });
  sql(`update public.push_reminders set sent = '{}' where user_id = ${lit(a.id)};`);
  const req = sqlVal('select public.reminders_dispatch()');
  check('dispatch queued one HTTP request', /^\d+$/.test(req), req);
  for (let i = 0; i < 60 && received.filter((x) => x.id === d.id).length < 2; i++) await wait(500);
  const got = received.filter((x) => x.id === d.id);
  check('the device received exactly two notifications (water + own reminder)', got.length === 2, String(got.length));
  const ps = got.map((g) => { try { return decrypt(d, g.body); } catch (e) { return { error: String(e) }; } });
  const w = ps.find((p) => p.kind === 'water'), c = ps.find((p) => p.kind === 'custom');
  check('water at the exact time: Slovak text, tag', w && w.type === 'reminder' && w.body === '💧 Čas napiť sa vody' && w.tag === 'gq-reminder-water', J(w));
  check('own reminder: its text verbatim as plain text, own tag, no HTML wrapping', c && c.type === 'reminder' && c.body === txt && c.tag === 'gq-reminder-custom-e1' && c.title === 'GymQuest', J(c));
  check('all signatures valid', got.every((g) => vapidOk(g.headers.authorization) === ''));
  check('marked as sent (a second dispatch sends nothing new)', sqlVal(`select sent ? 'c:e1:${t3}' from public.push_reminders where user_id = ${lit(a.id)}`) === 't');
  const before = received.filter((x) => x.id === d.id).length;
  sqlVal('select public.reminders_dispatch()');
  await wait(3000);
  check('no duplicate after the next run', received.filter((x) => x.id === d.id).length === before);
  const status = sqlVal(`select coalesce(status_code::text, 'pending') from net._http_response where id = ${req}`);
  check('the HTTP call from the database got 200', status === '200', status);
});

scenario('0019: rollback and re-apply', async () => {
  const a = await member('v2rb');
  await set(a, { water_mode: 'times', water_times: ['10:03'], custom: [C1] });
  const undone = L.rollbackFrom(19);
  check('rolled back only 0019: version 10, new columns and helper functions gone', undone.length === 1 && undone[0].n === 19 && sqlVal('select public.community_social_version()') === '10'
    && sqlVal(`select count(*) from information_schema.columns where table_name = 'push_reminders' and column_name in ('water_mode','water_times','custom','sent')`) === '0'
    && sqlVal(`select to_regprocedure('public.reminders_keys(time[],time[],jsonb)') is null and to_regprocedure('public.reminders_slot_due(timestamptz,text,time,jsonb,text,smallint[])') is null`) === 't');
  let g = await a.c.rpc('reminders_get');
  check('after rollback reminders_get / reminders_set work with the old keys (settings kept)', !g.error && g.data.saved === true && !('custom' in g.data) && !(await set(a, { water_on: true })).error, errText(g));
  check('after rollback: grants as before (members: get/set only, service_role: due)', !!(await a.c.rpc('reminders_due')).error && !(await L.admin.rpc('reminders_due')).error);
  check('after rollback: the cron job and the older columns are untouched', sqlVal(`select count(*) from cron.job where jobname = 'gymquest-reminders'`) === '1'
    && sqlVal(`select count(*) from information_schema.columns where table_name = 'push_reminders' and column_name in ('water_on','last_meal','workout_time')`) === '3');
  const twice = (() => { try { L.sqlFile(path.join(REPO, 'supabase', 'rollback', '0019_down.sql')); return true; } catch (e) { return false; } })();
  check('the rollback is re-runnable without damage (version stays 10)', sqlVal('select public.community_social_version()') === '10' && twice);
  L.reapply(undone);
  check('re-applied: version 11 and the new columns are back, old row got the defaults', sqlVal('select public.community_social_version()') === '11'
    && sqlVal(`select water_mode || ':' || cardinality(water_times) || ':' || jsonb_array_length(custom) from public.push_reminders where user_id = ${lit(a.id)}`) === 'interval:0:0');
  let again = false;
  try { L.sqlFile(path.join(REPO, 'supabase', 'migrations', '0019_reminders_v2.sql')); } catch (e) { again = true; }
  check('applying 0019 twice is refused', again);
  g = await a.c.rpc('reminders_get');
  check('after re-apply the app can save and read the new keys', !(await set(a, { custom: [C1] })).error && (await customOf(a)).custom.length === 1);
});

scenario('cleanup and rollback', async () => {
  const a = await member('cl');
  await set(a, { water_on: true });
  const r = await L.admin.rpc('community_leave_cleanup', { p_user: a.id });
  check('leaving Community removes the reminders', !r.error && sqlVal(`select count(*) from public.push_reminders where user_id = ${lit(a.id)}`) === '0', errText(r));
  const undone = L.rollbackFrom(12);
  check('rolled back from 12 includes 0019 (newest first)', undone.some((m) => m.n === 19));
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
