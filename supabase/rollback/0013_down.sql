-- Rollback of 0013: reminders default to off again for members who never saved settings
-- (rows already saved keep their values). Run NOTIFY pgrst, 'reload schema'; afterwards.
begin;
alter table public.push_reminders alter column water_on set default false,
  alter column meals_on set default false, alter column workout_on set default false;
create or replace function public.reminders_get()
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
revoke execute on function public.reminders_get() from public, anon;
grant execute on function public.reminders_get() to authenticated;
commit;
