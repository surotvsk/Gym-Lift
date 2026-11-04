-- GymQuest Community — migration 0017: leaderboard v2 (XP rules of app release v101).
--
-- The app (v101) recalculates everyone's XP with the new rules (30 XP + 2 per set, 2 workouts a day,
-- new level curve, new achievements); there is no conversion of old levels. This migration:
--   * leaderboard_achievement_value_v2() — the 27 new achievements with their XP and the workouts each needs
--     at least (old ids are worth 0). achievement_xp may now reach 5,725 (the new table's maximum).
--   * achievement_catalog() (profile top 3, 0011) becomes the union of the old 25 ids and the 27 new ones, so
--     v2 badges show on Community profiles too. Colliding ids (first, pr10) take the v2 values; old-only ids
--     keep their old XP so existing profiles keep their order.
--   * level is generated from the new curve: floor((sqrt(4900 + 40 * total_xp) - 70) / 20)
--     (total 0 / 79 = L0, 80 = L1, 2,940 = L14, 10,440 = L29).
--   * leaderboard_submit() gains p_rules integer default null. p_rules >= 2 (app v101+) behaves like 0009
--     with the new achievement table. A call WITHOUT p_rules (older apps still in use: Android v95, cached web
--     builds) is a NO-OP for XP: it reports old-rule numbers, so it must never overwrite the recalculated
--     ones. It only touches updated_at, returns the stored row (zeros when there is none, nothing is created)
--     and raises no error. Such users show their stored values until they update the app.
--     The old 5-argument signature is replaced by the 6-argument one with a default, so old calls still resolve.
--   * Existing rows are re-baselined: day_key := null and day_gain := 0 (so the first p_rules = 2 submit is
--     accepted as reported, exactly like a first submission — recalculated XP is usually LOWER and may rarely be
--     higher), and training_peak := training_xp. With day_key null that first submit also replaces the peak by
--     the recalculated value, so the old-rule peak can never act as a "free" ceiling afterwards and later gains
--     are limited normally (300 / day above the peak).
-- community_social_version() = 9. Needs 0009 (and everything up to 0016 as in production).
-- Run once, as one transaction. Rollback: supabase/rollback/0017_down.sql.
begin;

do $$
begin
  if to_regclass('public.leaderboard_entries') is null then raise exception '0017 needs 0009 first'; end if;
  if to_regprocedure('public.leaderboard_achievement_value_v2(text[],integer)') is not null then
    raise exception '0017 is already applied';
  end if;
end $$;

-- New achievement table (spec 4.3): id, XP, minimum workouts (the app's p_workouts counts workouts + activities).
create function public.leaderboard_achievement_value_v2(p_ids text[], p_workouts integer)
returns integer language sql immutable set search_path = public as $$
  select coalesce(sum(a.xp), 0)::integer
    from (values ('first', 25, 1), ('start3', 50, 3),
                 ('goal1', 50, 1), ('goal4', 100, 4), ('goal12', 250, 12), ('goal26', 400, 26),
                 ('streak4', 150, 4), ('streak8', 300, 8), ('streak12', 450, 12), ('streak26', 800, 26),
                 ('w10', 100, 10), ('w25', 200, 25), ('w50', 350, 50), ('w100', 600, 100), ('w250', 1000, 250),
                 ('pr1', 50, 2), ('pr10', 150, 2), ('pr25', 300, 2), ('steady5', 100, 2),
                 ('back', 50, 3), ('rest5', 25, 5), ('ownplan', 25, 1), ('fullbody', 25, 1),
                 ('explorer10', 50, 1), ('body4', 50, 0), ('together', 50, 1), ('balanced10', 25, 1))
         as a(id, xp, min_workouts)
   where a.id = any (coalesce(p_ids, '{}'::text[])) and coalesce(p_workouts, 0) >= a.min_workouts;
$$;

-- Profile top 3 (0011): union of the old 25 ids and the new 27. Colliding ids (first, pr10) use the v2 values,
-- old-only ids keep their old values (existing showcases keep their order); XP 0 ids are still dropped.
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
         ('explorer10', 50, 1), ('body4', 50, 0), ('together', 50, 1), ('balanced10', 25, 1)
$$;

-- New level curve and the higher achievement ceiling (5,150 -> 5,725).
alter table public.leaderboard_entries drop column level;
alter table public.leaderboard_entries drop constraint leaderboard_entries_achievement_xp_check;
alter table public.leaderboard_entries add constraint leaderboard_entries_achievement_xp_check
  check (achievement_xp between 0 and 5725);
alter table public.leaderboard_entries add column level integer generated always as
  (floor((sqrt(4900 + 40 * (training_xp + achievement_xp)::numeric) - 70) / 20)::integer) stored;

-- Every existing row is recalculated by its owner's next p_rules = 2 submit (see the header).
update public.leaderboard_entries set day_key = null, day_gain = 0, training_peak = training_xp;

drop function public.leaderboard_submit(integer, integer, text, integer, text[]);
create function public.leaderboard_submit(p_training integer, p_week_training integer, p_week_key text,
                                          p_workouts integer, p_achievements text[], p_rules integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  v_today     date := (now() at time zone 'utc')::date;
  v_week      text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  v_training  integer := greatest(coalesce(p_training, 0), 0);
  v_week_in   integer := greatest(coalesce(p_week_training, 0), 0);
  v_ach       integer := public.leaderboard_achievement_value_v2(p_achievements, greatest(coalesce(p_workouts, 0), 0));
  v_row       public.leaderboard_entries;
  v_removed   boolean;
  v_day_gain  integer;
  v_peak      integer;
  v_free      integer := 0;
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
  if coalesce(p_rules, 0) < 2 then
    -- Older app (old XP rules): its numbers must not replace the recalculated ones. No-op except updated_at.
    update public.leaderboard_entries set updated_at = now() where user_id = v_me returning * into v_row;
    if not found then
      return jsonb_build_object('total_xp', 0, 'level', 0, 'week_xp', 0, 'capped', false);
    end if;
    return jsonb_build_object('total_xp', v_row.total_xp, 'level', v_row.level, 'week_xp', v_row.week_xp,
                              'capped', false);
  end if;
  -- A moderator removal survives Leave Community + rejoin: the history row outlives the leaderboard row.
  v_removed := coalesce((select m.action = 'leaderboard_remove' from public.moderation_actions m
                          where m.user_id = v_me and m.action in ('leaderboard_remove', 'leaderboard_restore')
                          order by m.created_at desc, m.id desc limit 1), false);
  select * into v_row from public.leaderboard_entries where user_id = v_me for update;
  if not found or v_row.day_key is null then
    -- First submission (also when Show me / a moderator created the row earlier, or when 0017 re-baselined
    -- the row): the baseline is accepted as reported, bounded to 1,000,000 training XP (~20,000 workouts).
    v_new := least(v_training, 1000000);
    insert into public.leaderboard_entries (user_id, training_xp, training_peak, achievement_xp, week_key, week_xp,
                                            day_key, day_gain, removed_by_moderator)
    values (v_me, v_new, v_new, v_ach, v_week, case when p_week_key = v_week then least(v_week_in, 1000) else 0 end,
            v_today, 0, v_removed)
    on conflict (user_id) do update
      set training_xp = excluded.training_xp, training_peak = excluded.training_peak,
          achievement_xp = excluded.achievement_xp, week_key = excluded.week_key, week_xp = excluded.week_xp,
          day_key = excluded.day_key, day_gain = 0,
          removed_by_moderator = public.leaderboard_entries.removed_by_moderator or excluded.removed_by_moderator,
          reached_at = now(), updated_at = now()
    returning * into v_row;
    return jsonb_build_object('total_xp', v_row.total_xp, 'level', v_row.level, 'week_xp', v_row.week_xp,
                              'capped', v_new < v_training);
  end if;
  v_day_gain := case when v_row.day_key = v_today then v_row.day_gain else 0 end;
  v_peak := greatest(v_row.training_peak, v_row.training_xp);
  if v_training <= v_row.training_xp then
    v_new := v_training;                                    -- same or lower (deleted workout, empty phone): accepted
  else
    -- Back up to the earlier peak is free (a phone that showed 0 before the first sync);
    -- only XP above the peak counts against the daily limit, so nothing can be farmed.
    v_free := greatest(least(v_training, v_peak) - v_row.training_xp, 0);
    v_gain := least(greatest(v_training - greatest(v_row.training_xp, v_peak), 0), greatest(300 - v_day_gain, 0));
    v_new := v_row.training_xp + v_free + v_gain;
  end if;
  v_prev_week := case when v_row.week_key = v_week then v_row.week_xp else 0 end;
  if p_week_key is distinct from v_week then v_week_val := v_prev_week;      -- device week differs: keep
  elsif v_week_in <= v_prev_week then v_week_val := v_week_in;
  else v_week_val := least(v_week_in, 1000, v_prev_week + v_free + v_gain);
  end if;
  update public.leaderboard_entries
     set training_xp = v_new, training_peak = greatest(v_peak, v_new), achievement_xp = v_ach,
         week_key = v_week, week_xp = v_week_val,
         day_key = v_today, day_gain = v_day_gain + v_gain,
         reached_at = case when v_new + v_ach > v_row.total_xp then now() else v_row.reached_at end,
         updated_at = now()
   where user_id = v_me
  returning * into v_row;
  return jsonb_build_object('total_xp', v_row.total_xp, 'level', v_row.level, 'week_xp', v_row.week_xp,
                            'capped', v_new < v_training);
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 9 $$;

-- Privileges as in 0009: functions for signed-in members only.
revoke execute on function public.leaderboard_achievement_value_v2(text[], integer) from public, anon, authenticated;
revoke execute on function public.leaderboard_submit(integer, integer, text, integer, text[], integer) from public, anon;
grant execute on function public.leaderboard_submit(integer, integer, text, integer, text[], integer) to authenticated;

commit;
