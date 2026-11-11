-- GymQuest — migration 0020: create an account with Google, 16+ confirmation still enforced by the server.
--
-- signInWithIdToken cannot carry user metadata, so a NEW Google account could not pass the 0005 rule
-- (raw_user_meta_data.age_16_confirmed). The app now ticks "I am 16 or older" first, then calls
-- age_ticket_create(email) (anon) and only then signs in with Google. handle_new_user() accepts a Google
-- sign-up only when a fresh (10 minutes), single-use ticket exists for exactly that e-mail. Tickets
-- store only sha256(lower(trim(email))), never the e-mail. Without a ticket the sign-up is still refused
-- (age_confirmation_required). The e-mail sign-up path (metadata) is unchanged.
-- community_social_version() = 12. Needs 0019 (version 11). Run once, as one transaction.
-- Release order: the app first (v109, it uses the ticket only when the version answers 12 or more),
-- then this migration. Rollback: supabase/rollback/0020_down.sql.
begin;

do $$
begin
  if to_regclass('public.age_tickets') is not null then raise exception '0020 is already applied'; end if;
  if public.community_social_version() <> 11 then raise exception '0020 requires version 11'; end if;
end $$;

create table public.age_tickets (
  email_hash text primary key,
  created_at timestamptz not null default now()
);
alter table public.age_tickets enable row level security;   -- bez politík: tabuľku čítajú iba funkcie
revoke all on public.age_tickets from public, anon, authenticated;

-- Zdroj súhlasu: pribúda 'google_signup' (konzistentné s 0005: age_min = 16 ostáva)
alter table public.community_consents drop constraint community_consents_source_check;
alter table public.community_consents add constraint community_consents_source_check
  check (source in ('signup', 'prompt', 'google_signup'));

create function public.age_ticket_create(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  delete from public.age_tickets where created_at < now() - interval '10 minutes';
  if (select count(*) from public.age_tickets where created_at > now() - interval '1 minute') > 600 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.age_tickets (email_hash, created_at)
  values (encode(extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'), 'hex'), now())
  on conflict (email_hash) do update set created_at = now();
end;
$$;

-- Zistenie podpory pre odhlásených (community_social_version je len pre authenticated)
create function public.age_ticket_supported()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_source text := 'signup';
  v_hash   text;
begin
  if coalesce(new.raw_user_meta_data ->> 'age_16_confirmed', '') <> 'true' then
    -- Google: potvrdenie 16+ nahrádza čerstvý jednorazový tiket pre presne tento e-mail
    if coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google' and coalesce(new.email, '') <> '' then
      v_hash := encode(extensions.digest(convert_to(lower(btrim(new.email)), 'UTF8'), 'sha256'), 'hex');
      delete from public.age_tickets
       where email_hash = v_hash and created_at > now() - interval '10 minutes';
      if found then v_source := 'google_signup'; end if;
    end if;
    if v_source <> 'google_signup' then
      raise exception 'age_confirmation_required' using errcode = 'P0001';
    end if;
  end if;
  insert into public.profiles (id, username)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10))
  on conflict (id) do nothing;
  insert into public.community_consents (user_id, source) values (new.id, v_source)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 12 $$;

revoke execute on function public.age_ticket_create(text) from public, anon, authenticated;
grant execute on function public.age_ticket_create(text) to anon, authenticated;
revoke execute on function public.age_ticket_supported() from public, anon, authenticated;
grant execute on function public.age_ticket_supported() to anon, authenticated;

commit;
