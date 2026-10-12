# Community Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Community "Top 20" leaderboard ranked by XP and level, with All-time and This-week tabs. The board resists fake XP and keeps members' privacy.

**Architecture:**
- Migration `0009_leaderboard.sql` adds `leaderboard_entries` with no direct table access, and SECURITY DEFINER functions:
  - `leaderboard_submit` applies the limits. It computes achievement XP on the server from ids.
  - `leaderboard_top` reads the board, `leaderboard_me` returns the caller's own row, and `leaderboard_set_hidden` / `leaderboard_moderate` change visibility.
  - `community_social_version()` becomes 3.
- The app reports XP: a debounced send hooked into `saveState()`, plus a send when Community opens. It shows a 6th Community nav item, "Top 20", only when version ≥ 3.

**Tech Stack:**
- Postgres / Supabase on the local stack `gqtest` through Docker.
- Vanilla JS in `script.js`.
- Node test scripts: `tests/social/lib.js` for SQL and users, and headless Chrome through `tests/sync/lib.js`.

**Spec:** `docs/superpowers/specs/2026-10-12-leaderboard-design.md`

## Global Constraints

- Who appears: all Community members (`community_joined_at` not null), opt out through "Show me on the leaderboard". The default is shown.
- Tabs: **All time** = total XP (training + achievements) and level = floor(total/100). **This week** = training XP (workouts + activities) in the current ISO week.
- Daily limit: **300** training XP per server UTC date. Weekly limit: **1,000** training XP per ISO week. Achievements are never limited.
- Achievement XP is computed on the server from ids, maximum **5,150**. Achievements that cannot be earned yet are dropped using the `workout_count` table in the spec.
- The first submission is accepted as the baseline. A decrease is accepted. Limits never change the app's own XP.
- Exclusions: hidden, removed by a moderator, suspended, non-member, blocked in either direction.
- Ties: earlier `reached_at` ranks first.
- Release order: the app first (it shows the board only on version ≥ 3), then the migration. Rollback: `supabase/rollback/0009_down.sql`.
- Server tests run **only on the local stack**. Never production, never the permanent accounts `gqsync-c`, `gqsocial-a`, `gqsocial-b`.
- All strings in 6 languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar`). Arabic wraps Latin runs in `⁦…⁩`. Code comments in Slovak.
- Each release bumps `CACHE_VERSION` and `?v=` together.
- Commit locally per task. **Push only when the owner says so.**

## Review Focus

1. **A member with a long history joins** (first submit 9,000 training XP). Expected: accepted in full as the baseline, not capped to 300. Pinned in Task 1 "baseline".
2. **The device's week differs from the server's week near Sunday midnight** (`p_week_key` ≠ server week). Expected: the stored week XP is kept and not zeroed; it is never lost. Pinned in Task 1 "week key mismatch".
3. **A workout is deleted** (training XP goes down). Expected: the board shows the lower value immediately, and the daily allowance is not consumed. Pinned in Task 1 "decrease".
4. **The viewer is hidden or removed by a moderator.** Expected: they are not on the board; their own view shows the hidden state with **Show me**, or the "removed by a moderator" note, never an error. Pinned in Task 4 "hidden state".
5. **A 320 px phone with 6 Community nav buttons.** Expected: no horizontal page overflow; labels may truncate with an ellipsis. Pinned in Task 4 "narrow phone".

## Rulings already taken (from the code, against the spec text)

- The spec says the switch is under "Settings → Community". In the app, "Show me in search" lives in **Community → Profile → Privacy**, so the leaderboard switch goes there, next to it.
- The spec says "a Feed / Leaderboard switch at the top". The Community tab's top navigation is `.cnav`, so the board is a 6th `.cnav` item, **"Top 20"** (trophy icon). It is not a second row of tabs.
- `community_leave_cleanup` (called by the existing `delete-account` function) gets one extra `delete`. The Edge Function itself does not change, so it does not need redeploying.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0009_leaderboard.sql` (create) | Table, functions, privileges, version 3, cleanup and moderation constraint |
| `supabase/rollback/0009_down.sql` (create) | Exact return to 0008 |
| `tests/social/leaderboard.js` (create) | Server rules on the local stack |
| `tests/social/ui-leaderboard.js` (create) | The app in headless Chrome against the local stack |
| `script.js` (modify) | XP payload and debounced send; leaderboard view, nav item, privacy switch, moderator action; i18n |
| `style.css` (modify) | `.lb-*` table styles |
| `tests/social/README.md`, `supabase/README.md`, `README.md`, `CLAUDE.md` (modify) | Docs and release steps |
| `sw.js`, `index.html` (modify) | Release bump |

Environment used by every test command below (the local stack's own keys; nothing from production):

```bash
SB=/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/release1-local-test/scratchpad/sbtest
eval "$(cd $SB && npx supabase status -o env | sed -n 's/^ANON_KEY=/export GQ_LOCAL_ANON=/p; s/^SERVICE_ROLE_KEY=/export GQ_LOCAL_SERVICE=/p')"
export GQ_LOCAL_URL=http://127.0.0.1:54321 GQ_LOCAL_DB=supabase_db_gqtest
export GQ_WORK=/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gq-media-work/social   # not /tmp (user quota)
```

---

## Task 0: Bring the local stack to 0008 (setup, no commit)

- [ ] **Step 1: Check the state.** Run `docker exec supabase_db_gqtest psql -U postgres -At -c "select public.community_social_version(), to_regclass('public.friendships') is not null;"`. Expected: `1|f`, meaning 0005 is applied and 0008 is not.
- [ ] **Step 2: Enable pg_cron and apply 0006 + 0008.** Run `docker exec supabase_db_gqtest psql -U postgres -c "create extension if not exists pg_cron;"`, then `node -e "const L=require('./tests/social/lib');L.sqlFile('supabase/migrations/0006_delete_account_grants.sql')"` (0006 is idempotent grants; if it reports "already exists", continue), then `node -e "const L=require('./tests/social/lib');L.sqlFile('supabase/migrations/0008_social_phase2.sql')"`.
- [ ] **Step 3: Verify.** Rerun the Step 1 query. Expected: `2|t`. Then `node tests/social/phase2.js "search"`. Expected: all PASS (proves the 0008 baseline works).

---

## Task 1: Migration 0009 and server rules

**Files:** Create `tests/social/leaderboard.js` and `supabase/migrations/0009_leaderboard.sql`.

**Interfaces (produces):**
- `leaderboard_submit(p_training integer, p_week_training integer, p_week_key text, p_workouts integer, p_achievements text[]) returns jsonb {total_xp, level, week_xp, capped}`
- `leaderboard_top(p_period text) returns table (pos integer, user_id uuid, username text, avatar_path text, level integer, xp integer, is_me boolean)`. `p_period` is `'all' | 'week'`, and the result has at most 20 rows plus the caller's own row.
- `leaderboard_me() returns jsonb {member boolean, hidden boolean, removed boolean}`
- `leaderboard_set_hidden(p_hidden boolean) returns void`
- `leaderboard_moderate(p_user uuid, p_removed boolean) returns void`
- `leaderboard_achievement_value(p_ids text[], p_workouts integer) returns integer` (internal)
- `community_social_version()` = 3

- [ ] **Step 1: Write the failing server test** `tests/social/leaderboard.js`:

```js
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
  check('community_social_version() is 3', sqlVal('select public.community_social_version()') === '3');
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
  await me.c.from('blocks').insert({ blocker_id: blk.id, blocked_id: me.id });
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

(async () => {
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node tests/social/leaderboard.js` (with the env from the top). Expected: FAIL. `community_social_version() is 3` fails, and the scenarios error with `PGRST202` / function `leaderboard_submit` not found.

- [ ] **Step 3: Write `supabase/migrations/0009_leaderboard.sql`:**

```sql
-- GymQuest Community — migration 0009: leaderboard (top 20 by XP)
--
-- One row per Community member with training XP (workouts + activities) and achievement XP.
-- The app reports its XP through leaderboard_submit(); the server applies the limits and
-- computes achievement XP itself from the earned ids. Members appear by default and can hide
-- themselves; moderators can remove a member from the board. community_social_version() = 3.
-- Needs 0005, 0006 and 0008. Run once, as one transaction. Rollback: supabase/rollback/0009_down.sql.
begin;

do $$
begin
  if to_regclass('public.friendships') is null then raise exception '0009 needs 0008 first'; end if;
  if to_regclass('public.leaderboard_entries') is not null then raise exception '0009 is already applied'; end if;
end $$;

create table public.leaderboard_entries (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  training_xp          integer not null default 0 check (training_xp >= 0),
  achievement_xp       integer not null default 0 check (achievement_xp between 0 and 5150),
  total_xp             integer generated always as (training_xp + achievement_xp) stored,
  level                integer generated always as ((training_xp + achievement_xp) / 100) stored,
  week_key             text not null default '',
  week_xp              integer not null default 0 check (week_xp between 0 and 1000),
  day_key              date,
  day_gain             integer not null default 0,
  reached_at           timestamptz not null default now(),
  hidden               boolean not null default false,
  removed_by_moderator boolean not null default false,
  updated_at           timestamptz not null default now()
);
create index leaderboard_total_idx on public.leaderboard_entries (total_xp desc, reached_at);

-- Achievement XP: the app's 25 achievements, their XP and the workouts each needs at least.
create function public.leaderboard_achievement_value(p_ids text[], p_workouts integer)
returns integer language sql immutable set search_path = public as $$
  select coalesce(sum(a.xp), 0)::integer
    from (values ('first', 25, 1), ('five', 50, 5), ('ten', 100, 10), ('twentyfive', 200, 25),
                 ('fifty', 350, 50), ('hundred', 750, 100), ('weeklygoal1', 75, 1), ('consistent2', 125, 2),
                 ('consistent4', 300, 4), ('consistent8', 500, 8), ('consistent12', 750, 12), ('solid2', 125, 2),
                 ('solid4', 300, 4), ('fullweek', 200, 1), ('newpr', 75, 1), ('pr5', 150, 1), ('pr10', 300, 1),
                 ('improve', 100, 1), ('xp200', 0, 0), ('customplan', 50, 0), ('fourplans', 100, 0),
                 ('customex5', 125, 0), ('variety4', 150, 1), ('comeback', 100, 1), ('missedweek', 150, 1))
         as a(id, xp, min_workouts)
   where a.id = any (coalesce(p_ids, '{}'::text[])) and coalesce(p_workouts, 0) >= a.min_workouts;
$$;

create function public.leaderboard_submit(p_training integer, p_week_training integer, p_week_key text,
                                          p_workouts integer, p_achievements text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  v_today     date := (now() at time zone 'utc')::date;
  v_week      text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  v_training  integer := greatest(coalesce(p_training, 0), 0);
  v_week_in   integer := greatest(coalesce(p_week_training, 0), 0);
  v_ach       integer := public.leaderboard_achievement_value(p_achievements, greatest(coalesce(p_workouts, 0), 0));
  v_row       public.leaderboard_entries;
  v_day_gain  integer;
  v_gain      integer := 0;
  v_new       integer;
  v_prev_week integer;
  v_week_val  integer;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if not public.community_eligible()
     or not exists (select 1 from public.profiles where id = v_me and community_joined_at is not null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_row from public.leaderboard_entries where user_id = v_me for update;
  if not found then   -- first submission: the baseline is accepted as reported
    insert into public.leaderboard_entries (user_id, training_xp, achievement_xp, week_key, week_xp, day_key, day_gain)
    values (v_me, v_training, v_ach, v_week, case when p_week_key = v_week then least(v_week_in, 1000) else 0 end, v_today, 0)
    returning * into v_row;
    return jsonb_build_object('total_xp', v_row.total_xp, 'level', v_row.level, 'week_xp', v_row.week_xp, 'capped', false);
  end if;
  v_day_gain := case when v_row.day_key = v_today then v_row.day_gain else 0 end;
  if v_training <= v_row.training_xp then
    v_new := v_training;                                    -- same or lower (deleted workout): accepted
  else
    v_gain := least(v_training - v_row.training_xp, greatest(300 - v_day_gain, 0));
    v_new := v_row.training_xp + v_gain;
  end if;
  v_prev_week := case when v_row.week_key = v_week then v_row.week_xp else 0 end;
  if p_week_key is distinct from v_week then v_week_val := v_prev_week;      -- device week differs: keep
  elsif v_week_in <= v_prev_week then v_week_val := v_week_in;
  else v_week_val := least(v_week_in, 1000, v_prev_week + v_gain);
  end if;
  update public.leaderboard_entries
     set training_xp = v_new, achievement_xp = v_ach, week_key = v_week, week_xp = v_week_val,
         day_key = v_today, day_gain = v_day_gain + v_gain,
         reached_at = case when v_new + v_ach > v_row.total_xp then now() else v_row.reached_at end,
         updated_at = now()
   where user_id = v_me
  returning * into v_row;
  return jsonb_build_object('total_xp', v_row.total_xp, 'level', v_row.level, 'week_xp', v_row.week_xp,
                            'capped', v_new < v_training);
end;
$$;

create function public.leaderboard_top(p_period text)
returns table (pos integer, user_id uuid, username text, avatar_path text, level integer, xp integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me   uuid := auth.uid();
  v_week text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
begin
  if v_me is null or not public.community_eligible() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_period not in ('all', 'week') then raise exception 'invalid_period' using errcode = 'P0001'; end if;
  return query
  with board as (
    select e.user_id as uid, pr.username as uname, pr.avatar_path as avatar, e.level as lvl,
           case when p_period = 'all' then e.total_xp
                when e.week_key = v_week then e.week_xp else 0 end as points,
           e.reached_at as reached
      from public.leaderboard_entries e
      join public.profiles pr on pr.id = e.user_id
     where not e.hidden and not e.removed_by_moderator and not pr.suspended
       and pr.community_joined_at is not null
       and (e.user_id = v_me or not public.blocked_with(e.user_id))
  ), ranked as (
    select b.*, row_number() over (order by b.points desc, b.reached asc, b.uid) as rn
      from board b
     where p_period = 'all' or b.points > 0 or b.uid = v_me
  )
  select r.rn::integer, r.uid, r.uname, r.avatar, r.lvl, r.points, r.uid = v_me
    from ranked r
   where r.rn <= 20 or r.uid = v_me
   order by r.rn;
end;
$$;

create function public.leaderboard_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'member', exists (select 1 from public.profiles where id = auth.uid() and community_joined_at is not null),
    'hidden', coalesce((select hidden from public.leaderboard_entries where user_id = auth.uid()), false),
    'removed', coalesce((select removed_by_moderator from public.leaderboard_entries where user_id = auth.uid()), false));
$$;

create function public.leaderboard_set_hidden(p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and community_joined_at is not null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.leaderboard_entries (user_id, hidden) values (auth.uid(), coalesce(p_hidden, false))
  on conflict (user_id) do update set hidden = excluded.hidden, updated_at = now();
end;
$$;

-- moderation_actions gains two actions (same names in 0009_down are removed again).
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('approve', 'reject', 'remove', 'report_upheld', 'report_dismissed', 'suspend', 'unsuspend',
                    'leaderboard_remove', 'leaderboard_restore'));

create function public.leaderboard_moderate(p_user uuid, p_removed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'not_found' using errcode = 'P0001'; end if;
  insert into public.leaderboard_entries (user_id, removed_by_moderator) values (p_user, coalesce(p_removed, true))
  on conflict (user_id) do update set removed_by_moderator = excluded.removed_by_moderator, updated_at = now();
  insert into public.moderation_actions (user_id, action, moderator_id)
  values (p_user, case when coalesce(p_removed, true) then 'leaderboard_remove' else 'leaderboard_restore' end, auth.uid());
end;
$$;

-- Leave Community also removes the leaderboard row (full deletion cascades from auth.users).
create or replace function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  delete from public.leaderboard_entries where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 3 $$;

-- Privileges: no direct table access; functions for signed-in users only.
revoke all on public.leaderboard_entries from public, anon, authenticated;
revoke execute on function public.leaderboard_achievement_value(text[], integer) from public, anon, authenticated;
revoke execute on function public.leaderboard_submit(integer, integer, text, integer, text[]), public.leaderboard_top(text),
  public.leaderboard_me(), public.leaderboard_set_hidden(boolean), public.leaderboard_moderate(uuid, boolean)
  from public, anon;
grant execute on function public.leaderboard_submit(integer, integer, text, integer, text[]), public.leaderboard_top(text),
  public.leaderboard_me(), public.leaderboard_set_hidden(boolean), public.leaderboard_moderate(uuid, boolean)
  to authenticated;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
```

- [ ] **Step 4: Apply it to the local stack and run the test.** Run `node -e "require('./tests/social/lib').sqlFile('supabase/migrations/0009_leaderboard.sql')" && node tests/social/leaderboard.js`. Expected: all PASS, `0 failed`.
- [ ] **Step 5: Check that 0008 still works.** Run `node tests/social/phase2.js`. Expected: `0 failed` (the cleanup function change keeps every existing deletion).
- [ ] **Step 6: Commit.** Run `git add supabase/migrations/0009_leaderboard.sql tests/social/leaderboard.js && git commit -m "Leaderboard: migration 0009 (limits, server-side achievement XP, privacy) + server tests"`.

---

## Task 2: Rollback 0009_down

**Files:** Create `supabase/rollback/0009_down.sql`. Modify `tests/social/leaderboard.js` (add a scenario).

- [ ] **Step 1: Add the failing scenario.** Insert it before the runner in `tests/social/leaderboard.js`:

```js
scenario('rollback 0009_down and re-apply', async () => {
  L.sqlFile(require('path').join(__dirname, '..', '..', 'supabase', 'rollback', '0009_down.sql'));
  check('after rollback: version 2', sqlVal('select public.community_social_version()') === '2');
  check('after rollback: table gone', sqlVal(`select to_regclass('public.leaderboard_entries') is null`) === 't');
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: (await member('rb')).id })).error);
  L.sqlFile(require('path').join(__dirname, '..', '..', 'supabase', 'migrations', '0009_leaderboard.sql'));
  check('re-applied: version 3', sqlVal('select public.community_social_version()') === '3');
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node tests/social/leaderboard.js rollback`. Expected: FAIL (`ENOENT … 0009_down.sql`).
- [ ] **Step 3: Write `supabase/rollback/0009_down.sql`:**

```sql
-- Rollback of 0009 (leaderboard). One transaction. Leaderboard rows and the two leaderboard
-- moderation actions are deleted (there is nothing else to keep: XP lives in the app).
begin;
drop function if exists public.leaderboard_submit(integer, integer, text, integer, text[]);
drop function if exists public.leaderboard_top(text);
drop function if exists public.leaderboard_me();
drop function if exists public.leaderboard_set_hidden(boolean);
drop function if exists public.leaderboard_moderate(uuid, boolean);
drop function if exists public.leaderboard_achievement_value(text[], integer);
drop table if exists public.leaderboard_entries;
delete from public.moderation_actions where action in ('leaderboard_remove', 'leaderboard_restore');
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('approve', 'reject', 'remove', 'report_upheld', 'report_dismissed', 'suspend', 'unsuspend'));
create or replace function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 2 $$;
commit;
```

- [ ] **Step 4: Run the whole server suite.** Run `node tests/social/leaderboard.js`. Expected: `0 failed`. The rollback scenario ends re-applied, so the stack stays at 0009.
- [ ] **Step 5: Commit.** Run `git add supabase/rollback/0009_down.sql tests/social/leaderboard.js && git commit -m "Leaderboard: rollback 0009_down + test"`.

---

## Task 3: The app reports its XP

**Files:** Modify `script.js`: a new section after the `communityV2()` definition, a hook in `saveState()`, and a send in `renderCommunity()`. Create `tests/social/ui-leaderboard.js`.

**Interfaces:**
- Produces `leaderboardPayload()`, which returns `{ p_training, p_week_training, p_week_key, p_workouts, p_achievements }`.
- Produces `leaderboardEnabled()`, `leaderboardQueue()` and `leaderboardSend(force)`, which returns the rpc result or null.
- Produces `communityVersion` (now 3 on 0009).

- [ ] **Step 1: Write the failing UI test** `tests/social/ui-leaderboard.js`. Part 1 here; Task 4 adds more scenarios.

```js
'use strict';
/* GymQuest leaderboard (0009): the app in real headless Chrome against the LOCAL stack.
     GQ_COMMUNITY_CONFIG=<local community-config.js> node tests/social/ui-leaderboard.js [filter] */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-lb');
const PROFILES = path.join(WORK, 'profiles');
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
let nextPort = 9900;
const browsers = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name, width) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  if (width) await p.c.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  return p;
}
async function member(tag) {
  const u = await L.newUser('lbui-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join: ' + errText(j));
  return u;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(document.querySelector('.tab-bar [data-tab="komunita"]').click(), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion === 3`), 30000, 'profile v3');
}
async function finishWorkout(p) {
  await p.eval(`(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s);
    $('.tab-bar [data-tab="dnes"]').click(); await w(200); $('#btn-start-workout').click(); await w(400);
    for (const b of Array.from(document.querySelectorAll('#exercise-list .set-btn:not([disabled])'))) { b.click(); await w(50); }
    $('#btn-finish-workout').click(); await w(300); $('#btn-confirm-ok').click(); await w(800);
    for (let k = 0; k < 4; k++) for (const id of ['modal-generic', 'modal-levelup', 'modal-achievement']) { const m = document.getElementById(id); if (m && !m.hidden) { const x = m.querySelector('.btn-primary'); if (x) x.click(); await w(200); } }
    return true; })()`);
}
const serverRow = (u) => sqlVal(`select training_xp||'|'||achievement_xp||'|'||total_xp||'|'||level from public.leaderboard_entries where user_id = ${lit(u.id)}`);

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('reports XP after a workout', async () => {
  const u = await member('rep');
  const p = await device('rep');
  await signIn(p, u);
  await finishWorkout(p);
  const local = await p.eval(`(() => { const x = leaderboardPayload(); const li = levelInfo(); return { training: x.p_training, xp: li.xp, level: li.level }; })()`);
  await waitFor(() => { const r = serverRow(u); return r && Number(r.split('|')[0]) === local.training; }, 20000, 'server row');
  const [training, ach, total, level] = serverRow(u).split('|').map(Number);
  check('server training XP = app workout+activity XP', training === local.training, J({ training, local }));
  check('server total and level = what the app shows', total === local.xp && level === local.level, J({ total, level, local }));
  check('no page errors', p.errors.length === 0, J(p.errors));
});

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
  }
  await server.close();
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and confirm it fails.** First write a local config: `printf "window.GYMQUEST_COMMUNITY = { supabaseUrl: '%s', supabaseAnonKey: '%s' };\n" "$GQ_LOCAL_URL" "$GQ_LOCAL_ANON" > $GQ_WORK/community-config.local.js`. Then run `GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-leaderboard.js reports`. Expected: FAIL (`leaderboardPayload is not defined` / `profile v3` timeout).
- [ ] **Step 3: Implement in `script.js`.** First change the comment on `let communityVersion` to `// 0 = nezistené, 1 = 0005, 2 = 0008, 3 = 0009 (rebríček)`. Then add this after `function communityV2() …`:

```js
/* ---------- Rebríček (migrácia 0009) ----------
   Appka posiela svoje XP (tréningy + aktivity zvlášť, úspechy ako zoznam id); server
   uplatní limity a XP za úspechy si spočíta sám. XP v appke sa nikdy nemení. */
const LEADERBOARD_DEBOUNCE_MS = 4000;
let leaderboardSentSig = '';           // posledný úspešne odoslaný stav (bez zmeny sa neposiela)
let leaderboardTimer = null;
let leaderboardPeriod = 'all';         // 'all' | 'week'

function leaderboardEnabled() { return communitySocial === true && communityVersion >= 3 && !!communityProfile; }

function leaderboardPayload() {
  const wk = weekKey(new Date());
  const inWeek = (d) => { try { return weekKey(parseDate(d)) === wk; } catch (e) { return false; } };
  const week = state.history.filter((w) => inWeek(w.date)).reduce((s, w) => s + (Number(w.xp) || 0), 0)
    + (state.activities || []).filter((a) => inWeek(a.date)).reduce((s, a) => s + (Number(a.xp) || 0), 0);
  const earned = state.achievements || {};
  return {
    p_training: workoutXP() + activityXP(),
    p_week_training: week,
    p_week_key: wk,
    p_workouts: state.history.length,
    p_achievements: staticAchievementDefs().filter((d) => earned[d.id]).map((d) => d.id),
  };
}

function leaderboardQueue() {
  if (!leaderboardEnabled()) return;
  clearTimeout(leaderboardTimer);
  leaderboardTimer = setTimeout(() => { leaderboardSend(false); }, LEADERBOARD_DEBOUNCE_MS);
}

async function leaderboardSend(force) {
  leaderboardTimer = null;
  if (!leaderboardEnabled()) return null;
  const sb = communityClient();
  if (!sb) return null;
  const payload = leaderboardPayload();
  const sig = JSON.stringify(payload);
  if (!force && sig === leaderboardSentSig) return null;
  let r;
  try { r = await sb.rpc('leaderboard_submit', payload); } catch (e) { r = { error: e }; }
  if (r && !r.error) leaderboardSentSig = sig;   // offline/chyba: pri ďalšej zmene alebo otvorení Community znova
  return r;
}
```

In `saveState()` add `leaderboardQueue();` after `syncNoteLocalChange();`. In `renderCommunity()`, right after the line `if (communityV2() && communityConsent) await communityAfterSignIn(sb, session.user);`, add `if (leaderboardEnabled() && communityConsent) leaderboardSend(false);` (not awaited: the board never waits for the send).

- [ ] **Step 4: Run it and confirm it passes.** Run `node --check script.js && GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-leaderboard.js reports`. Expected: all PASS.
- [ ] **Step 5: Run the existing suites to confirm no regression.** Run `node tests/media/run.js gallery` (needs no backend) and `GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-phase2.js`. Expected: `0 failed`. The ui-phase2 `signIn` waits for `communityVersion === 2`, so on a 0009 stack change its wait to `communityVersion >= 2`. That is a test-only change, recorded as a ruling.
- [ ] **Step 6: Commit.** Run `git add script.js tests/social/ui-leaderboard.js tests/social/ui-phase2.js && git commit -m "Leaderboard: app reports XP (debounced, on Community open)"`.

---

## Task 4: The leaderboard view, privacy switch and moderator action

**Files:** Modify `script.js` (nav item, view, handlers, privacy card, profile menu, i18n) and `style.css` (`.lb-*`). Modify `tests/social/ui-leaderboard.js` (more scenarios).

**Interfaces:**
- Consumes `leaderboardEnabled()`, `leaderboardSend()` and `leaderboardPeriod` from Task 3.
- Produces `communityView === 'leaderboard'` and `communityLeaderboardHtml(sb)`.
- Produces `data-community-action` values `lb-period` (data-period), `lb-refresh`, `lb-show-me`, `lb-mod` (data-user, data-on).
- Produces the checkbox `#community-leaderboard`.

- [ ] **Step 1: Add the failing UI scenarios.** Insert them before the runner in `tests/social/ui-leaderboard.js`:

```js
async function openBoard(p) {
  await p.eval(`(document.querySelector('.cnav [data-community-view="leaderboard"]').click(), true)`);
  await waitFor(() => p.eval(`!!document.querySelector('#community-body .lb-table, #community-body .lb-state')`), 20000, 'board');
  await wait(300);
}
const boardRows = (p) => p.eval(`Array.from(document.querySelectorAll('#community-body .lb-table tbody tr')).map((tr) => ({ name: tr.querySelector('.lb-name').textContent, me: tr.classList.contains('lb-me'), pos: tr.querySelector('.lb-pos').textContent.trim(), medal: tr.querySelector('.lb-pos').className }))`);

scenario('board: tabs, top 3, own pinned row, profile link', async () => {
  sql('delete from public.leaderboard_entries;');
  const me = await member('b-me');
  const top = [];
  for (let i = 0; i < 21; i++) { const u = await member('b' + i); await u.c.rpc('leaderboard_submit', { p_training: 1000 + i * 10, p_week_training: 50 + i, p_week_key: sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`), p_workouts: 5, p_achievements: [] }); top.push(u); }
  const p = await device('board');
  await signIn(p, me);
  await openBoard(p);
  const rows = await boardRows(p);
  check('20 rows plus the pinned own row', rows.length === 21, J(rows.length));
  check('first row has the gold badge', /lb-gold/.test(rows[0].medal) && /lb-silver/.test(rows[1].medal) && /lb-bronze/.test(rows[2].medal), J(rows.slice(0, 3)));
  const mine = rows[rows.length - 1];
  check('own row pinned last and highlighted with its rank', mine.me && mine.pos === '#22', J(mine));
  await p.eval(`(document.querySelector('[data-community-action="lb-period"][data-period="week"]').click(), true)`);
  await waitFor(() => p.eval(`leaderboardPeriod === 'week' && !!document.querySelector('.lb-table')`), 15000, 'week tab');
  check('week tab shows "Resets Monday"', await p.eval(`document.getElementById('community-body').innerText.indexOf(t('lb.resets')) >= 0`));
  await p.eval(`(document.querySelector('.lb-table tbody .lb-name').click(), true)`);
  await waitFor(() => p.eval(`communityView === 'user'`), 15000, 'profile opened');
  check('tapping a name opens the member profile', true);
  check('no page errors', p.errors.length === 0, J(p.errors));
});

scenario('hidden state and the privacy switch', async () => {
  const me = await member('h-me');
  const p = await device('hidden');
  await signIn(p, me);
  await p.eval(`(communitySetView('profile'), true)`);
  await waitFor(() => p.eval(`!!document.getElementById('community-leaderboard')`), 15000, 'privacy switch');
  check('switch is on by default', await p.eval(`document.getElementById('community-leaderboard').checked === true`));
  await p.eval(`(() => { const c = document.getElementById('community-leaderboard'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => sqlVal(`select hidden from public.leaderboard_entries where user_id = ${lit(me.id)}`) === 't', 15000, 'hidden on server');
  await openBoard(p);
  check('hidden state shown with Show me', await p.eval(`!!document.querySelector('.lb-state [data-community-action="lb-show-me"]')`));
  await p.eval(`(document.querySelector('[data-community-action="lb-show-me"]').click(), true)`);
  await waitFor(() => sqlVal(`select hidden from public.leaderboard_entries where user_id = ${lit(me.id)}`) === 'f', 15000, 'shown again');
  check('Show me puts the member back', true);
});

scenario('moderator action and removed note', async () => {
  const mod = await member('m-mod'); L.makeModerator(mod);
  const target = await member('m-target');
  await target.c.rpc('leaderboard_submit', { p_training: 100, p_week_training: 100, p_week_key: sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`), p_workouts: 1, p_achievements: [] });
  const p = await device('mod');
  await signIn(p, mod);
  await p.eval(`(communityOpenUser(${J(target.id)}), true)`);
  await waitFor(() => p.eval(`!!document.querySelector('[data-community-action="lb-mod"]')`), 15000, 'mod button');
  await p.eval(`(document.querySelector('[data-community-action="profile-menu"]').click(), document.querySelector('[data-community-action="lb-mod"]').click(), true)`);
  await waitFor(() => sqlVal(`select removed_by_moderator from public.leaderboard_entries where user_id = ${lit(target.id)}`) === 't', 15000, 'removed');
  check('moderator removes from the leaderboard', true);
  const p2 = await device('removed');
  await signIn(p2, target);
  await openBoard(p2);
  check('removed member sees the removed note', await p2.eval(`document.getElementById('community-body').innerText.indexOf(t('lb.removedNote')) >= 0`));
});

scenario('narrow phone, languages, offline', async () => {
  const me = await member('n-me');
  const p = await device('narrow', 320);
  await signIn(p, me);
  await openBoard(p);
  check('narrow phone: no horizontal page overflow', await p.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
  for (const lang of ['sk', 'es', 'pt-BR', 'fr', 'ar']) {
    await p.eval(`(setLang(${J(lang)}), renderCommunity(), true)`);
    await wait(800);
    check(lang + ': no raw lb.* keys', await p.eval(`document.getElementById('community-body').innerText.indexOf('lb.') < 0`));
  }
  check('arabic is right to left', await p.eval(`document.documentElement.dir === 'rtl'`));
  await p.eval(`(setLang('en'), true)`);
  await p.offline(true);
  await p.eval(`(renderCommunity(), true)`);
  await waitFor(() => p.eval(`document.getElementById('community-body').innerText.indexOf(t('lb.offline')) >= 0 || document.getElementById('community-body').innerText.indexOf(t('community.errNetwork')) >= 0`), 20000, 'offline state');
  check('offline: clear message, no error dialog', true);
  await p.offline(false);
  check('no missing translations', !p.console.some((c) => /chýbajúce preklady/.test(c)), J(p.console.filter((c) => /chýbajúce/.test(c))));
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-leaderboard.js`. Expected: the new scenarios FAIL (`element … leaderboard` / `board` timeouts).

- [ ] **Step 3: Implement the view in `script.js`.**

Add a trophy icon to `COMMUNITY_ICONS`:

```js
  trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/>',
```

In `communityNavHtml()` add after the `search` item: `+ (communityVersion >= 3 ? item('leaderboard', 'trophy', 'lb.nav', v === 'leaderboard') : '')`.

In `renderCommunity()` add next to the other v2 views: `if (communityView === 'leaderboard') { put(await communityLeaderboardHtml(sb)); return; }`. Also add `'leaderboard'` to the list of views reset to `feed` when `!communityV2()`, and when `communityVersion < 3` add `if (communityView === 'leaderboard' && communityVersion < 3) communityView = 'feed';`.

Add the view after `leaderboardSend`:

```js
function leaderboardRowHtml(r, period) {
  const medal = r.pos === 1 ? ' lb-gold' : r.pos === 2 ? ' lb-silver' : r.pos === 3 ? ' lb-bronze' : '';
  const name = r.username || t('community.unknownUser');
  const xp = Number(r.xp || 0).toLocaleString(activeLocale());
  const aria = t(period === 'week' ? 'lb.rowAriaWeek' : 'lb.rowAria', { pos: r.pos, name, level: r.level, xp });
  return '<tr class="lb-row' + (r.is_me ? ' lb-me' : '') + '" aria-label="' + escAttr(aria) + '">'
    + '<td class="lb-pos' + medal + '">' + (r.is_me && r.pos > 20 ? '#' + r.pos : r.pos) + '</td>'
    + '<td class="lb-member">' + communityAvatarHtml(r.avatar_path, 32)
    + '<button type="button" class="lb-name" data-community-action="open-user" data-user="' + escAttr(r.user_id) + '">'
    + esc(name) + (r.is_me ? ' <span class="lb-you">' + esc(t('lb.you')) + '</span>' : '') + '</button></td>'
    + (period === 'week' ? '' : '<td class="lb-level">' + esc(t('lb.levelShort', { n: r.level })) + '</td>')
    + '<td class="lb-xp">' + esc(xp) + '</td></tr>';
}

async function communityLeaderboardHtml(sb) {
  const period = leaderboardPeriod;
  const tab = (p, key) => '<button type="button" class="goal-chip' + (period === p ? ' active' : '') + '" data-community-action="lb-period" data-period="' + p + '" aria-pressed="' + (period === p ? 'true' : 'false') + '">' + esc(t(key)) + '</button>';
  const head = communityTabbar()
    + communitySubHead(esc(t('lb.title')), '<button type="button" class="btn-icon" data-community-action="lb-refresh" aria-label="' + escAttr(t('lb.refresh')) + '">↻</button>', true)
    + '<div class="goal-chips lb-tabs" role="group" aria-label="' + escAttr(t('lb.title')) + '">' + tab('all', 'lb.tabAll') + tab('week', 'lb.tabWeek') + '</div>';
  await leaderboardSend(false);
  let top, me;
  try { [top, me] = await Promise.all([sb.rpc('leaderboard_top', { p_period: period }), sb.rpc('leaderboard_me')]); }
  catch (e) { top = { error: e }; me = { error: e }; }
  if (!top || top.error) {
    return head + '<div class="card lb-state"><p>' + esc(t(navigator.onLine === false ? 'lb.offline' : 'community.errNetwork')) + '</p></div>';
  }
  const info = (me && !me.error && me.data) || {};
  let state = '';
  if (info.removed) state = '<div class="card lb-state"><p>' + esc(t('lb.removedNote')) + '</p></div>';
  else if (info.hidden) state = '<div class="card lb-state"><p><strong>' + esc(t('lb.hiddenTitle')) + '</strong></p><p class="card-note">' + esc(t('lb.hiddenNote')) + '</p>'
    + '<button type="button" class="btn btn-primary" data-community-action="lb-show-me">' + esc(t('lb.showMe')) + '</button></div>';
  const rows = Array.isArray(top.data) ? top.data : [];
  const list = rows.filter((r) => r.pos <= 20);
  const mine = rows.find((r) => r.is_me && r.pos > 20);
  if (!list.length) {
    return head + state + '<div class="card lb-state"><p>' + esc(t(period === 'week' ? 'lb.emptyWeek' : 'lb.emptyAll')) + '</p></div>';
  }
  return head + state
    + '<div class="card lb-card"><div class="lb-scroll"><table class="lb-table">'
    + '<caption class="lb-sr">' + esc(t(period === 'week' ? 'lb.captionWeek' : 'lb.captionAll')) + '</caption>'
    + '<thead><tr><th scope="col">' + esc(t('lb.colRank')) + '</th><th scope="col">' + esc(t('lb.colMember')) + '</th>'
    + (period === 'week' ? '' : '<th scope="col">' + esc(t('lb.colLevel')) + '</th>')
    + '<th scope="col">' + esc(t(period === 'week' ? 'lb.colWeekXp' : 'lb.colXp')) + '</th></tr></thead><tbody>'
    + list.map((r) => leaderboardRowHtml(r, period)).join('')
    + (mine ? '<tr class="lb-gap" aria-hidden="true"><td colspan="' + (period === 'week' ? 3 : 4) + '">⋯</td></tr>' + leaderboardRowHtml(mine, period) : '')
    + '</tbody></table></div>'
    + '<p class="card-note">' + esc(t(period === 'week' ? 'lb.resets' : 'lb.footAll')) + '</p></div>';
}
```

`activeLocale()` already exists if `grep -n "^function activeLocale" script.js` finds it. If it does not, use `LANGUAGES.find((l) => l.code === activeLang()).locale` inline.

Handlers. In the `community-body` click switch next to `else if (act === 'open-user') …`, add:

```js
    else if (act === 'lb-period') { leaderboardPeriod = a.dataset.period === 'week' ? 'week' : 'all'; renderCommunity(); }
    else if (act === 'lb-refresh') renderCommunity();
    else if (act === 'lb-show-me') communitySetLeaderboard(true);
    else if (act === 'lb-mod') communityLeaderboardModerate(a.dataset.user, a.dataset.on === '1');
```

In the `change` listener next to `community-searchable`, add `if (e.target && e.target.id === 'community-leaderboard') communitySetLeaderboard(!!e.target.checked);`.

The functions, placed next to `communitySetSearchable`:

```js
async function communitySetLeaderboard(show) {
  const sb = communityClient(); if (!sb) return;
  let res;
  try { res = await sb.rpc('leaderboard_set_hidden', { p_hidden: !show }); } catch (e) { res = { error: e }; }
  communitySetMessageText(res.error ? communityErrText(res.error) : t(show ? 'lb.shownOn' : 'lb.hiddenOn'));
  if (communityView === 'leaderboard') renderCommunity(); else communityShowStatus();
}
async function communityLeaderboardModerate(uid, removed) {
  const sb = communityClient(); if (!sb || !uid) return;
  let res;
  try { res = await sb.rpc('leaderboard_moderate', { p_user: uid, p_removed: !!removed }); } catch (e) { res = { error: e }; }
  communitySetMessageText(res.error ? communityErrText(res.error) : t(removed ? 'lb.modRemoved' : 'lb.modRestored'));
  communityShowStatus();
}
```

Privacy card. In `communityProfileHtml`, after the `community-searchable` note line, add the switch. It shows only on version ≥ 3, and its state comes from `leaderboard_me` loaded in the same function before rendering (`const lbMe = communityVersion >= 3 ? await sb.rpc('leaderboard_me').catch(() => null) : null;`):

```js
      + (communityVersion >= 3 ? '<label class="community-check" for="community-leaderboard"><input type="checkbox" id="community-leaderboard"'
        + (!(lbMe && lbMe.data && lbMe.data.hidden) ? ' checked' : '') + '><span>' + esc(t('lb.switch')) + '</span></label>'
        + '<p class="card-note">' + esc(t('lb.switchNote')) + '</p>' : '')
```

Moderator action. In `communityUserHtml` (v2 branch), inside `#community-profile-menu` after the report button, add:

```js
        + (communityVersion >= 3 && communityProfile && communityProfile.role === 'moderator'
          ? '<button type="button" class="btn btn-secondary btn-sm" data-community-action="lb-mod" data-user="' + escAttr(card.id) + '" data-on="1">' + esc(t('lb.modRemove')) + '</button>'
            + '<button type="button" class="btn btn-secondary btn-sm" data-community-action="lb-mod" data-user="' + escAttr(card.id) + '" data-on="0">' + esc(t('lb.modRestore')) + '</button>'
          : '')
```

i18n. Add these keys to each language block, next to the `community2.*` keys of that block:

| key | sk | en | es | pt-BR | fr | ar |
|---|---|---|---|---|---|---|
| lb.nav | Top 20 | Top 20 | Top 20 | Top 20 | Top 20 | أفضل 20 |
| lb.title | Rebríček | Leaderboard | Clasificación | Ranking | Classement | لوحة الصدارة |
| lb.tabAll | Celkovo | All time | Histórico | Geral | Depuis toujours | كل الأوقات |
| lb.tabWeek | Tento týždeň | This week | Esta semana | Esta semana | Cette semaine | هذا الأسبوع |
| lb.colRank | Poradie | Rank | Puesto | Posição | Rang | الترتيب |
| lb.colMember | Člen | Member | Miembro | Membro | Membre | العضو |
| lb.colLevel | Úroveň | Level | Nivel | Nível | Niveau | المستوى |
| lb.colXp | XP | XP | XP | XP | XP | XP |
| lb.colWeekXp | XP za týždeň | XP this week | XP esta semana | XP na semana | XP cette semaine | XP هذا الأسبوع |
| lb.levelShort | Úr. {n} | Lv {n} | Nv. {n} | Nv. {n} | Niv. {n} | م {n} |
| lb.you | (ty) | (you) | (tú) | (você) | (vous) | (أنت) |
| lb.resets | Týždenné poradie sa vynuluje v pondelok. | The weekly ranking resets on Monday. | La clasificación semanal se reinicia el lunes. | O ranking semanal reinicia na segunda-feira. | Le classement hebdomadaire repart à zéro le lundi. | يُعاد ضبط ترتيب الأسبوع يوم الإثنين. |
| lb.footAll | Celkové XP a úroveň, rovnaké ako v appke. | Total XP and level, the same as in your app. | XP total y nivel, igual que en tu app. | XP total e nível, iguais aos do seu app. | XP total et niveau, comme dans votre application. | إجمالي XP والمستوى كما في تطبيقك. |
| lb.captionAll | 20 najlepších členov podľa celkových XP | Top 20 members by total XP | Los 20 mejores miembros por XP total | Os 20 melhores membros por XP total | Les 20 meilleurs membres par XP total | أفضل 20 عضوًا حسب إجمالي XP |
| lb.captionWeek | 20 najlepších členov podľa XP za tento týždeň | Top 20 members by XP this week | Los 20 mejores miembros por XP de esta semana | Os 20 melhores membros por XP desta semana | Les 20 meilleurs membres par XP cette semaine | أفضل 20 عضوًا حسب XP هذا الأسبوع |
| lb.rowAria | Poradie {pos}, {name}, úroveň {level}, {xp} XP | Rank {pos}, {name}, level {level}, {xp} XP | Puesto {pos}, {name}, nivel {level}, {xp} XP | Posição {pos}, {name}, nível {level}, {xp} XP | Rang {pos}, {name}, niveau {level}, {xp} XP | الترتيب {pos}، {name}، المستوى {level}، {xp} XP |
| lb.rowAriaWeek | Poradie {pos}, {name}, {xp} XP tento týždeň | Rank {pos}, {name}, {xp} XP this week | Puesto {pos}, {name}, {xp} XP esta semana | Posição {pos}, {name}, {xp} XP nesta semana | Rang {pos}, {name}, {xp} XP cette semaine | الترتيب {pos}، {name}، {xp} XP هذا الأسبوع |
| lb.refresh | Obnoviť rebríček | Refresh leaderboard | Actualizar clasificación | Atualizar ranking | Actualiser le classement | تحديث لوحة الصدارة |
| lb.offline | Na zobrazenie rebríčka sa pripoj na internet. | Connect to the internet to see the leaderboard. | Conéctate a internet para ver la clasificación. | Conecte-se à internet para ver o ranking. | Connectez-vous à Internet pour voir le classement. | اتصل بالإنترنت لعرض لوحة الصدارة. |
| lb.emptyWeek | Tento týždeň ešte nikto nemá XP. Buď prvý. | No XP yet this week. Be the first. | Nadie tiene XP esta semana. Sé el primero. | Ninguém tem XP nesta semana. Seja o primeiro. | Pas encore d’XP cette semaine. Soyez le premier. | لا توجد XP هذا الأسبوع بعد. كن الأول. |
| lb.emptyAll | Rebríček je zatiaľ prázdny. | The leaderboard is empty so far. | La clasificación aún está vacía. | O ranking ainda está vazio. | Le classement est encore vide. | لوحة الصدارة فارغة حتى الآن. |
| lb.hiddenTitle | Nezobrazuješ sa v rebríčku. | You’re hidden from the leaderboard. | Estás oculto en la clasificación. | Você está oculto no ranking. | Vous êtes masqué du classement. | أنت مخفي من لوحة الصدارة. |
| lb.hiddenNote | Ostatní ťa v ňom nevidia. Tvoje XP v appke sa nemení. | Others can’t see you there. Your XP in the app doesn’t change. | Los demás no te ven ahí. Tu XP en la app no cambia. | Os outros não veem você lá. Seu XP no app não muda. | Les autres ne vous y voient pas. Votre XP dans l’application ne change pas. | لا يراك الآخرون هناك. لا تتغير XP في تطبيقك. |
| lb.showMe | Zobraziť ma | Show me | Mostrarme | Mostrar-me | M’afficher | أظهرني |
| lb.switch | Zobrazovať ma v rebríčku | Show me on the leaderboard | Mostrarme en la clasificación | Mostrar-me no ranking | M’afficher dans le classement | أظهرني في لوحة الصدارة |
| lb.switchNote | V rebríčku je len tvoje meno, avatar, úroveň a XP. Nikdy tvoje tréningy. | The leaderboard shows only your name, avatar, level and XP. Never your workouts. | La clasificación solo muestra tu nombre, avatar, nivel y XP. Nunca tus entrenamientos. | O ranking mostra só seu nome, avatar, nível e XP. Nunca seus treinos. | Le classement n’affiche que votre nom, avatar, niveau et XP. Jamais vos séances. | تعرض لوحة الصدارة اسمك وصورتك ومستواك وXP فقط، ولا تعرض تمارينك أبدًا. |
| lb.shownOn | Zobrazuješ sa v rebríčku. | You appear on the leaderboard. | Apareces en la clasificación. | Você aparece no ranking. | Vous apparaissez dans le classement. | أنت تظهر في لوحة الصدارة. |
| lb.hiddenOn | Už sa nezobrazuješ v rebríčku. | You no longer appear on the leaderboard. | Ya no apareces en la clasificación. | Você não aparece mais no ranking. | Vous n’apparaissez plus dans le classement. | لم تعد تظهر في لوحة الصدارة. |
| lb.removedNote | Moderátor ťa odstránil z rebríčka. | A moderator removed you from the leaderboard. | Un moderador te quitó de la clasificación. | Um moderador removeu você do ranking. | Un modérateur vous a retiré du classement. | أزالك أحد المشرفين من لوحة الصدارة. |
| lb.modRemove | Odstrániť z rebríčka | Remove from leaderboard | Quitar de la clasificación | Remover do ranking | Retirer du classement | إزالة من لوحة الصدارة |
| lb.modRestore | Vrátiť do rebríčka | Restore to leaderboard | Devolver a la clasificación | Restaurar no ranking | Remettre dans le classement | إعادة إلى لوحة الصدارة |
| lb.modRemoved | Člen bol odstránený z rebríčka. | Member removed from the leaderboard. | Miembro quitado de la clasificación. | Membro removido do ranking. | Membre retiré du classement. | تمت إزالة العضو من لوحة الصدارة. |
| lb.modRestored | Člen je späť v rebríčku. | Member restored to the leaderboard. | Miembro devuelto a la clasificación. | Membro restaurado no ranking. | Membre remis dans le classement. | أُعيد العضو إلى لوحة الصدارة. |

Insert them with a script that adds one line per key after each language's `'community2.navHome'` line. Then verify with `grep -c "'lb.nav':" script.js`, which must print `6`. The Arabic `{n}`, `{pos}`, `{xp}` and `{name}` placeholders are Latin or numeric runs: keep them as written. Isolation is not needed for numbers, and names are user content.

- [ ] **Step 4: Styles in `style.css`.** Add these after the `.cnav` block:

```css
/* Rebríček (Community → Top 20) */
.lb-tabs { margin-block: var(--sp-2) var(--sp-3); }
.lb-card { padding: 0; overflow: hidden; }
.lb-scroll { overflow-x: auto; }
.lb-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lb-table th { text-align: start; font-size: var(--fs-xs); font-weight: var(--fw-bold); color: var(--text-dim);
  padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); }
.lb-table td { padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); vertical-align: middle; }
.lb-table tr:last-child td { border-bottom: 0; }
.lb-pos { width: 3.2em; font-weight: var(--fw-bold); color: var(--text-dim); text-align: center; }
.lb-gold, .lb-silver, .lb-bronze { color: #111; }
.lb-pos.lb-gold::before, .lb-pos.lb-silver::before, .lb-pos.lb-bronze::before { content: none; }
.lb-gold { background: linear-gradient(180deg, #f3d36b, #d9a933); }
.lb-silver { background: linear-gradient(180deg, #e3e6ea, #b8bec6); }
.lb-bronze { background: linear-gradient(180deg, #e5a978, #b9733f); }
.lb-member { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.lb-name { background: none; border: 0; padding: 0; font: inherit; color: var(--text); font-weight: var(--fw-bold);
  cursor: pointer; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; }
.lb-name:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; border-radius: var(--r-sm); }
.lb-you { color: var(--accent); font-weight: var(--fw-med); }
.lb-level { white-space: nowrap; color: var(--text-dim); }
.lb-xp { text-align: end; font-weight: var(--fw-bold); white-space: nowrap; }
.lb-me td { background: var(--accent-soft, rgba(255, 122, 26, 0.12)); }
.lb-gap td { text-align: center; color: var(--text-dim); padding-block: var(--sp-1); }
.lb-state { display: grid; gap: var(--sp-2); }
.lb-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
```

Before using `--accent-soft`, run `grep -n "\-\-accent-soft" style.css`. If it is not defined, keep the fallback value as written (rgba of the accent orange).

- [ ] **Step 5: Run everything and confirm it passes.** Run `node --check script.js && GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-leaderboard.js && node tests/social/leaderboard.js && node tests/media/run.js gallery`. Expected: `0 failed` for each.
- [ ] **Step 6: Look at it.** Take one screenshot at 390 px in English and Arabic (Chrome DevTools `Page.captureScreenshot` as in the media task). Check that the top 3 badges, the own pinned row, and the RTL column order look right. Fix layout issues before committing.
- [ ] **Step 7: Commit.** Run `git add script.js style.css tests/social/ui-leaderboard.js && git commit -m "Leaderboard: Top 20 view, privacy switch, moderator action, 6 languages"`.

---

## Task 5: Docs and release (v57)

**Files:** Modify `supabase/README.md`, `tests/social/README.md`, `README.md`, `CLAUDE.md`, `sw.js` and `index.html`.

- [ ] **Step 1: `supabase/README.md`.** Add item 8 to "Run the database migrations":

```markdown
8. [`migrations/0009_leaderboard.sql`](./migrations/0009_leaderboard.sql) — Community leaderboard (top 20 by XP): one row per member, the app reports XP through `leaderboard_submit()` and the server applies the limits (300 training XP per UTC day, 1,000 per ISO week, achievement XP computed on the server from the earned ids, at most 5,150), members appear by default and can hide themselves, moderators can remove a member. `community_social_version()` becomes 3. Needs 0008.

**0009 — leaderboard.** Release order: the app (v57+) first — it shows the leaderboard only when `community_social_version()` answers 3 — then run 0009 once, as one transaction, then `NOTIFY pgrst, 'reload schema';`. The `delete-account` function does not need redeploying (it calls `community_leave_cleanup`, which 0009 extends). **Rollback:** [`rollback/0009_down.sql`](./rollback/0009_down.sql) drops the leaderboard (there is no other data to keep: XP lives in the app) and sets the version back to 2; the app hides the leaderboard by itself.
```

- [ ] **Step 2: `tests/social/README.md`.** Add rows for `leaderboard.js` and `ui-leaderboard.js` to the "What is covered" table, and add their two commands to the run block.
- [ ] **Step 3: `README.md`.** Add one paragraph to the Community section: "**Leaderboard (Top 20).** …", covering who appears, the two tabs, the limits in one sentence, the privacy switch and moderators. Mention it needs internet and a Community account.
- [ ] **Step 4: `CLAUDE.md`.** Change "migrations `0001`–`0008`" to "`0001`–`0009`", and "`community_social_version()`" to mention it reaches 3 with the leaderboard.
- [ ] **Step 5: Release bump.** `CACHE_VERSION` `v56` → `v57`, and `?v=60` → `?v=61` in `sw.js` and `index.html`.
- [ ] **Step 6: Full verification.** Run `node --check script.js && node --check sw.js && node tests/social/leaderboard.js && GQ_COMMUNITY_CONFIG=$GQ_WORK/community-config.local.js node tests/social/ui-leaderboard.js && node tests/social/phase2.js && node tests/media/run.js`. Expected: `0 failed` in every suite.
- [ ] **Step 7: Commit.** Run `git add -A supabase README.md CLAUDE.md tests/social/README.md sw.js index.html && git commit -m "Leaderboard: docs and release steps (v57)"`.

**After the owner approves the push:** push the app (v57). The owner runs `0009_leaderboard.sql` in the Supabase SQL editor and then `NOTIFY pgrst, 'reload schema';`. Claude then checks the live site shows "Top 20" in Community and that the owner's own row appears.
