-- GymQuest — migration 0019: reminders v2 (Phase 8).
--
-- Additive on push_reminders: water_mode ('interval' = every N minutes between two times as before,
-- 'times' = water at up to 12 exact times), water_times, custom (up to 10 own reminders
-- { id, text 1–60 chars, time 'HH:MM', days [1..7] }) and sent (per-slot "already sent on this local
-- date" marks). reminders_get returns the new keys too and keeps every old one. reminders_set validates
-- the new keys; a key that is ABSENT (older app, v105/v106) keeps the stored value, it never wipes it.
-- Custom text is user content: control characters are replaced by a space, it is trimmed and limited;
-- the Edge Function sends it as plain text and never logs it.
-- Due calculation (reminders_due) for meals, water times and own reminders: every slot has a
-- local date + time in the member's time zone, due from that moment for 20 minutes (4 runs of the
-- 5-minute job, so one late run is tolerated), exactly once per local date (sent marks), also over
-- midnight. A time that does not exist on a daylight-saving day fires at the shifted time, a time that
-- exists twice fires once. A reminder added after its time today is not sent retroactively.
-- community_social_version() = 11. Needs 0018 (version 10). Run once, as one transaction.
-- Release order: the Edge Function `reminders` first (it sends the new `custom` list), then this
-- migration. Rollback: supabase/rollback/0019_down.sql (drops only what 0019 added; own reminders are lost).
begin;

do $$
begin
  if to_regclass('public.push_reminders') is null then raise exception '0019 needs 0012 first'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_reminders' and column_name = 'water_mode') then
    raise exception '0019 is already applied';
  end if;
  if public.community_social_version() <> 10 then raise exception '0019 requires version 10'; end if;
end $$;

alter table public.push_reminders
  add column water_mode  text    not null default 'interval',
  add column water_times time[]  not null default '{}',
  add column custom      jsonb   not null default '[]'::jsonb,
  add column sent        jsonb   not null default '{}'::jsonb,
  add constraint push_reminders_water_mode check (water_mode in ('interval', 'times')),
  add constraint push_reminders_water_times check (cardinality(water_times) <= 12),
  add constraint push_reminders_custom check (jsonb_typeof(custom) = 'array' and jsonb_array_length(custom) <= 10),
  add constraint push_reminders_sent check (jsonb_typeof(sent) = 'object');

-- Internal: the slots of one member (key, kind m/w/c, time, weekdays for own reminders, id, text).
create function public.reminders_keys(p_meals time[], p_water time[], p_custom jsonb)
returns table (key text, kind text, t time, days smallint[], id text, txt text)
language sql immutable set search_path = public as $$
  select 'm:' || to_char(x, 'HH24:MI'), 'm', x, null::smallint[], null::text, null::text from unnest(p_meals) x
  union all
  select 'w:' || to_char(x, 'HH24:MI'), 'w', x, null::smallint[], null::text, null::text from unnest(p_water) x
  union all
  select 'c:' || (c ->> 'id') || ':' || (c ->> 'time'), 'c', (c ->> 'time')::time,
         (select array_agg((d #>> '{}')::smallint) from jsonb_array_elements(c -> 'days') d), c ->> 'id', c ->> 'text'
    from jsonb_array_elements(p_custom) c
$$;

-- Internal: the local date of the slot if it is due at p_now (within 20 minutes after it, not yet marked
-- as sent for that date, weekday allowed), otherwise null. Looks at yesterday too (window over midnight).
create function public.reminders_slot_due(p_now timestamptz, p_tz text, p_time time, p_sent jsonb, p_key text, p_days smallint[])
returns date language sql stable set search_path = public as $$
  select d from unnest(array[(p_now at time zone p_tz)::date, (p_now at time zone p_tz)::date - 1]) d
   where ((d + p_time) at time zone p_tz) <= p_now
     and p_now < ((d + p_time) at time zone p_tz) + interval '20 minutes'
     and (p_days is null or extract(isodow from d)::smallint = any (p_days))
     and (p_sent ->> p_key) is distinct from d::text
   order by d desc limit 1
$$;

-- Internal: the local date to pre-mark as "already sent" for a slot that is new / changed / in a new time zone,
-- so it is not sent retroactively: today when today's time has passed (not for meals, as before), otherwise
-- yesterday when yesterday's occurrence is still inside its 20-minute window (slot just before midnight), else null.
create function public.reminders_fresh_mark(p_now timestamptz, p_tz text, p_time time, p_meal boolean)
returns date language sql stable set search_path = public as $$
  select case
    when not p_meal and (((p_now at time zone p_tz)::date + p_time) at time zone p_tz) <= p_now then (p_now at time zone p_tz)::date
    when ((((p_now at time zone p_tz)::date - 1) + p_time) at time zone p_tz) <= p_now
         and p_now < ((((p_now at time zone p_tz)::date - 1) + p_time) at time zone p_tz) + interval '20 minutes' then (p_now at time zone p_tz)::date - 1
    else null end
$$;

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
    r.water_mode := 'interval'; r.water_times := '{}'; r.custom := '[]'::jsonb;
  end if;
  return jsonb_build_object('water_on', r.water_on, 'water_every', r.water_every,
    'water_from', to_char(r.water_from, 'HH24:MI'), 'water_to', to_char(r.water_to, 'HH24:MI'),
    'meals_on', r.meals_on, 'meal_times', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb) from unnest(r.meal_times) x),
    'workout_on', r.workout_on, 'workout_days', to_jsonb(r.workout_days), 'workout_time', to_char(r.workout_time, 'HH24:MI'), 'tz', r.tz,
    'saved', v_saved,
    'water_mode', r.water_mode,
    'water_times', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb) from unnest(r.water_times) x),
    'custom', r.custom);
end;
$$;

create or replace function public.reminders_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_tz     text := coalesce(p ->> 'tz', 'UTC');
  v_meals  time[];
  v_days   smallint[];
  v_old    public.push_reminders;
  v_mode   text;
  v_wtimes time[];
  v_custom jsonb;
  v_sent   jsonb := '{}'::jsonb;
  v_ids    text[] := '{}';
  v_oldkeys text[] := '{}';
  v_mark   date;
  c        jsonb;
  v_text   text;
  v_cdays  jsonb;
  k        record;
  hhmm     constant text := '^([01]\d|2[0-3]):[0-5]\d$';
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
  -- the workout window still has to fit inside the same day (meals, water times and own reminders may be at any time)
  if (p ->> 'workout_time')::time > '23:30' then
    raise exception 'invalid_reminders' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct (x #>> '{}')::smallint), '{}') into v_days from jsonb_array_elements(p -> 'workout_days') x;
  select * into v_old from public.push_reminders where user_id = v_me;
  -- Apps v105/v106 know only 3 meal inputs: their payload has no water_mode (v107+ always sends it) and at most
  -- 3 meal times, which replace the first 3 stored times; stored times 4–6 (set by a newer app) are kept.
  if not (p ? 'water_mode') and jsonb_array_length(p -> 'meal_times') <= 3 and cardinality(v_old.meal_times) > 3 then
    select coalesce(array_agg(distinct m), '{}') into v_meals from unnest(v_meals || v_old.meal_times[4:]) m;
  end if;

  -- new keys: absent = keep what is stored (older apps never send them)
  if p ? 'water_mode' then
    if jsonb_typeof(p -> 'water_mode') is distinct from 'string' or (p ->> 'water_mode') not in ('interval', 'times') then
      raise exception 'invalid_reminders' using errcode = 'P0001';
    end if;
    v_mode := p ->> 'water_mode';
  else
    v_mode := coalesce(v_old.water_mode, 'interval');
  end if;
  if p ? 'water_times' then
    if jsonb_typeof(p -> 'water_times') is distinct from 'array' or jsonb_array_length(p -> 'water_times') > 12
       or exists (select 1 from jsonb_array_elements(p -> 'water_times') x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ hhmm) then
      raise exception 'invalid_reminders' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(distinct (x #>> '{}')::time), '{}') into v_wtimes from jsonb_array_elements(p -> 'water_times') x;
  else
    v_wtimes := coalesce(v_old.water_times, '{}');
  end if;
  if p ? 'custom' then
    if jsonb_typeof(p -> 'custom') is distinct from 'array' or jsonb_array_length(p -> 'custom') > 10 then
      raise exception 'invalid_reminders' using errcode = 'P0001';
    end if;
    v_custom := '[]'::jsonb;
    for c in select x from jsonb_array_elements(p -> 'custom') x loop
      if jsonb_typeof(c) <> 'object' or jsonb_typeof(c -> 'id') is distinct from 'string' or (c ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$'
         or (c ->> 'id') = any (v_ids) or jsonb_typeof(c -> 'text') is distinct from 'string' or char_length(c ->> 'text') > 500
         or jsonb_typeof(c -> 'time') is distinct from 'string' or (c ->> 'time') !~ hhmm
         or jsonb_typeof(c -> 'days') is distinct from 'array' or jsonb_array_length(c -> 'days') not between 1 and 7
         or exists (select 1 from jsonb_array_elements(c -> 'days') d where jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[1-7]$') then
        raise exception 'invalid_reminders' using errcode = 'P0001';
      end if;
      v_ids := v_ids || (c ->> 'id');
      -- plain text: control characters → space, whitespace collapsed, trimmed, 1–60 characters
      v_text := btrim(regexp_replace(regexp_replace(c ->> 'text', '[\u0001-\u001f\u007f-\u009f\u2028\u2029]', ' ', 'g'), '\s{2,}', ' ', 'g'));
      if char_length(v_text) not between 1 and 60 then raise exception 'invalid_reminders' using errcode = 'P0001'; end if;
      select jsonb_agg(d order by d) into v_cdays from (select distinct (x #>> '{}')::int d from jsonb_array_elements(c -> 'days') x) q;
      v_custom := v_custom || jsonb_build_array(jsonb_build_object('id', c ->> 'id', 'text', v_text, 'time', c ->> 'time', 'days', v_cdays));
    end loop;
  else
    v_custom := coalesce(v_old.custom, '[]'::jsonb);
  end if;

  -- sent marks: keep those of unchanged slots (same time zone); a slot added/changed (or in a new time zone)
  -- whose time has just passed is marked as sent (reminders_fresh_mark): no retroactive reminder.
  if v_old.user_id is not null and v_old.tz = v_tz then
    select coalesce(array_agg(o.key), '{}') into v_oldkeys from public.reminders_keys(v_old.meal_times, v_old.water_times, v_old.custom) o;
  end if;
  for k in select * from public.reminders_keys(v_meals, v_wtimes, v_custom) loop
    if k.key = any (v_oldkeys) then
      if v_old.sent ? k.key then v_sent := v_sent || jsonb_build_object(k.key, v_old.sent -> k.key); end if;
    else
      v_mark := public.reminders_fresh_mark(now(), v_tz, k.t, k.kind = 'm');
      if v_mark is not null then v_sent := v_sent || jsonb_build_object(k.key, v_mark::text); end if;
    end if;
  end loop;

  insert into public.push_reminders (user_id, tz, water_on, water_every, water_from, water_to, meals_on, meal_times,
                                     workout_on, workout_days, workout_time, last_water, water_mode, water_times, custom, sent, updated_at)
  values (v_me, v_tz, coalesce((p ->> 'water_on')::boolean, false), coalesce((p ->> 'water_every')::integer, 120),
          (p ->> 'water_from')::time, (p ->> 'water_to')::time, coalesce((p ->> 'meals_on')::boolean, false), v_meals,
          coalesce((p ->> 'workout_on')::boolean, false), v_days, (p ->> 'workout_time')::time,
          case when coalesce((p ->> 'water_on')::boolean, false) and not coalesce(v_old.water_on, false) then now() else v_old.last_water end,
          v_mode, v_wtimes, v_custom, v_sent, now())
  on conflict (user_id) do update set tz = excluded.tz, water_on = excluded.water_on, water_every = excluded.water_every,
    water_from = excluded.water_from, water_to = excluded.water_to, meals_on = excluded.meals_on, meal_times = excluded.meal_times,
    workout_on = excluded.workout_on, workout_days = excluded.workout_days, workout_time = excluded.workout_time,
    last_water = excluded.last_water, water_mode = excluded.water_mode, water_times = excluded.water_times,
    custom = excluded.custom, sent = excluded.sent, updated_at = now();
  return public.reminders_get();
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  raise exception 'invalid_reminders' using errcode = 'P0001';
end;
$$;

-- Edge Function only (service_role): who is due right now. Marks what it returns as sent.
-- water (interval): inside the from–to window and at least water_every minutes since the last one;
-- water (times) / meals / own reminders: per slot, see reminders_slot_due; workout: as before.
-- Returns { kinds: [...], custom: [{id, text}], subs: [...] } per member.
create or replace function public.reminders_due()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      public.push_reminders;
  lt     timestamp;
  kinds  text[];
  cust   jsonb;
  v_sent jsonb;
  k      record;
  d      date;
  out    jsonb := '[]'::jsonb;
  subs   jsonb;
begin
  for r in select pr.* from public.push_reminders pr
            where (pr.water_on or pr.meals_on or pr.workout_on or jsonb_array_length(pr.custom) > 0)
              and exists (select 1 from public.push_subscriptions s where s.user_id = pr.user_id)
            for update skip locked loop
    lt := now() at time zone r.tz;
    kinds := '{}';
    cust := '[]'::jsonb;
    v_sent := r.sent;
    if r.water_on and r.water_mode = 'interval' and lt::time >= r.water_from and lt::time <= r.water_to
       and (r.last_water is null or now() - r.last_water >= make_interval(mins => r.water_every)) then
      kinds := kinds || 'water'::text;
      update public.push_reminders set last_water = now() where user_id = r.user_id;
    end if;
    for k in select * from public.reminders_keys(case when r.meals_on then r.meal_times else '{}' end,
                                                 case when r.water_on and r.water_mode = 'times' then r.water_times else '{}' end,
                                                 r.custom) loop
      d := public.reminders_slot_due(now(), r.tz, k.t, v_sent, k.key, k.days);
      if d is null then continue; end if;
      v_sent := v_sent || jsonb_build_object(k.key, d::text);
      if k.kind = 'm' then
        if not 'meal' = any (kinds) then kinds := kinds || 'meal'::text; end if;
        update public.push_reminders set last_meal = now() where user_id = r.user_id;
      elsif k.kind = 'w' then
        if not 'water' = any (kinds) then kinds := kinds || 'water'::text; end if;
      else
        cust := cust || jsonb_build_array(jsonb_build_object('id', k.id, 'text', k.txt));
      end if;
    end loop;
    if v_sent is distinct from r.sent then
      update public.push_reminders set sent = v_sent where user_id = r.user_id;
    end if;
    if r.workout_on and extract(isodow from lt)::smallint = any (r.workout_days)
       and lt::time >= r.workout_time and lt::time < r.workout_time + interval '20 minutes'
       and r.last_workout is distinct from lt::date then
      kinds := kinds || 'workout'::text;
      update public.push_reminders set last_workout = lt::date where user_id = r.user_id;
    end if;
    if cardinality(kinds) > 0 or jsonb_array_length(cust) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang)), '[]'::jsonb)
        into subs from public.push_subscriptions s where s.user_id = r.user_id;
      out := out || jsonb_build_object('kinds', to_jsonb(kinds), 'custom', cust, 'subs', subs);
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
  if not exists (select 1 from public.push_reminders where water_on or meals_on or workout_on or jsonb_array_length(custom) > 0) then return null; end if;
  return net.http_post(url := v_url, body := '{"action":"reminders"}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-gq-reminder', v_secret),
                       timeout_milliseconds := 15000);
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 11 $$;

revoke execute on function public.reminders_keys(time[], time[], jsonb), public.reminders_fresh_mark(timestamptz, text, time, boolean), public.reminders_slot_due(timestamptz, text, time, jsonb, text, smallint[])
  from public, anon, authenticated, service_role;
revoke execute on function public.reminders_get(), public.reminders_set(jsonb), public.reminders_due(),
  public.reminders_dispatch() from public, anon, authenticated;
grant execute on function public.reminders_get(), public.reminders_set(jsonb) to authenticated;
grant execute on function public.reminders_due() to service_role;

commit;
