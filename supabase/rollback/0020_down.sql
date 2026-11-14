-- Rollback of 0020 (Google sign-up age ticket): restores the 0005 handle_new_user, drops age_ticket_create
-- and age_tickets (open tickets are lost; consents from Google sign-ups become 'signup'), version back to 11. One transaction.
-- Run NOTIFY pgrst, 'reload schema'; afterwards. Roll back 0020 before 0019.
begin;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'age_16_confirmed', '') <> 'true' then
    raise exception 'age_confirmation_required' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, username)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10))
  on conflict (id) do nothing;
  insert into public.community_consents (user_id, source) values (new.id, 'signup')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
update public.community_consents set source = 'signup' where source = 'google_signup';
alter table public.community_consents drop constraint community_consents_source_check;
alter table public.community_consents add constraint community_consents_source_check check (source in ('signup', 'prompt'));
drop function if exists public.age_ticket_supported();
drop function if exists public.age_ticket_create(text);
drop table if exists public.age_tickets;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 11 $$;
commit;
