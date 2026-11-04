-- Rollback of 0017 (leaderboard v2). One transaction. Restores the 0009 leaderboard: the 5-argument
-- leaderboard_submit() with the old achievement table, level = total / 100, achievement_xp up to 5,150, version 8.
-- Rows are kept (achievement_xp is clamped to 5,150 so the old check holds); they are re-baselined by each
-- member's next submit (day_key null), as the app then reports the old-rule XP again.
-- Run NOTIFY pgrst, 'reload schema'; afterwards.
begin;
drop function if exists public.leaderboard_submit(integer, integer, text, integer, text[], integer);
drop function if exists public.leaderboard_achievement_value_v2(text[], integer);

-- achievement_catalog() exactly as in 0011 (25 old ids).
create or replace function public.achievement_catalog()
returns table (id text, xp integer, min_workouts integer) language sql immutable set search_path = public as $$
  values ('first', 25, 1), ('five', 50, 5), ('ten', 100, 10), ('twentyfive', 200, 25),
         ('fifty', 350, 50), ('hundred', 750, 100), ('weeklygoal1', 75, 1), ('consistent2', 125, 2),
         ('consistent4', 300, 4), ('consistent8', 500, 8), ('consistent12', 750, 12), ('solid2', 125, 2),
         ('solid4', 300, 4), ('fullweek', 200, 1), ('newpr', 75, 1), ('pr5', 150, 1), ('pr10', 300, 1),
         ('improve', 100, 1), ('xp200', 0, 0), ('customplan', 50, 0), ('fourplans', 100, 0),
         ('customex5', 125, 0), ('variety4', 150, 1), ('comeback', 100, 1), ('missedweek', 150, 1)
$$;

alter table public.leaderboard_entries drop column level;
update public.leaderboard_entries set achievement_xp = least(achievement_xp, 5150), day_key = null, day_gain = 0
 where achievement_xp > 5150 or day_key is not null;
alter table public.leaderboard_entries drop constraint leaderboard_entries_achievement_xp_check;
alter table public.leaderboard_entries add constraint leaderboard_entries_achievement_xp_check
  check (achievement_xp between 0 and 5150);
alter table public.leaderboard_entries add column level integer generated always as ((training_xp + achievement_xp) / 100) stored;

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
  -- A moderator removal survives Leave Community + rejoin: the history row outlives the leaderboard row.
  v_removed := coalesce((select m.action = 'leaderboard_remove' from public.moderation_actions m
                          where m.user_id = v_me and m.action in ('leaderboard_remove', 'leaderboard_restore')
                          order by m.created_at desc, m.id desc limit 1), false);
  select * into v_row from public.leaderboard_entries where user_id = v_me for update;
  if not found or v_row.day_key is null then
    -- First submission (also when Show me / a moderator created the row earlier): the baseline is
    -- accepted as reported, bounded to 1,000,000 training XP (~20,000 workouts).
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
revoke execute on function public.leaderboard_submit(integer, integer, text, integer, text[]) from public, anon;
grant execute on function public.leaderboard_submit(integer, integer, text, integer, text[]) to authenticated;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 8 $$;
commit;
