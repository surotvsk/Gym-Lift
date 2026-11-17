'use strict';
/* 0022 phase badges: LOCAL DISPOSABLE stack only, initially through 0021 (version 13).
   No production URL is accepted by lib.js. Run serially: this temporarily changes the schema.
   Usage: node tests/social/phase-badges.js
   Removes its accounts and restores version 13, including on assertion failure. */
const path = require('path');
const L = require('./lib');
const { check, section, sql, sqlVal, lit, errText, results } = L;
const up = path.resolve(__dirname, '../../supabase/migrations/0022_phase_badges.sql');
const down = path.resolve(__dirname, '../../supabase/rollback/0022_down.sql');
const PHASE = ['phaseWarmup1', 'phaseStretch1'];
const users = [];
let upgraded = false;
const signatures = [
  'public.leaderboard_achievement_value_v2(text[],integer)', 'public.achievement_catalog()',
  'public.community_social_version()',
  'public.leaderboard_submit(integer,integer,text,integer,text[],integer)',
  'public.profile_achievements_set(text[],integer)', 'public.profile_achievements_get(uuid)',
];
const procList = signatures.map((s) => lit(s) + '::regprocedure').join(',');
const oldOnly = "id not in ('phaseWarmup1','phaseStretch1')";
const catalog = () => sqlVal(`select coalesce(jsonb_agg(to_jsonb(c) order by id), '[]')
  from public.achievement_catalog() c where ${oldOnly}`);
const values = () => sqlVal(`select jsonb_agg(jsonb_build_array(c.id, n,
  public.leaderboard_achievement_value_v2(array[c.id], n)) order by c.id, n)
  from public.achievement_catalog() c cross join generate_series(0, 300) n where ${oldOnly}`);
const acl = () => sqlVal(`select jsonb_object_agg(oid::regprocedure::text,
  jsonb_build_array(proacl, proowner, prosecdef, provolatile, proconfig))
  from pg_proc where oid in (${procList})`);
const rpcBodies = () => sqlVal(`select jsonb_object_agg(oid::regprocedure::text, pg_get_functiondef(oid))
  from pg_proc where oid in (${procList}) and proname not in
  ('leaderboard_achievement_value_v2','achievement_catalog','community_social_version')`);
const constraints = () => sqlVal(`select jsonb_object_agg(conname, pg_get_constraintdef(oid))
  from pg_constraint where conrelid = 'public.leaderboard_entries'::regclass
  and conname <> 'leaderboard_entries_achievement_xp_check'`);
const rows = () => sqlVal(`select coalesce(jsonb_agg(to_jsonb(e) order by user_id), '[]')
  from public.leaderboard_entries e`);
const row = (u) => JSON.parse(sqlVal(`select to_jsonb(e) from public.leaderboard_entries e
  where user_id = ${lit(u.id)}`));
const stableRow = (r) => {
  const { achievement_xp, total_xp, level, ...rest } = r;
  return JSON.stringify(rest);
};
const publish = (u, ids, workouts = 1, training = 100, week = 100) => u.c.rpc('leaderboard_submit', {
  p_training: training, p_week_training: week,
  p_week_key: sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`),
  p_workouts: workouts, p_achievements: ids, p_rules: 2,
});
const showcase = (u, ids, workouts = 1) => u.c.rpc('profile_achievements_set', {
  p_ids: ids, p_workouts: workouts,
});
const profileIds = (u) => JSON.parse(sqlVal(`select to_jsonb(ids) from public.profile_achievements
  where user_id = ${lit(u.id)}`));
function refused(name, query, pattern) {
  let error = '';
  try { sql(query); } catch (e) { error = String(e.stderr || e.message); }
  check(name, pattern.test(error), error);
}
async function probe(version) {
  const signed = await users[0].c.rpc('community_social_version');
  check('authenticated capability ' + version, !signed.error && signed.data === version, errText(signed));
  const anonymous = await L.anon().rpc('community_social_version');
  check('anonymous capability denied at ' + version, anonymous.error?.code === '42501', errText(anonymous));
  let output = '', error = '';
  try {
    output = sql(`begin; set local role authenticated;
      prepare gq_phase_probe as select public.community_social_version();
      execute gq_phase_probe; set local role anon; execute gq_phase_probe; rollback;`);
  } catch (e) { output = String(e.stdout || '').trim(); error = String(e.stderr || e.message); }
  check('prepared authenticated execution at ' + version, output === String(version), output);
  check('same prepared plan denies anon at ' + version,
    /permission denied for function community_social_version/.test(error), error);
}

(async () => {
  if (sqlVal('select public.community_social_version()') !== '13') {
    throw new Error('requires disposable local stack through 0021 / capability 13; do not auto-downgrade');
  }
  try {
    for (const name of ['max', 'mid', 'min', 'low']) {
      const u = await L.newUser('phase-badges-' + name);
      users.push(u);
      // Fresh isolated stacks need an active moderator before Community is eligible.
      // This fixture is deleted in finally; never depend on an existing owner's profile.
      if (users.length === 1) L.makeModerator(u);
      const joined = await u.c.rpc('community_join');
      if (joined.error) throw new Error('community_join: ' + errText(joined));
      const initial = await publish(u, []);
      if (initial.error) throw new Error('initial submit: ' + errText(initial));
    }
    const [max, mid, min, low] = users;
    const before = { catalog: catalog(), values: values(), acl: acl(), bodies: rpcBodies(), constraints: constraints() };
    section('capability 13 before upgrade');
    await probe(13);
    let r = await publish(low, PHASE);
    check('old leaderboard catalog ignores both phase IDs', !r.error && row(low).achievement_xp === 0, errText(r));
    r = await showcase(low, PHASE);
    check('old profile catalog ignores both phase IDs', !r.error && r.data.count === 0, errText(r));
    const beforeRows = rows();

    section('0022 additive upgrade');
    L.sqlFile(up); upgraded = true;
    sql("notify pgrst, 'reload schema';");
    check('upgrade preserves every existing leaderboard row', rows() === beforeRows);
    check('all old profile rows and values preserved', catalog() === before.catalog);
    check('all old leaderboard values/minimum counts preserved', values() === before.values);
    check('function ACLs, ownership, volatility, security and local paths preserved', acl() === before.acl);
    check('submit/profile RPC definitions unchanged', rpcBodies() === before.bodies);
    check('other constraints/caps unchanged', constraints() === before.constraints);
    await probe(14);
    let repeated = '';
    try { L.sqlFile(up); } catch (e) { repeated = String(e.stderr || e.message); }
    check('repeat migration specifically refuses version 14', /0022 already applied/.test(repeated), repeated);
    check('new profile rows are exactly 25 XP / minimum one', sqlVal(`select count(*) from
      public.achievement_catalog() where id in ('phaseWarmup1','phaseStretch1') and xp = 25 and min_workouts = 1`) === '2');
    for (const id of PHASE) {
      r = await publish(low, [id, id, 'unknown-phase']);
      check(id + ': 25 XP, duplicate/unknown ignored', !r.error && row(low).achievement_xp === 25, errText(r));
      r = await showcase(low, [id]);
      check(id + ': reaches profile publisher', !r.error && profileIds(low).join() === id, errText(r));
    }
    r = await publish(low, PHASE, 0);
    check('coarse minimum workout filter rejects both at zero', !r.error && row(low).achievement_xp === 0, errText(r));
    r = await showcase(low, PHASE, 0);
    check('profile minimum rejects both at zero', !r.error && r.data.count === 0, errText(r));
    r = await publish(low, PHASE);
    check('both badges total 50', !r.error && row(low).achievement_xp === 50, errText(r));
    r = await showcase(low, PHASE);
    check('both badges survive profile routing', !r.error && profileIds(low).length === 2, errText(r));
    const allIds = JSON.parse(sqlVal('select to_jsonb(array_agg(id)) from public.achievement_catalog()'));
    r = await publish(max, allIds, 300);
    check('all old plus both new achievements accepted at 5775', !r.error && row(max).achievement_xp === 5775, errText(r));
    refused('5776 rejected', `update public.leaderboard_entries set achievement_xp = 5776
      where user_id = ${lit(max.id)}`, /leaderboard_entries_achievement_xp_check/);
    refused('negative achievement XP still rejected', `update public.leaderboard_entries set achievement_xp = -1
      where user_id = ${lit(max.id)}`, /leaderboard_entries_achievement_xp_check/);

    section('existing training, weekly, peak and decrease rules');
    r = await publish(low, PHASE, 1, 2000, 2000);
    check('gain still capped at 300/day and accepted week gain', !r.error && r.data.capped === true &&
      row(low).training_xp === 400 && row(low).week_xp === 400, errText(r));
    r = await publish(low, [], 1, 50, 0);
    check('old-client-like lower totals accepted, peak retained', !r.error && row(low).training_xp === 50 &&
      row(low).training_peak === 400 && row(low).achievement_xp === 0, errText(r));
    r = await publish(low, PHASE, 1, 400, 400);
    check('return to previous peak free, badge aggregate resubmits', !r.error && row(low).training_xp === 400 &&
      row(low).day_gain === 300 && row(low).achievement_xp === 50, errText(r));
    sql(`update public.leaderboard_entries set day_key = null where user_id = ${lit(mid.id)};`);
    r = await publish(mid, [], 1, 1000001, 1001);
    check('baseline million and weekly thousand bounds unchanged', !r.error && row(mid).training_xp === 1000000 &&
      row(mid).training_peak === 1000000 && row(mid).week_xp === 1000, errText(r));

    section('rollback after high achievement aggregates exist');
    sql(`update public.leaderboard_entries set achievement_xp = 5750 where user_id = ${lit(mid.id)};
      update public.leaderboard_entries set achievement_xp = 5726 where user_id = ${lit(min.id)};`);
    const rollbackRows = users.map(row);
    const profileBefore = profileIds(low).join();
    L.sqlFile(down); upgraded = false;
    sql("notify pgrst, 'reload schema';");
    await probe(13);
    check('prior catalogs/values restored exactly', catalog() === before.catalog && values() === before.values);
    check('rollback preserves all privileges/RPCs/other caps', acl() === before.acl && rpcBodies() === before.bodies &&
      constraints() === before.constraints);
    for (let i = 0; i < users.length; i++) {
      const after = row(users[i]), previous = rollbackRows[i];
      check(users[i].tag + ': bounded achievement adjustment only',
        after.achievement_xp === Math.min(previous.achievement_xp, 5725) && stableRow(after) === stableRow(previous));
      check(users[i].tag + ': generated total/level follow achievement aggregate',
        after.total_xp === after.training_xp + after.achievement_xp &&
        after.level === Math.floor((Math.sqrt(4900 + 40 * after.total_xp) - 70) / 20));
    }
    check('sub-ceiling phase XP not falsely claimed removed', row(low).achievement_xp === 50);
    check('stored profile IDs not deleted by rollback', profileIds(low).join() === profileBefore);
    refused('5726 rejected after rollback', `update public.leaderboard_entries set achievement_xp = 5726
      where user_id = ${lit(max.id)}`, /leaderboard_entries_achievement_xp_check/);
    r = await publish(low, PHASE);
    check('next submit recalculates sub-ceiling badges to zero', !r.error && row(low).achievement_xp === 0, errText(r));
    r = await showcase(low, PHASE);
    check('next profile publication filters unsupported IDs', !r.error && r.data.count === 0, errText(r));

    section('reapply and resubmit');
    const rolledBack = rows();
    L.sqlFile(up); upgraded = true;
    sql("notify pgrst, 'reload schema';");
    check('reapply alone restores no removed aggregates', rows() === rolledBack);
    r = await publish(max, allIds, 300);
    check('updated client resubmission restores 5775', !r.error && row(max).achievement_xp === 5775, errText(r));
    r = await showcase(low, PHASE);
    check('profile badges publish again after capability returns', !r.error && r.data.count === 2, errText(r));
    await probe(14);
  } finally {
    // Delete only these fixtures BEFORE restoring 5725, avoiding a clamp on discarded fixture rows.
    try {
      for (const u of users) sql(`delete from auth.users where id = ${lit(u.id)};`);
    } finally {
      if (upgraded) { L.sqlFile(down); sql("notify pgrst, 'reload schema';"); }
    }
  }
  console.log('\n==== checks: ' + results.pass + ' passed, ' + results.fail + ' failed ====');
  process.exitCode = results.fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
