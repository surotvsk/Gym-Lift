-- GymQuest Community — 0022: optional workout phase badges (v117).
-- Requires 0021 / capability 13. No RPC/rules, training, peak, baseline or history changes.
-- Existing function ACLs survive CREATE OR REPLACE. Production execution needs separate approval.
-- One transaction. Rollback: supabase/rollback/0022_down.sql (bounded achievement-XP adjustment).
begin;

do $$
begin
  if public.community_social_version() >= 14 then raise exception '0022 already applied'; end if;
  if public.community_social_version() <> 13 then raise exception '0022 requires version 13'; end if;
end $$;

create or replace function public.leaderboard_achievement_value_v2(p_ids text[], p_workouts integer)
returns integer language sql immutable set search_path = public as $$
  select coalesce(sum(a.xp), 0)::integer
    from (values ('first', 25, 1), ('start3', 50, 3),
                 ('goal1', 50, 1), ('goal4', 100, 4), ('goal12', 250, 12), ('goal26', 400, 26),
                 ('streak4', 150, 4), ('streak8', 300, 8), ('streak12', 450, 12), ('streak26', 800, 26),
                 ('w10', 100, 10), ('w25', 200, 25), ('w50', 350, 50), ('w100', 600, 100), ('w250', 1000, 250),
                 ('pr1', 50, 2), ('pr10', 150, 2), ('pr25', 300, 2), ('steady5', 100, 2),
                 ('back', 50, 3), ('rest5', 25, 5), ('ownplan', 25, 1), ('fullbody', 25, 1),
                 ('explorer10', 50, 1), ('body4', 50, 0), ('together', 50, 1), ('balanced10', 25, 1),
                 ('phaseWarmup1', 25, 1), ('phaseStretch1', 25, 1))
         as a(id, xp, min_workouts)
   where a.id = any (coalesce(p_ids, '{}'::text[])) and coalesce(p_workouts, 0) >= a.min_workouts;
$$;

-- Preserve the 0017 profile union, including legacy-only and zero-XP rows.
create or replace function public.achievement_catalog()
returns table (id text, xp integer, min_workouts integer) language sql immutable set search_path = public as $$
  values ('first', 25, 1), ('five', 50, 5), ('ten', 100, 10), ('twentyfive', 200, 25),
         ('fifty', 350, 50), ('hundred', 750, 100), ('weeklygoal1', 75, 1), ('consistent2', 125, 2),
         ('consistent4', 300, 4), ('consistent8', 500, 8), ('consistent12', 750, 12), ('solid2', 125, 2),
         ('solid4', 300, 4), ('fullweek', 200, 1), ('newpr', 75, 1), ('pr5', 150, 1), ('pr10', 150, 2),
         ('improve', 100, 1), ('xp200', 0, 0), ('customplan', 50, 0), ('fourplans', 100, 0),
         ('customex5', 125, 0), ('variety4', 150, 1), ('comeback', 100, 1), ('missedweek', 150, 1),
         ('start3', 50, 3),
         ('goal1', 50, 1), ('goal4', 100, 4), ('goal12', 250, 12), ('goal26', 400, 26),
         ('streak4', 150, 4), ('streak8', 300, 8), ('streak12', 450, 12), ('streak26', 800, 26),
         ('w10', 100, 10), ('w25', 200, 25), ('w50', 350, 50), ('w100', 600, 100), ('w250', 1000, 250),
         ('pr1', 50, 2), ('pr25', 300, 2), ('steady5', 100, 2),
         ('back', 50, 3), ('rest5', 25, 5), ('ownplan', 25, 1), ('fullbody', 25, 1),
         ('explorer10', 50, 1), ('body4', 50, 0), ('together', 50, 1), ('balanced10', 25, 1),
         ('phaseWarmup1', 25, 1), ('phaseStretch1', 25, 1)
$$;

alter table public.leaderboard_entries drop constraint leaderboard_entries_achievement_xp_check;
alter table public.leaderboard_entries add constraint leaderboard_entries_achievement_xp_check
  check (achievement_xp between 0 and 5775);

-- Retain 0021's runtime privilege check across role changes in reused prepared plans.
create or replace function public.community_social_version()
returns integer language sql stable security invoker set search_path = public as $$ select 14 $$;
revoke execute on function public.community_social_version() from public, anon;
grant execute on function public.community_social_version() to authenticated;

commit;
