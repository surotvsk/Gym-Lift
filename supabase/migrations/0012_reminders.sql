-- GymQuest Community — migration 0012: reminders to drink water, eat and work out (Web Push).
--
-- A member who turned on notifications (0010) can set reminders: water every N minutes between two
-- times, up to 6 meal times, and workout days + a time — always in the phone's own time zone.
-- Every 5 minutes pg_cron calls reminders_dispatch(), which makes ONE HTTP call (pg_net) to the
-- `reminders` Edge Function with a shared secret; the function asks reminders_due() (service_role
-- only) who is due — each reminder is marked as sent in the same statement, so it is never sent twice
-- — and sends the notifications. The function URL and the secret live in Supabase Vault
-- (gq_reminders_url, gq_reminders_secret), never in this file; without them nothing is sent.
-- community_social_version() = 6. Needs 0011. Run once, as one transaction.
-- Rollback: supabase/rollback/0012_down.sql.
begin;

do $$
begin
  if to_regclass('public.message_reactions') is null then raise exception '0012 needs 0011 first'; end if;
  if to_regclass('public.push_reminders') is not null then raise exception '0012 is already applied'; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise exception '0012 needs pg_cron (installed by 0008)'; end if;
end $$;

create extension if not exists pg_net;

create table public.push_reminders (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  tz           text not null default 'UTC',
  water_on     boolean not null default false,
  water_every  integer not null default 120,
  water_from   time not null default '08:00',
  water_to     time not null default '21:00',
  meals_on     boolean not null default false,
  meal_times   time[] not null default '{08:00,12:30,18:30}',
  workout_on   boolean not null default false,
  workout_days smallint[] not null default '{1,3,5}',
  workout_time time not null default '17:00',
  last_water   timestamptz,
  last_meal    timestamptz,
  last_workout date,
  updated_at   timestamptz not null default now(),
  constraint push_reminders_tz_len check (char_length(tz) between 1 and 64),
  constraint push_reminders_water_every check (water_every between 30 and 360),
  constraint push_reminders_water_range check (water_from < water_to),
  constraint push_reminders_meals check (cardinality(meal_times) <= 6),
  constraint push_reminders_days check (workout_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(workout_days) <= 7),
  constraint push_reminders_workout_time check (workout_time <= '23:30')
);
alter table public.push_reminders enable row level security;   -- no policies: functions only

-- The signed-in member's settings (defaults when none are saved yet).
create function public.reminders_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.push_reminders;
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.push_reminders where user_id = auth.uid();
  if not found then
    r.water_on := false; r.water_every := 120; r.water_from := '08:00'; r.water_to := '21:00';
    r.meals_on := false; r.meal_times := '{08:00,12:30,18:30}'; r.workout_on := false;
    r.workout_days := '{1,3,5}'; r.workout_time := '17:00'; r.tz := 'UTC';
  end if;
  return jsonb_build_object('water_on', r.water_on, 'water_every', r.water_every,
    'water_from', to_char(r.water_from, 'HH24:MI'), 'water_to', to_char(r.water_to, 'HH24:MI'),
    'meals_on', r.meals_on, 'meal_times', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb) from unnest(r.meal_times) x),
    'workout_on', r.workout_on, 'workout_days', to_jsonb(r.workout_days), 'workout_time', to_char(r.workout_time, 'HH24:MI'), 'tz', r.tz);
end;
$$;

-- Save the settings. Every value is checked; an unknown time zone or bad time is refused.
-- Turning water on starts counting from now (no reminder the moment it is switched on).
create function public.reminders_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_tz    text := coalesce(p ->> 'tz', 'UTC');
  v_meals time[];
  v_days  smallint[];
  v_old   public.push_reminders;
  hhmm    constant text := '^([01]\d|2[0-3]):[0-5]\d$';
begin
  if v_me is null or not public.community_eligible() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_reminders' using errcode = 'P0001'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then raise exception 'invalid_timezone' using errcode = 'P0001'; end if;
  if coalesce(p ->> 'water_from', '') !~ hhmm or coalesce(p ->> 'water_to', '') !~ hhmm or coalesce(p ->> 'workout_time', '') !~ hhmm
     or jsonb_typeof(p -> 'meal_times') is distinct from 'array' or jsonb_typeof(p -> 'workout_days') is distinct from 'array'
     or jsonb_array_length(p -> 'meal_times') > 6 or jsonb_array_length(p -> 'workout_days') > 7
     or exists (select 1 from jsonb_array_elements(p -> 'meal_times') x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ hhmm)
     or exists (select 1 from jsonb_array_elements(p -> 'workout_days') x where jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[1-7]$') then
    raise exception 'invalid_reminders' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct (x #>> '{}')::time), '{}') into v_meals from jsonb_array_elements(p -> 'meal_times') x;
  -- a meal or workout reminder needs its 20-minute window inside the same day
  if exists (select 1 from unnest(v_meals) m where m > '23:30') or (p ->> 'workout_time')::time > '23:30' then
    raise exception 'invalid_reminders' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct (x #>> '{}')::smallint), '{}') into v_days from jsonb_array_elements(p -> 'workout_days') x;
  select * into v_old from public.push_reminders where user_id = v_me;
  insert into public.push_reminders (user_id, tz, water_on, water_every, water_from, water_to, meals_on, meal_times,
                                     workout_on, workout_days, workout_time, last_water, updated_at)
  values (v_me, v_tz, coalesce((p ->> 'water_on')::boolean, false), coalesce((p ->> 'water_every')::integer, 120),
          (p ->> 'water_from')::time, (p ->> 'water_to')::time, coalesce((p ->> 'meals_on')::boolean, false), v_meals,
          coalesce((p ->> 'workout_on')::boolean, false), v_days, (p ->> 'workout_time')::time,
          case when coalesce((p ->> 'water_on')::boolean, false) and not coalesce(v_old.water_on, false) then now() else v_old.last_water end, now())
  on conflict (user_id) do update set tz = excluded.tz, water_on = excluded.water_on, water_every = excluded.water_every,
    water_from = excluded.water_from, water_to = excluded.water_to, meals_on = excluded.meals_on, meal_times = excluded.meal_times,
    workout_on = excluded.workout_on, workout_days = excluded.workout_days, workout_time = excluded.workout_time,
    last_water = excluded.last_water, updated_at = now();
  return public.reminders_get();
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  raise exception 'invalid_reminders' using errcode = 'P0001';
end;
$$;

-- Edge Function only (service_role): who is due right now. Marks what it returns as sent.
-- water: inside the from–to window and at least water_every minutes since the last one;
-- meal / workout: within 20 minutes after the chosen time, once per slot / per day.
create function public.reminders_due()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r     public.push_reminders;
  lt    timestamp;
  kinds text[];
  out   jsonb := '[]'::jsonb;
  subs  jsonb;
begin
  for r in select pr.* from public.push_reminders pr
            where (pr.water_on or pr.meals_on or pr.workout_on)
              and exists (select 1 from public.push_subscriptions s where s.user_id = pr.user_id)
            for update skip locked loop
    lt := now() at time zone r.tz;
    kinds := '{}';
    if r.water_on and lt::time >= r.water_from and lt::time <= r.water_to
       and (r.last_water is null or now() - r.last_water >= make_interval(mins => r.water_every)) then
      kinds := kinds || 'water'::text;
      update public.push_reminders set last_water = now() where user_id = r.user_id;
    end if;
    if r.meals_on and exists (select 1 from unnest(r.meal_times) t where lt::time >= t and lt::time < t + interval '20 minutes')
       and (r.last_meal is null or now() - r.last_meal > interval '40 minutes') then
      kinds := kinds || 'meal'::text;
      update public.push_reminders set last_meal = now() where user_id = r.user_id;
    end if;
    if r.workout_on and extract(isodow from lt)::smallint = any (r.workout_days)
       and lt::time >= r.workout_time and lt::time < r.workout_time + interval '20 minutes'
       and r.last_workout is distinct from lt::date then
      kinds := kinds || 'workout'::text;
      update public.push_reminders set last_workout = lt::date where user_id = r.user_id;
    end if;
    if cardinality(kinds) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang)), '[]'::jsonb)
        into subs from public.push_subscriptions s where s.user_id = r.user_id;
      out := out || jsonb_build_object('kinds', to_jsonb(kinds), 'subs', subs);
    end if;
  end loop;
  return out;
end;
$$;

-- pg_cron → one HTTP call to the `reminders` function (URL and secret from Vault; nothing without them).
create function public.reminders_dispatch()
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gq_reminders_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gq_reminders_secret';
  if v_url is null or v_secret is null or char_length(v_secret) < 32 then return null; end if;
  if not exists (select 1 from public.push_reminders where water_on or meals_on or workout_on) then return null; end if;
  return net.http_post(url := v_url, body := '{"action":"reminders"}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-gq-reminder', v_secret),
                       timeout_milliseconds := 15000);
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gymquest-reminders') then perform cron.unschedule('gymquest-reminders'); end if;
  perform cron.schedule('gymquest-reminders', '*/5 * * * *', 'select public.reminders_dispatch()');
end $$;

-- Leaving Community also removes the reminders.
create or replace function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, reactions, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  delete from public.leaderboard_entries where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  delete from public.message_reactions where user_id = p_user;
  delete from public.profile_achievements where user_id = p_user;
  delete from public.push_reminders where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 6 $$;

revoke all on public.push_reminders from public, anon, authenticated;
revoke execute on function public.reminders_get(), public.reminders_set(jsonb), public.reminders_due(),
  public.reminders_dispatch() from public, anon, authenticated;
grant execute on function public.reminders_get(), public.reminders_set(jsonb) to authenticated;
grant execute on function public.reminders_due() to service_role;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
