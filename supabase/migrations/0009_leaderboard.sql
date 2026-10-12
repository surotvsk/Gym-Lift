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
  training_peak        integer not null default 0 check (training_peak >= 0),   -- najvyššie prijaté training XP
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
-- RLS on, no policies: only the SECURITY DEFINER functions below reach the table.
alter table public.leaderboard_entries enable row level security;

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
