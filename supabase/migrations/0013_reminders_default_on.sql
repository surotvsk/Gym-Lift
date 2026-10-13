-- GymQuest Community — migration 0013: reminders are ON by default.
-- A member who never saved reminder settings now sees water, meals and workout reminders switched on
-- (the app then saves them once, in the phone's time zone, so they are actually sent). The switches
-- stay: anything the member turns off stays off. reminders_get() also tells whether settings were
-- ever saved ('saved'). New rows default to on. Nothing else changes; version stays 6.
-- Needs 0012. Run once, as one transaction. Rollback: supabase/rollback/0013_down.sql.
begin;

do $$
begin
  if to_regclass('public.push_reminders') is null then raise exception '0013 needs 0012 first'; end if;
end $$;

alter table public.push_reminders alter column water_on set default true,
  alter column meals_on set default true, alter column workout_on set default true;

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
revoke execute on function public.reminders_get() from public, anon;
grant execute on function public.reminders_get() to authenticated;

commit;
