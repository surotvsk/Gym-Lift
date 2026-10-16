-- GymQuest Community — migration 0014: train together with a friend.
--   * train_sessions — one invitation / live session between two friends: 'invited' (valid 30 minutes),
--                      'active' (valid 6 hours from the start), 'declined', 'cancelled', 'ended'.
--                      The host may attach a workout plan (the shared-plan format of 0011).
--   * train_progress — each participant's small live summary while the session is active: plan name,
--                      current exercise, sets done / planned, last set (reps × kg), finished. Never the
--                      private workout data itself; each phone still saves its own workout offline.
--   * train_cheers   — quick cheers (💪 🔥 👏 🙌) between the two participants.
-- Only the two participants can read their rows (RLS); every change goes through the functions below,
-- which check friendship, blocks, eligibility, one live session per person and spam limits. Unfriending
-- (also Leave Community, which removes friendships) deletes the pair's sessions. Old sessions are removed
-- after 7 days. Live updates use Realtime (rows filtered by the same RLS).
-- community_social_version() = 7. Needs 0013. Run once, as one transaction.
-- Rollback: supabase/rollback/0014_down.sql.
begin;

do $$
begin
  if to_regclass('public.push_reminders') is null then raise exception '0014 needs 0012/0013 first'; end if;
  if to_regclass('public.train_sessions') is not null then raise exception '0014 is already applied'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.train_sessions (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.profiles(id) on delete cascade,
  guest_id    uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'invited' check (status in ('invited', 'active', 'declined', 'cancelled', 'ended')),
  plan        jsonb check (plan is null or (public.share_attachment_valid(plan) and plan ->> 'kind' = 'plan')),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  constraint train_sessions_two check (host_id <> guest_id)
);
create index train_sessions_host_idx on public.train_sessions (host_id, created_at desc);
create index train_sessions_guest_idx on public.train_sessions (guest_id, created_at desc);

-- { plan: text, ex: text, exId?: built-in id, done: int, total: int, last?: { r: int, w: kg }, fin?: bool }
create function public.train_progress_valid(d jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  if d is null or jsonb_typeof(d) <> 'object' or octet_length(d::text) > 1200 then return false; end if;
  if exists (select 1 from jsonb_object_keys(d) k where k not in ('plan', 'ex', 'exId', 'done', 'total', 'last', 'fin')) then return false; end if;
  if d ? 'plan' and (jsonb_typeof(d -> 'plan') <> 'string' or char_length(d ->> 'plan') > 80) then return false; end if;
  if d ? 'ex' and (jsonb_typeof(d -> 'ex') <> 'string' or char_length(d ->> 'ex') > 80) then return false; end if;
  if d ? 'exId' and (jsonb_typeof(d -> 'exId') <> 'string' or char_length(d ->> 'exId') > 60) then return false; end if;
  if jsonb_typeof(d -> 'done') is distinct from 'number' or (d ->> 'done')::numeric not between 0 and 999 then return false; end if;
  if jsonb_typeof(d -> 'total') is distinct from 'number' or (d ->> 'total')::numeric not between 0 and 999 then return false; end if;
  if d ? 'fin' and jsonb_typeof(d -> 'fin') <> 'boolean' then return false; end if;
  if d ? 'last' then
    if jsonb_typeof(d -> 'last') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(d -> 'last') k where k not in ('r', 'w')) then return false; end if;
    if jsonb_typeof(d -> 'last' -> 'r') is distinct from 'number' or (d -> 'last' ->> 'r')::numeric not between 0 and 999 then return false; end if;
    if jsonb_typeof(d -> 'last' -> 'w') is distinct from 'number' or (d -> 'last' ->> 'w')::numeric not between 0 and 999 then return false; end if;
  end if;
  return true;
end;
$$;

create table public.train_progress (
  session_id  uuid not null references public.train_sessions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  data        jsonb not null check (public.train_progress_valid(data)),
  updated_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.train_cheers (
  id          bigserial primary key,
  session_id  uuid not null references public.train_sessions(id) on delete cascade,
  from_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null check (emoji in ('💪', '🔥', '👏', '🙌')),
  created_at  timestamptz not null default now()
);
create index train_cheers_session_idx on public.train_cheers (session_id, id desc);

-- ---------------------------------------------------------------------------
-- 2. Helpers and access rules (read-only for the two participants)
-- ---------------------------------------------------------------------------
-- Still valid: an invitation for 30 minutes, an active session for 6 hours from its start.
create function public.train_live(s public.train_sessions)
returns boolean language sql stable set search_path = public as $$
  select (s.status = 'invited' and s.created_at > now() - interval '30 minutes')
      or (s.status = 'active' and coalesce(s.started_at, s.created_at) > now() - interval '6 hours');
$$;

create function public.train_participant(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.train_sessions s where s.id = sid and auth.uid() in (s.host_id, s.guest_id));
$$;

alter table public.train_sessions enable row level security;
alter table public.train_progress enable row level security;
alter table public.train_cheers   enable row level security;
create policy train_sessions_select on public.train_sessions for select to authenticated
  using (auth.uid() in (host_id, guest_id));
create policy train_progress_select on public.train_progress for select to authenticated
  using (public.train_participant(session_id));
create policy train_cheers_select on public.train_cheers for select to authenticated
  using (public.train_participant(session_id));

revoke all on public.train_sessions, public.train_progress, public.train_cheers from public, anon, authenticated;
grant select on public.train_sessions, public.train_progress, public.train_cheers to authenticated;
revoke all on sequence public.train_cheers_id_seq from public, anon, authenticated;

-- Spam limit for functions (same log as the triggers of 0005).
create function public.train_rate(k text, lim integer, win interval)
returns void language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || k));
  delete from public.rate_events where user_id = auth.uid() and kind = k and created_at < now() - win;
  select count(*) into n from public.rate_events where user_id = auth.uid() and kind = k;
  if n >= lim then raise exception 'rate_limited:%', k using errcode = 'P0001'; end if;
  insert into public.rate_events (user_id, kind) values (auth.uid(), k);
end;
$$;

-- The caller's live session (if any), locked for the change that follows.
create function public.train_busy(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.train_sessions s
                 where p_user in (s.host_id, s.guest_id) and public.train_live(s));
$$;

-- ---------------------------------------------------------------------------
-- 3. Functions used by the app
-- ---------------------------------------------------------------------------
-- Invite a friend. A previous open invitation of the caller is cancelled first.
create function public.train_invite(p_friend uuid, p_plan jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_friend is null or p_friend = auth.uid() or not public.community_eligible() or not public.are_friends(p_friend)
     or public.blocked_with(p_friend) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_plan is not null and not (public.share_attachment_valid(p_plan) and p_plan ->> 'kind' = 'plan') then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('train:' || least(auth.uid(), p_friend)::text));
  perform pg_advisory_xact_lock(hashtext('train:' || greatest(auth.uid(), p_friend)::text));
  update public.train_sessions set status = 'cancelled', ended_at = now()
   where host_id = auth.uid() and status = 'invited';
  if public.train_busy(auth.uid()) then raise exception 'train_busy_me' using errcode = 'P0001'; end if;
  if public.train_busy(p_friend) then raise exception 'train_busy_friend' using errcode = 'P0001'; end if;
  perform public.train_rate('train_invite', 30, interval '24 hours');
  delete from public.train_sessions
   where (host_id = auth.uid() or guest_id = auth.uid()) and created_at < now() - interval '7 days';
  insert into public.train_sessions (host_id, guest_id, plan) values (auth.uid(), p_friend, p_plan) returning id into sid;
  return sid;
end;
$$;

-- The guest joins or declines a still valid invitation.
create function public.train_respond(p_session uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare s public.train_sessions;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into s from public.train_sessions where id = p_session for update;
  if not found or s.guest_id <> auth.uid() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if s.status <> 'invited' or not public.train_live(s) then raise exception 'train_expired' using errcode = 'P0001'; end if;
  if p_accept then
    if not public.community_eligible() or not public.are_friends(s.host_id) or public.blocked_with(s.host_id) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if exists (select 1 from public.train_sessions o where o.id <> s.id and auth.uid() in (o.host_id, o.guest_id)
               and o.status = 'active' and public.train_live(o)) then
      raise exception 'train_busy_me' using errcode = 'P0001';
    end if;
    update public.train_sessions set status = 'active', started_at = now() where id = s.id;
    return 'active';
  end if;
  update public.train_sessions set status = 'declined', ended_at = now() where id = s.id;
  return 'declined';
end;
$$;

-- End: the host cancels an invitation, the guest declines it, either participant ends an active session.
create function public.train_end(p_session uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s public.train_sessions; v text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into s from public.train_sessions where id = p_session for update;
  if not found or auth.uid() not in (s.host_id, s.guest_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v := case when s.status = 'invited' then (case when auth.uid() = s.host_id then 'cancelled' else 'declined' end)
            when s.status = 'active' then 'ended' else s.status end;
  if v <> s.status then update public.train_sessions set status = v, ended_at = now() where id = s.id; end if;
  return v;
end;
$$;

-- My live summary while the session is active.
create function public.train_progress_put(p_session uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s public.train_sessions;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into s from public.train_sessions where id = p_session;
  if not found or auth.uid() not in (s.host_id, s.guest_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if s.status <> 'active' or not public.train_live(s) then raise exception 'train_not_active' using errcode = 'P0001'; end if;
  if not public.train_progress_valid(p_data) then raise exception 'invalid_progress' using errcode = 'P0001'; end if;
  perform public.train_rate('train_progress', 600, interval '1 hour');
  insert into public.train_progress (session_id, user_id, data, updated_at) values (s.id, auth.uid(), p_data, now())
  on conflict (session_id, user_id) do update set data = excluded.data, updated_at = now();
end;
$$;

create function public.train_cheer(p_session uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.train_sessions;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into s from public.train_sessions where id = p_session;
  if not found or auth.uid() not in (s.host_id, s.guest_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if s.status <> 'active' or not public.train_live(s) then raise exception 'train_not_active' using errcode = 'P0001'; end if;
  if p_emoji is null or p_emoji not in ('💪', '🔥', '👏', '🙌') then raise exception 'invalid_cheer' using errcode = 'P0001'; end if;
  perform public.train_rate('train_cheer', 30, interval '10 minutes');
  insert into public.train_cheers (session_id, from_id, emoji) values (s.id, auth.uid(), p_emoji);
end;
$$;

-- Everything the app shows: my live (or just finished) session with the partner's name, both summaries
-- and the partner's cheers of the last 2 minutes. null when there is none.
create function public.train_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.train_sessions; other uuid; me uuid := auth.uid();
begin
  if me is null then return null; end if;
  select * into s from public.train_sessions t
   where me in (t.host_id, t.guest_id) and public.train_live(t)
   order by t.created_at desc limit 1;
  if not found then return null; end if;
  other := case when s.host_id = me then s.guest_id else s.host_id end;
  return jsonb_build_object(
    'id', s.id, 'status', s.status, 'role', case when s.host_id = me then 'host' else 'guest' end,
    'created_at', s.created_at, 'started_at', s.started_at, 'plan', s.plan,
    'partner', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_path', p.avatar_path)
                  from public.profiles p where p.id = other),
    'mine', (select data from public.train_progress where session_id = s.id and user_id = me),
    'theirs', (select jsonb_build_object('data', data, 'updated_at', updated_at)
                 from public.train_progress where session_id = s.id and user_id = other),
    'cheers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'emoji', c.emoji, 'at', c.created_at) order by c.id), '[]'::jsonb)
                 from public.train_cheers c where c.session_id = s.id and c.from_id = other and c.created_at > now() - interval '2 minutes'));
end;
$$;

-- Unfriending (also Leave Community and blocking, which remove the friendship) removes the pair's sessions.
create function public.train_friendship_deleted_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.train_sessions
   where (host_id = old.user_a and guest_id = old.user_b) or (host_id = old.user_b and guest_id = old.user_a);
  return null;
end;
$$;
create trigger friendships_train_cleanup after delete on public.friendships
  for each row execute function public.train_friendship_deleted_trg();

revoke execute on function public.train_progress_valid(jsonb), public.train_live(public.train_sessions),
  public.train_participant(uuid), public.train_rate(text, integer, interval), public.train_busy(uuid),
  public.train_invite(uuid, jsonb), public.train_respond(uuid, boolean), public.train_end(uuid),
  public.train_progress_put(uuid, jsonb), public.train_cheer(uuid, text), public.train_current(),
  public.train_friendship_deleted_trg() from public, anon;
revoke execute on function public.train_rate(text, integer, interval), public.train_busy(uuid),
  public.train_friendship_deleted_trg() from authenticated;
grant execute on function public.train_progress_valid(jsonb), public.train_live(public.train_sessions),
  public.train_participant(uuid), public.train_invite(uuid, jsonb), public.train_respond(uuid, boolean),
  public.train_end(uuid), public.train_progress_put(uuid, jsonb), public.train_cheer(uuid, text),
  public.train_current() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Live updates and version
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['train_sessions', 'train_progress', 'train_cheers'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 7 $$;

commit;
