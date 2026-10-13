-- GymQuest Community — migration 0011: replies and reactions in chat, shared workout plans and
-- finished workouts (in chat and in posts), and the top 3 achievements on profiles.
--
--   * messages.reply_to   — answer to an earlier message of the same chat (checked by a trigger)
--   * messages.attachment — a shared plan or workout (validated by share_attachment_valid())
--   * message_reactions   — one reaction per person per message (❤️ 😂 👍 😮 💪 🔥), participants
--                           only; deliberately NOT in the Realtime publication (Realtime sends
--                           DELETE events without RLS), the app refreshes them while a chat is open
--   * post_attachments    — a shared plan or workout under a post; visible exactly like its post
--                           (the policy reads posts under the viewer's own RLS), added only while the
--                           post waits for review, through create_post_shared()
--   * profile_achievements— achievement ids reported by the app; only real ids whose minimum
--                           workout count is met are stored; profiles show the 3 worth the most XP
--                           unless the member hides them
-- A message that carries a plan still has a normal text body, so older app versions show text.
-- community_social_version() = 5. Needs 0010. Run once, as one transaction.
-- Rollback: supabase/rollback/0011_down.sql.
begin;

do $$
begin
  if to_regclass('public.push_subscriptions') is null then raise exception '0011 needs 0010 first'; end if;
  if to_regclass('public.message_reactions') is not null then raise exception '0011 is already applied'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Shared plan / workout format (one place, used by messages and posts)
-- ---------------------------------------------------------------------------
-- { kind: 'plan'|'workout', name, date?, duration?, xp?,
--   exercises: [ { n: name, id?: built-in id, s: sets, r: reps, w: kg, d?: sets done,
--                  u?: one side at a time, sw?: [kg per set] } ] }   at most 40 exercises, 12 kB
create function public.share_attachment_valid(a jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  e jsonb;
  n integer;
begin
  if a is null then return true; end if;
  if jsonb_typeof(a) <> 'object' or octet_length(a::text) > 12000 then return false; end if;
  if coalesce(a ->> 'kind', '') not in ('plan', 'workout') then return false; end if;
  if jsonb_typeof(a -> 'name') is distinct from 'string' or char_length(a ->> 'name') not between 1 and 80 then return false; end if;
  if a ? 'date' and (jsonb_typeof(a -> 'date') <> 'string' or (a ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$') then return false; end if;
  if a ? 'duration' and (jsonb_typeof(a -> 'duration') <> 'number' or (a ->> 'duration')::numeric not between 0 and 86400) then return false; end if;
  if a ? 'xp' and (jsonb_typeof(a -> 'xp') <> 'number' or (a ->> 'xp')::numeric not between 0 and 100000) then return false; end if;
  if jsonb_typeof(a -> 'exercises') is distinct from 'array' then return false; end if;
  n := jsonb_array_length(a -> 'exercises');
  if n < 1 or n > 40 then return false; end if;
  for e in select value from jsonb_array_elements(a -> 'exercises') loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if jsonb_typeof(e -> 'n') is distinct from 'string' or char_length(e ->> 'n') not between 1 and 80 then return false; end if;
    if e ? 'id' and (jsonb_typeof(e -> 'id') <> 'string' or char_length(e ->> 'id') > 60) then return false; end if;
    if jsonb_typeof(e -> 's') is distinct from 'number' or (e ->> 's')::numeric not between 1 and 99 then return false; end if;
    if jsonb_typeof(e -> 'r') is distinct from 'number' or (e ->> 'r')::numeric not between 0 and 999 then return false; end if;
    if jsonb_typeof(e -> 'w') is distinct from 'number' or (e ->> 'w')::numeric not between 0 and 999 then return false; end if;
    if e ? 'd' and (jsonb_typeof(e -> 'd') <> 'number' or (e ->> 'd')::numeric not between 0 and 198) then return false; end if;
    if e ? 'u' and jsonb_typeof(e -> 'u') <> 'boolean' then return false; end if;
    if e ? 'sw' then
      if jsonb_typeof(e -> 'sw') <> 'array' or jsonb_array_length(e -> 'sw') > 99 then return false; end if;
      if exists (select 1 from jsonb_array_elements(e -> 'sw') x
                  where jsonb_typeof(x) <> 'number' or x::text::numeric not between 0 and 999) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Chat: replies and shared items on messages
-- ---------------------------------------------------------------------------
alter table public.messages
  add column reply_to bigint references public.messages(id) on delete set null,
  add column attachment jsonb,
  add constraint messages_attachment_check check (public.share_attachment_valid(attachment));

create function public.messages_reply_guard_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to is not null and not exists (select 1 from public.messages m
                                              where m.id = new.reply_to and m.conversation_id = new.conversation_id) then
    raise exception 'invalid_reply' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger messages_reply_guard before insert on public.messages
  for each row execute function public.messages_reply_guard_trg();

-- ---------------------------------------------------------------------------
-- 3. Chat: reactions (participants only, never moderators)
-- ---------------------------------------------------------------------------
create table public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint message_reactions_emoji_check check (emoji in ('❤️', '😂', '👍', '😮', '💪', '🔥'))
);
create index message_reactions_user_idx on public.message_reactions (user_id);
alter table public.message_reactions enable row level security;

create function public.message_visible_to_me(p_message bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages m where m.id = p_message and public.chat_participant(m.conversation_id));
$$;
create function public.message_reactable(p_message bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages m where m.id = p_message and public.chat_can_send(m.conversation_id));
$$;

create policy message_reactions_select on public.message_reactions for select to authenticated
  using (public.message_visible_to_me(message_id));
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.message_reactable(message_id));
create policy message_reactions_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.message_reactable(message_id));
create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Posts: a shared plan / workout under a post
-- ---------------------------------------------------------------------------
create table public.post_attachments (
  post_id    uuid primary key references public.posts(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  constraint post_attachments_data_check check (data is not null and public.share_attachment_valid(data))
);
alter table public.post_attachments enable row level security;
-- Visible exactly when the post is visible to the viewer (posts' own RLS applies in the subquery).
create policy post_attachments_select on public.post_attachments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_attachments.post_id));
-- Only the author, only while the post still waits for review (the content is locked afterwards).
create policy post_attachments_insert on public.post_attachments for insert to authenticated
  with check (exists (select 1 from public.posts p
                      where p.id = post_attachments.post_id and p.user_id = auth.uid() and p.status = 'pending'));

-- One call: the post (same rules as create_post) and its shared item, or nothing.
create function public.create_post_shared(p_text text, p_photos jsonb default '[]'::jsonb,
                                          p_visibility text default 'public', p_attachment jsonb default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  pid uuid;
begin
  if p_attachment is null or not public.share_attachment_valid(p_attachment) then
    raise exception 'invalid_attachment' using errcode = 'P0001';
  end if;
  pid := public.create_post(p_text, p_photos, p_visibility);
  insert into public.post_attachments (post_id, data) values (pid, p_attachment);
  return pid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Profiles: top 3 achievements
-- ---------------------------------------------------------------------------
-- The app's 25 achievements, their XP and the workouts each needs (same values as 0009).
create function public.achievement_catalog()
returns table (id text, xp integer, min_workouts integer) language sql immutable set search_path = public as $$
  values ('first', 25, 1), ('five', 50, 5), ('ten', 100, 10), ('twentyfive', 200, 25),
         ('fifty', 350, 50), ('hundred', 750, 100), ('weeklygoal1', 75, 1), ('consistent2', 125, 2),
         ('consistent4', 300, 4), ('consistent8', 500, 8), ('consistent12', 750, 12), ('solid2', 125, 2),
         ('solid4', 300, 4), ('fullweek', 200, 1), ('newpr', 75, 1), ('pr5', 150, 1), ('pr10', 300, 1),
         ('improve', 100, 1), ('xp200', 0, 0), ('customplan', 50, 0), ('fourplans', 100, 0),
         ('customex5', 125, 0), ('variety4', 150, 1), ('comeback', 100, 1), ('missedweek', 150, 1)
$$;

create table public.profile_achievements (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  ids        text[] not null default '{}',
  hidden     boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profile_achievements enable row level security;   -- no policies: functions only

-- The app reports the earned ids and its workout count; unknown ids, ids whose minimum workout
-- count is not met and 0-XP ids are dropped. Stored best first (XP, then id).
create function public.profile_achievements_set(p_ids text[], p_workouts integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_ids text[];
begin
  if v_me is null or not public.community_eligible()
     or not exists (select 1 from public.profiles where id = v_me and community_joined_at is not null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(c.id order by c.xp desc, c.id), '{}') into v_ids
    from public.achievement_catalog() c
   where c.id = any (coalesce(p_ids, '{}')) and c.xp > 0
     and least(greatest(coalesce(p_workouts, 0), 0), 100000) >= c.min_workouts;
  insert into public.profile_achievements (user_id, ids) values (v_me, v_ids)
  on conflict (user_id) do update set ids = excluded.ids, updated_at = now();
  return jsonb_build_object('count', cardinality(v_ids));
end;
$$;

create function public.profile_achievements_hide(p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.profile_achievements (user_id, hidden) values (auth.uid(), coalesce(p_hidden, false))
  on conflict (user_id) do update set hidden = excluded.hidden, updated_at = now();
end;
$$;

-- {top: [up to 3 ids], hidden, count}. Others see nothing when hidden, blocked (either way),
-- not a Community member, or suspended; the owner always sees their own.
create function public.profile_achievements_get(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_row public.profile_achievements;
begin
  if v_me is null or p_user is null then return jsonb_build_object('top', '[]'::jsonb, 'hidden', false, 'count', 0); end if;
  select * into v_row from public.profile_achievements where user_id = p_user;
  if p_user <> v_me and (not found or v_row.hidden or public.blocked_with(p_user)
     or not exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_joined_at is not null and not pr.suspended)) then
    return jsonb_build_object('top', '[]'::jsonb, 'hidden', coalesce(v_row.hidden, false) and p_user = v_me, 'count', 0);
  end if;
  return jsonb_build_object('top', to_jsonb(coalesce(v_row.ids[1:3], '{}')), 'hidden', coalesce(v_row.hidden, false),
                            'count', coalesce(cardinality(v_row.ids), 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leaving Community also removes the achievement showcase; version 5
-- ---------------------------------------------------------------------------
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
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges (explicit, minimal)
-- ---------------------------------------------------------------------------
revoke all on public.message_reactions, public.post_attachments, public.profile_achievements from public, anon, authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
-- upsert (change of reaction) rewrites all three columns; the policies keep them the caller's own
grant update (message_id, user_id, emoji) on public.message_reactions to authenticated;
grant select, insert on public.post_attachments to authenticated;

revoke execute on function public.share_attachment_valid(jsonb), public.messages_reply_guard_trg(),
  public.message_visible_to_me(bigint), public.message_reactable(bigint), public.achievement_catalog(),
  public.create_post_shared(text, jsonb, text, jsonb), public.profile_achievements_set(text[], integer),
  public.profile_achievements_hide(boolean), public.profile_achievements_get(uuid) from public, anon;
revoke execute on function public.messages_reply_guard_trg() from authenticated;
grant execute on function public.share_attachment_valid(jsonb), public.message_visible_to_me(bigint),
  public.message_reactable(bigint), public.create_post_shared(text, jsonb, text, jsonb),
  public.profile_achievements_set(text[], integer), public.profile_achievements_hide(boolean),
  public.profile_achievements_get(uuid) to authenticated;
revoke execute on function public.achievement_catalog() from authenticated;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
