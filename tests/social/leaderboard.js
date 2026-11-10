'use strict';
/* GymQuest leaderboard (migration 0009 + 0017 v2): limits, achievements, privacy, ranking, cleanup.
   LOCAL test stack only (lib.js refuses anything else); disposable local accounts.
   Usage: node tests/social/leaderboard.js [filter] */
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
const WEEK = sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`);
const OLD_WEEK = '2000-W01';
/* 0017: nové úspechy (spec 4.3), spolu 5 725 XP; staré id (ten, hundred, …) dávajú 0 */
const ALL_V2 = ['first', 'start3', 'goal1', 'goal4', 'goal12', 'goal26', 'streak4', 'streak8', 'streak12', 'streak26',
  'w10', 'w25', 'w50', 'w100', 'w250', 'pr1', 'pr10', 'pr25', 'steady5', 'back', 'rest5', 'ownplan', 'fullbody',
  'explorer10', 'body4', 'together', 'balanced10'];
const OLD25 = ['five', 'ten', 'twentyfive', 'fifty', 'hundred', 'weeklygoal1', 'consistent2', 'consistent4',
  'consistent8', 'consistent12', 'solid2', 'solid4', 'fullweek', 'newpr', 'pr5', 'improve', 'xp200',
  'customplan', 'fourplans', 'customex5', 'variety4', 'comeback', 'missedweek'];
const levelOf = (total) => Math.floor((Math.sqrt(4900 + 40 * total) - 70) / 20);

async function member(tag) {
  const u = await L.newUser('lb-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
/* nová appka (v101) posiela p_rules: 2; submitOld = staršia appka bez p_rules (5 argumentov) */
const submit = (u, training, week, workouts, ach, weekKey) => u.c.rpc('leaderboard_submit',
  { p_training: training, p_week_training: week, p_week_key: weekKey || WEEK, p_workouts: workouts || 0, p_achievements: ach || [], p_rules: 2 });
const submitOld = (u, training, week, workouts, ach, weekKey) => u.c.rpc('leaderboard_submit',
  { p_training: training, p_week_training: week, p_week_key: weekKey || WEEK, p_workouts: workouts || 0, p_achievements: ach || [] });
const row = (u) => {
  const v = sqlVal(`select training_xp||'|'||achievement_xp||'|'||total_xp||'|'||level||'|'||week_xp from public.leaderboard_entries where user_id = ${lit(u.id)}`);
  if (!v) return null;
  const [training, achievement, total, level, week] = v.split('|').map(Number);
  return { training, achievement, total, level, week };
};
const resetDay = (u) => sql(`update public.leaderboard_entries set day_key = day_key - 1 where user_id = ${lit(u.id)};`);
const board = async (u, period) => { const r = await u.c.rpc('leaderboard_top', { p_period: period || 'all' }); return r.error ? r : r.data; };
const ids = (b) => (Array.isArray(b) ? b.filter((x) => !x.is_me || x.pos <= 20).map((x) => x.user_id) : []);

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('version and access', async () => {
  check('community_social_version() is 9 or later (9 = 0017)', Number(sqlVal('select public.community_social_version()')) >= 9);
  const a = await member('acc');
  const anon = await L.anon().rpc('leaderboard_top', { p_period: 'all' });
  check('anon cannot read the leaderboard', !!anon.error, J(anon));
  const direct = await a.c.from('leaderboard_entries').select('*');
  check('no direct table read for members', !!direct.error, J(direct));
  const ins = await a.c.from('leaderboard_entries').insert({ user_id: a.id, training_xp: 99999 });
  check('no direct table write for members', !!ins.error, J(ins));
  const out = await L.newUser('lb-outsider');   // never joined Community
  const s = await submit(out, 100, 100);
  check('non-member cannot submit', !!s.error, J(s));
});

scenario('baseline, daily and weekly limits, decrease, week key mismatch', async () => {
  const a = await member('lim');
  let r = await submit(a, 9000, 1200, 200);
  check('baseline: first submission accepted in full', !r.error && row(a).training === 9000, J(r) + J(row(a)));
  check('baseline: week XP capped at 1000', row(a).week === 1000, J(row(a)));
  resetDay(a);
  r = await submit(a, 10000, 1200, 200);
  check('daily limit: +1000 counts as +300', !r.error && row(a).training === 9300 && r.data.capped === true, J(r) + J(row(a)));
  r = await submit(a, 10100, 1200, 200);
  check('daily limit: no more on the same day', row(a).training === 9300, J(row(a)));
  r = await submit(a, 9200, 1100, 200);
  check('decrease: a deleted workout lowers the value at once', row(a).training === 9200 && row(a).week === 1000, J(row(a)));
  r = await submit(a, 9250, 50, 200, [], OLD_WEEK);
  check('week key mismatch: week XP kept, not zeroed', row(a).week === 1000, J(row(a)));
  const b = await member('wk');
  await submit(b, 100, 100, 2);
  resetDay(b);
  await submit(b, 400, 400, 8);
  check('week XP follows accepted gains (+300)', row(b).week === 400 && row(b).training === 400, J(row(b)));
});

scenario('achievements computed on the server', async () => {
  const a = await member('ach');
  await submit(a, 0, 0, 10, ['first', 'w100', 'made-up', 'first']);
  check('impossible "w100" dropped, unknown id ignored, duplicate counted once', row(a).achievement === 25, J(row(a)));
  await submit(a, 0, 0, 100, ['first', 'w100', 'streak12']);
  check('w100 (600) + streak12 (450) + first (25) with 100 workouts', row(a).achievement === 1075, J(row(a)));
  await submit(a, 0, 0, 300, ALL_V2);
  check('all 27 new achievements = 5725, never limited by the daily cap', row(a).achievement === 5725 && row(a).level === levelOf(5725), J(row(a)));
  await submit(a, 0, 0, 300, OLD25.concat(['first']));
  check('old achievement ids give 0 XP (only first counts)', row(a).achievement === 25, J(row(a)));
  await submit(a, 0, 0, 0, ['body4', 'first', 'w10', 'start3']);
  check('guards: body4 needs no workouts, first/w10/start3 need 1/10/3', row(a).achievement === 50, J(row(a)));
});

scenario('level formula boundaries (0017)', async () => {
  const a = await member('lvl');
  await submit(a, 0, 0, 0);
  const cases = [[0, 0], [79, 0], [80, 1], [179, 1], [180, 2], [2939, 13], [2940, 14], [10439, 28], [10440, 29]];
  for (const [total, lvl] of cases) {
    sql(`update public.leaderboard_entries set training_xp = ${total}, achievement_xp = 0 where user_id = ${lit(a.id)};`);
    check('total ' + total + ' = level ' + lvl, row(a).level === lvl && lvl === levelOf(total), J(row(a)));
  }
  sql(`update public.leaderboard_entries set training_xp = 3000, achievement_xp = 150 where user_id = ${lit(a.id)};`);
  check('level uses training + achievement XP (3150 = L14, L15 starts at 3300)', row(a).total === 3150 && row(a).level === 14, J(row(a)));
  let refused = false;
  try { sql(`update public.leaderboard_entries set achievement_xp = 5726 where user_id = ${lit(a.id)};`); } catch (e) { refused = true; }
  check('achievement_xp above 5725 is refused by the check', refused && row(a).achievement === 150, J(row(a)));
});

scenario('older app (no p_rules) cannot overwrite recalculated XP (0017)', async () => {
  const a = await member('old');
  await submit(a, 600, 200, 12, ['first']);
  const before = row(a);
  sql(`update public.leaderboard_entries set updated_at = now() - interval '1 hour' where user_id = ${lit(a.id)};`);
  const r = await submitOld(a, 9000, 900, 50, ['first', 'ten', 'hundred']);
  check('old 5-argument call raises no error and returns the stored row', !r.error && r.data.total_xp === before.total && r.data.level === before.level && r.data.week_xp === before.week, J(r));
  check('old call changed nothing (training, achievements, week)', J(row(a)) === J(before), J(row(a)) + J(before));
  check('old call only touched updated_at', sqlVal(`select updated_at > now() - interval '1 minute' from public.leaderboard_entries where user_id = ${lit(a.id)}`) === 't');
  const r2 = await submitOld(a, 0, 0, 0);
  check('old call with lower values changes nothing either', !r2.error && J(row(a)) === J(before), J(row(a)));
  const n = await member('old-new');
  const r3 = await submitOld(n, 500, 500, 5);
  check('old call without a row creates none and returns zeros', !r3.error && r3.data.total_xp === 0 && row(n) === null, J(r3) + J(row(n)));
  const out = await L.newUser('lb-old-out');
  check('old call by a non-member is still refused', !!(await submitOld(out, 1, 1, 1)).error);
  const six = await a.c.rpc('leaderboard_submit', { p_training: 700, p_week_training: 300, p_week_key: WEEK, p_workouts: 12, p_achievements: ['first'], p_rules: 2 });
  check('p_rules = 2 afterwards works normally (+100 above peak, within the 300 limit)', !six.error && row(a).training === 700, J(six) + J(row(a)));
});

scenario('p_rules = 2: lower recalculated value accepted, gains limited, re-baseline by 0017', async () => {
  const a = await member('rb2');
  await submit(a, 9000, 800, 80);
  resetDay(a);
  const r = await submit(a, 4000, 300, 80);
  check('recalculated (lower) value accepted at once', !r.error && row(a).training === 4000 && row(a).week === 300, J(r) + J(row(a)));
  resetDay(a);
  await submit(a, 4500, 300, 80);
  check('gain back up to the old peak stays free (stale phone rule from 0009)', row(a).training === 4500, J(row(a)));
  /* 0017 re-baselines rows that exist before it: day_key null, peak = training, first p_rules=2 submit = baseline */
  const undone = L.rollbackFrom(17);
  const b = await member('rb2-b');
  await submitOld(b, 9000, 800, 80, ['first']);
  check('after rollback an old 5-argument call writes the 0009 way', !!row(b) && row(b).training === 9000 && row(b).level === Math.floor(row(b).total / 100), J(row(b)));
  L.reapply(undone);
  check('0017 re-baselined the existing row (day_key empty, peak = training)', sqlVal(`select (day_key is null)||'|'||(training_peak = training_xp) from public.leaderboard_entries where user_id = ${lit(b.id)}`) === 'true|true');
  const r2 = await submit(b, 3000, 300, 80, ['first']);
  check('first p_rules = 2 submit after 0017 takes the recalculated value (3000 < 9000)', !r2.error && row(b).training === 3000, J(r2) + J(row(b)));
  check('peak follows the recalculated value', sqlVal(`select training_peak from public.leaderboard_entries where user_id = ${lit(b.id)}`) === '3000');
  resetDay(b);
  await submit(b, 5000, 300, 80, ['first']);
  check('later gains above the recalculated peak are limited again (+300)', row(b).training === 3300, J(row(b)));
});

scenario('privacy: hidden, suspended, non-member, blocked, moderator removal', async () => {
  sql('delete from public.leaderboard_entries;');
  const me = await member('pv-me'), hid = await member('pv-hid'), sus = await member('pv-sus');
  const left = await member('pv-left'), blk = await member('pv-blk'), rem = await member('pv-rem');
  const mod = await member('pv-mod'); L.makeModerator(mod);
  for (const [u, xp] of [[me, 100], [hid, 200], [sus, 300], [left, 400], [blk, 500], [rem, 600]]) await submit(u, xp, xp, 1);
  await hid.c.rpc('leaderboard_set_hidden', { p_hidden: true });
  sql(`update public.profiles set suspended = true where id = ${lit(sus.id)};`);
  sql(`update public.profiles set community_joined_at = null where id = ${lit(left.id)};`);
  const bl = await blk.c.from('blocks').insert({ blocker_id: blk.id, blocked_id: me.id });
  check('block created (blk blocks me)', !bl.error, J(bl.error));
  const notMod = await me.c.rpc('leaderboard_moderate', { p_user: rem.id, p_removed: true });
  check('non-moderator cannot remove', !!notMod.error, J(notMod));
  const m = await mod.c.rpc('leaderboard_moderate', { p_user: rem.id, p_removed: true });
  check('moderator removes', !m.error, J(m));
  check('removal recorded in moderation history', sqlVal(`select count(*) from public.moderation_actions where user_id = ${lit(rem.id)} and action = 'leaderboard_remove'`) === '1');
  const b = await board(me);
  const seen = ids(b);
  check('me is on the board', seen.indexOf(me.id) >= 0, J(b));
  check('hidden, suspended, non-member, blocked-by and removed are not', [hid, sus, left, blk, rem].every((u) => seen.indexOf(u.id) < 0), J(b));
  const meInfo = await hid.c.rpc('leaderboard_me');
  check('leaderboard_me reports hidden', !meInfo.error && meInfo.data.hidden === true && meInfo.data.member === true, J(meInfo));
  const remInfo = await rem.c.rpc('leaderboard_me');
  check('leaderboard_me reports removed', !remInfo.error && remInfo.data.removed === true, J(remInfo));
  await mod.c.rpc('leaderboard_moderate', { p_user: rem.id, p_removed: false });
  check('moderator restores', ids(await board(me)).indexOf(rem.id) >= 0);
  await hid.c.rpc('leaderboard_set_hidden', { p_hidden: false });
  check('Show me again puts the member back', ids(await board(me)).indexOf(hid.id) >= 0);
});

scenario('ranking: ties, week tab, own rank outside the top 20', async () => {
  sql('delete from public.leaderboard_entries;');
  const me = await member('rk-me');
  await submit(me, 50, 50, 1);
  const others = [];
  for (let i = 0; i < 21; i++) { const u = await member('rk' + i); await submit(u, 1000 + i * 10, 100, 5); others.push(u); }
  const t1 = others[0], t2 = others[1];
  sql(`update public.leaderboard_entries set training_xp = 5000, reached_at = now() - interval '2 hours' where user_id = ${lit(t2.id)};`);
  sql(`update public.leaderboard_entries set training_xp = 5000, reached_at = now() - interval '1 hour' where user_id = ${lit(t1.id)};`);
  const b = await board(me, 'all');
  check('board: 20 rows plus own row', Array.isArray(b) && b.length === 21, J(b && b.length));
  check('tie: the earlier one ranks first', b[0].user_id === t2.id && b[1].user_id === t1.id, J(b.slice(0, 2)));
  const mine = b.find((x) => x.is_me);
  check('own row outside the top 20 is returned with its real rank', !!mine && mine.pos === 22, J(mine));
  check('level shown = new curve (5000 XP = L19)', b[0].level === levelOf(5000) && b[0].level === 19, J(b[0]));
  sql(`update public.leaderboard_entries set week_key = ${lit(OLD_WEEK)} where user_id = ${lit(t2.id)};`);
  const w = await board(me, 'week');
  check('week tab: last week\'s rows are left out', ids(w).indexOf(t2.id) < 0, J(w.slice(0, 3)));
  check('week tab ranks week XP', w[0].xp === 100, J(w[0]));
});

scenario('leave Community and account deletion remove the row', async () => {
  const a = await member('del-a'), b = await member('del-b');
  await submit(a, 100, 100, 1); await submit(b, 100, 100, 1);
  const c = await L.admin.rpc('community_leave_cleanup', { p_user: a.id });
  check('leave cleanup runs', !c.error, J(c));
  check('leave removes the row', row(a) === null);
  const d = await L.admin.auth.admin.deleteUser(b.id);
  check('account deletion cascades', !d.error && row(b) === null, J(d.error));
});

scenario('review fixes: stale device, early row, rejoin, RLS', async () => {
  check('leaderboard_entries has RLS enabled', sqlVal(`select relrowsecurity from pg_class where oid = 'public.leaderboard_entries'::regclass`) === 't');
  const a = await member('fx-stale');
  await submit(a, 9000, 100, 200);
  resetDay(a);
  await submit(a, 0, 0, 0);
  check('stale device: an empty phone lowers the board to 0', row(a).training === 0, J(row(a)));
  await submit(a, 9000, 100, 200);
  check('stale device: back up to the earlier peak at once (not +300)', row(a).training === 9000, J(row(a)));
  await submit(a, 10000, 100, 200);
  check('above the peak the daily limit still applies (+300)', row(a).training === 9300, J(row(a)));
  const b = await member('fx-early');
  await b.c.rpc('leaderboard_set_hidden', { p_hidden: true });
  await b.c.rpc('leaderboard_set_hidden', { p_hidden: false });
  await submit(b, 9000, 100, 200);
  check('a row created by Show me / hide keeps the full baseline', row(b).training === 9000, J(row(b)));
  const c = await member('fx-rejoin');
  const mod = await member('fx-mod'); L.makeModerator(mod);
  await submit(c, 500, 100, 5);
  await mod.c.rpc('leaderboard_moderate', { p_user: c.id, p_removed: true });
  await L.admin.rpc('community_leave_cleanup', { p_user: c.id });
  await c.c.rpc('community_join');
  await submit(c, 2000000000, 100, 5);
  const me = await c.c.rpc('leaderboard_me');
  check('leave and rejoin does not undo a moderator removal', !me.error && me.data.removed === true, J(me));
  check('first submission is bounded (at most 1,000,000 training XP)', row(c).training <= 1000000, J(row(c)));
});

scenario('rollback 0017_down and re-apply', async () => {
  const undone = L.rollbackFrom(17);
  check('0017 rolled back: version 8', sqlVal('select public.community_social_version()') === '8');
  check('v2 achievement function gone, only the 5-argument submit remains', sqlVal(`select to_regprocedure('public.leaderboard_achievement_value_v2(text[],integer)') is null and to_regprocedure('public.leaderboard_submit(integer,integer,text,integer,text[],integer)') is null and to_regprocedure('public.leaderboard_submit(integer,integer,text,integer,text[])') is not null`) === 't');
  const a = await member('rb17');
  const r = await submitOld(a, 9000, 800, 100, ['first', 'ten', 'hundred']);
  check('old behaviour: old achievement ids count (25+100+750), level = total/100', !r.error && row(a).achievement === 875 && row(a).level === Math.floor(row(a).total / 100) && row(a).level === 98, J(r) + J(row(a)));
  sql(`update public.leaderboard_entries set achievement_xp = 5100 where user_id = ${lit(a.id)};`);
  L.reapply(undone);
  // 0017 a všetko novšie (0018 → 10) sa vráti; verzia je tá pred rollbackom.
  check('re-applied: version restored (' + undone.versionBefore + ')', Number(undone.versionBefore) >= 9 && sqlVal('select public.community_social_version()') === undone.versionBefore);
  check('re-applied: level follows the new curve again', row(a).level === levelOf(row(a).total), J(row(a)));
  const n = await member('rb17-n');
  await submit(n, 600, 100, 12, ['first', 'w10']);
  check('re-applied: p_rules = 2 behaves as before (first 25 + w10 100 = 125 achievement XP)', row(n).training === 600 && row(n).achievement === 125, J(row(n)));
  const o = await submitOld(n, 5, 5, 1);
  check('re-applied: old call is a no-op again', !o.error && row(n).training === 600, J(o) + J(row(n)));
  const grants = sqlVal(`select has_function_privilege('anon', 'public.leaderboard_submit(integer,integer,text,integer,text[],integer)', 'execute')||'|'||has_function_privilege('authenticated', 'public.leaderboard_submit(integer,integer,text,integer,text[],integer)', 'execute')||'|'||has_function_privilege('authenticated', 'public.leaderboard_achievement_value_v2(text[],integer)', 'execute')`);
  check('privileges: anon no, authenticated yes for submit, no for the v2 table function', grants === 'false|true|false', grants);
});

scenario('rollback 0009_down and re-apply', async () => {
  /* 0010 (push) builds on 0009: roll it back first and re-apply it afterwards. */
  const undone = L.rollbackFrom(9);   // 0010+ build on 0009: rolled back first, re-applied after
  check('after rollback: version 2', sqlVal('select public.community_social_version()') === '2');
  check('after rollback: table gone', sqlVal(`select to_regclass('public.leaderboard_entries') is null`) === 't');
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: (await member('rb')).id })).error);
  L.reapply(undone.slice(0, 1));
  check('re-applied: version 3', sqlVal('select public.community_social_version()') === '3');
  L.reapply(undone.slice(1));
  check('later migrations re-applied', sqlVal('select public.community_social_version()') === undone.versionBefore);
});

(async () => {
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
