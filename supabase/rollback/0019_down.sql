-- Rollback of 0019 (reminders v2): drops only what 0019 added (water_mode, water_times, custom, sent and the two
-- internal helper functions; own reminders and exact water times are lost) and restores reminders_get (0013),
-- reminders_set / reminders_due / reminders_dispatch (0012); version back to 10. One transaction.
-- Run NOTIFY pgrst, 'reload schema'; afterwards. Roll back 0019 before 0013/0012.
begin;
create or replace function public.reminders_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.push_reminders;
  v_saved boolean;
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.push_reminders where user_id = auth.uid();
  v_saved := found;
  if not v_saved then
    r.water_on := true; r.water_every := 120; r.water_from := '08:00'; r.water_to := '21:00';
    r.meals_on := true; r.meal_times := '{08:00,12:30,18:30}'; r.workout_on := true;
    r.workout_days := '{1,3,5}'; r.workout_time := '17:00'; r.tz := 'UTC';
  end if;
  return jsonb_build_object('water_on', r.water_on, 'water_every', r.water_every,
    'water_from', to_char(r.water_from, 'HH24:MI'), 'water_to', to_char(r.water_to, 'HH24:MI'),
    'meals_on', r.meals_on, 'meal_times', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb) from unnest(r.meal_times) x),
    'workout_on', r.workout_on, 'workout_days', to_jsonb(r.workout_days), 'workout_time', to_char(r.workout_time, 'HH24:MI'), 'tz', r.tz,
    'saved', v_saved);
end;
$$;
create or replace function public.reminders_set(p jsonb)
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
create or replace function public.reminders_due()
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
create or replace function public.reminders_dispatch()
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
drop function if exists public.reminders_fresh_mark(timestamptz, text, time, boolean);
drop function if exists public.reminders_slot_due(timestamptz, text, time, jsonb, text, smallint[]);
drop function if exists public.reminders_keys(time[], time[], jsonb);
alter table public.push_reminders
  drop constraint if exists push_reminders_water_mode, drop constraint if exists push_reminders_water_times,
  drop constraint if exists push_reminders_custom, drop constraint if exists push_reminders_sent,
  drop column if exists water_mode, drop column if exists water_times, drop column if exists custom, drop column if exists sent;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 10 $$;
revoke execute on function public.reminders_get(), public.reminders_set(jsonb), public.reminders_due(),
  public.reminders_dispatch() from public, anon, authenticated;
grant execute on function public.reminders_get(), public.reminders_set(jsonb) to authenticated;
grant execute on function public.reminders_due() to service_role;
commit;
