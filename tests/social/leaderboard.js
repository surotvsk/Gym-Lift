'use strict';
/* GymQuest leaderboard (migration 0009): limits, achievements, privacy, ranking, cleanup.
   LOCAL test stack only (lib.js refuses anything else); disposable local accounts.
   Usage: node tests/social/leaderboard.js [filter] */
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
const WEEK = sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`);
const OLD_WEEK = '2000-W01';
const ALL25 = ['first', 'five', 'ten', 'twentyfive', 'fifty', 'hundred', 'weeklygoal1', 'consistent2', 'consistent4',
  'consistent8', 'consistent12', 'solid2', 'solid4', 'fullweek', 'newpr', 'pr5', 'pr10', 'improve', 'xp200',
  'customplan', 'fourplans', 'customex5', 'variety4', 'comeback', 'missedweek'];

async function member(tag) {
  const u = await L.newUser('lb-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
const submit = (u, training, week, workouts, ach, weekKey) => u.c.rpc('leaderboard_submit',
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
  check('community_social_version() is 3 or later (4 = 0010)', Number(sqlVal('select public.community_social_version()')) >= 3);
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
  await submit(a, 0, 0, 10, ['first', 'hundred', 'made-up', 'first']);
  check('impossible "hundred" dropped, unknown id ignored, duplicate counted once', row(a).achievement === 25, J(row(a)));
  await submit(a, 0, 0, 100, ['first', 'hundred', 'consistent12']);
  check('hundred (750) + consistent12 (750) + first (25) with 100 workouts', row(a).achievement === 1525, J(row(a)));
  await submit(a, 0, 0, 100, ALL25);
  check('all 25 achievements = 5150, never limited by the daily cap', row(a).achievement === 5150 && row(a).level === 51, J(row(a)));
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
  check('level shown = floor(total/100)', b[0].level === 50, J(b[0]));
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

scenario('rollback 0009_down and re-apply', async () => {
  /* 0010 (push) builds on 0009: roll it back first and re-apply it afterwards. */
  const undone = L.rollbackFrom(9);   // 0010+ build on 0009: rolled back first, re-applied after
  check('after rollback: version 2', sqlVal('select public.community_social_version()') === '2');
  check('after rollback: table gone', sqlVal(`select to_regclass('public.leaderboard_entries') is null`) === 't');
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: (await member('rb')).id })).error);
  L.reapply(undone.slice(0, 1));
  check('re-applied: version 3', sqlVal('select public.community_social_version()') === '3');
  L.reapply(undone.slice(1));
  check('later migrations re-applied', Number(sqlVal('select public.community_social_version()')) === 2 + undone.length);
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
