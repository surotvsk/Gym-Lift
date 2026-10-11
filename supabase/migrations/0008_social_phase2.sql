-- ============================================================================
-- GymQuest Community — migration 0008: friends, live chat, comments, user search
-- (Phase 2). Needs 0001–0006. 0007 is reserved for auto-publish.
-- ----------------------------------------------------------------------------
-- Adds:
--   * friends: friend requests (accepted only through accept_friend_request)
--     and friendships; friend lists are visible only to the two friends;
--   * posts.visibility 'public' | 'friends': friends-only posts are visible only
--     to the author's friends (never in Everyone / Following, never shareable);
--   * one-to-one chat between friends: conversations, messages (participants
--     only — moderators can NEVER read them), read markers; new messages are
--     published to Supabase Realtime under the same access rules;
--   * comments on visible posts (author, post author or a moderator can delete);
--   * user search: only Community members (community_joined_at set when they
--     open Community) who keep "Show me in search" on (default on);
--   * reports of a message or comment store ONLY a copy of that one item;
--   * blocking also removes the friendship, requests, the chat and the blocked
--     user's comments on the blocker's posts;
--   * a daily pg_cron purge: chats closed by unfriending after 30 days,
--     messages older than 12 months, report copies 90 days after resolution;
--   * community_leave_cleanup(uid) for the delete-account function (Leave
--     Community). Full account deletion removes everything through FK cascades.
--
-- Backward compatible with the v47/v48 app: same function names and arguments
-- (extra result columns only); community_social_version() becomes 2.
--
-- Private data is untouched: backups, backup_versions and the backups bucket.
--
-- Rollback: supabase/rollback/0008_down.sql (moves the new tables into the
-- unexposed schema community_rollback; friends-only posts stay hidden).
-- Apply ONCE, in one transaction, after 0005 and 0006.
-- ============================================================================

begin;

do $$ begin
  if to_regclass('public.follows') is null then
    raise exception '0008 needs 0005 (public.follows is missing)';
  end if;
  if to_regclass('public.friendships') is not null then
    raise exception '0008 is already applied (public.friendships exists)';
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise exception '0008 needs the pg_cron extension (daily chat purge)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tables (moved back from community_rollback if a rollback archived them)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['friend_requests', 'friendships', 'conversations', 'messages', 'chat_reads',
                           'post_comments'] loop
    if to_regclass('community_rollback.' || t) is not null then
      execute format('alter table community_rollback.%I set schema public', t);
    end if;
  end loop;
end $$;

-- Search membership and preference (kept by a rollback, so re-applying keeps choices).
alter table public.profiles
  add column if not exists searchable boolean not null default true,
  add column if not exists community_joined_at timestamptz;
create index if not exists profiles_member_idx on public.profiles (lower(username))
  where community_joined_at is not null;

-- Friends-only posts (kept by a rollback, which keeps them hidden from non-friends).
alter table public.posts add column if not exists visibility text not null default 'public';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_visibility_check'
                  and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_visibility_check check (visibility in ('public', 'friends'));
  end if;
end $$;

create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friend_requests_pair_key unique (from_id, to_id),
  constraint friend_requests_not_self check (from_id <> to_id)
);
create index if not exists friend_requests_to_idx on public.friend_requests (to_id, created_at desc);

-- One row per pair, stored in a fixed order (user_a < user_b).
create table if not exists public.friendships (
  user_a     uuid not null references public.profiles(id) on delete cascade,
  user_b     uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_order check (user_a < user_b)
);
create index if not exists friendships_b_idx on public.friendships (user_b);

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  closed_at       timestamptz,
  constraint conversations_pair_key unique (user_a, user_b),
  constraint conversations_order check (user_a < user_b)
);
create index if not exists conversations_b_idx on public.conversations (user_b);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now(),
  constraint messages_body_len check (char_length(btrim(body)) between 1 and 2000)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id desc);
create index if not exists messages_created_idx on public.messages (created_at);

create table if not exists public.chat_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_id    bigint not null default 0,
  primary key (conversation_id, user_id)
);

create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint post_comments_body_len check (char_length(btrim(body)) between 1 and 1000)
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_user_idx on public.post_comments (user_id);

-- Comment counter (derived; rebuilt in section 7).
alter table public.post_stats add column if not exists comments integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'post_stats_comments_check'
                  and conrelid = 'public.post_stats'::regclass) then
    alter table public.post_stats add constraint post_stats_comments_check check (comments >= 0);
  end if;
end $$;

-- Reports of a message / comment keep a copy of that one item only (no FK: the
-- copy survives the deletion of the original). resolved_at drives the purge.
alter table public.reports
  add column if not exists message_id      bigint,
  add column if not exists message_excerpt text,
  add column if not exists comment_id      uuid,
  add column if not exists comment_excerpt text,
  add column if not exists resolved_at     timestamptz;
alter table public.reports
  add constraint reports_message_excerpt_len check (char_length(message_excerpt) <= 2000),
  add constraint reports_comment_excerpt_len check (char_length(comment_excerpt) <= 1000);

-- ---------------------------------------------------------------------------
-- 2. Helper functions — all evaluate the CALLER (auth.uid()).
-- ---------------------------------------------------------------------------

-- Feature detection: 2 = Phase 2 (friends, chat, comments, search).
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 2 $$;

create function public.are_friends(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
                 where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other));
$$;

-- 'self' | 'friends' | 'outgoing' (I asked) | 'incoming' (they asked) | 'none'
create function public.friend_state(other uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or other is null then 'none'
    when other = auth.uid() then 'self'
    when public.are_friends(other) then 'friends'
    when exists (select 1 from public.friend_requests where from_id = auth.uid() and to_id = other) then 'outgoing'
    when exists (select 1 from public.friend_requests where from_id = other and to_id = auth.uid()) then 'incoming'
    else 'none' end;
$$;

-- The post is approved, its author visible, and the caller may see it.
create or replace function public.post_interactable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where p.id = pid and p.status = 'approved' and public.author_visible(p.user_id)
                   and (p.visibility = 'public' or p.user_id = auth.uid() or public.are_friends(p.user_id)));
$$;

-- Only public posts of others can be shared.
create or replace function public.post_repostable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.post_interactable(pid)
         and exists (select 1 from public.posts where id = pid and visibility = 'public' and user_id <> auth.uid());
$$;

create or replace function public.community_object_visible(obj text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where (p.image_path = obj or p.thumb_path = obj)
                   and p.status = 'approved' and public.author_visible(p.user_id)
                   and (p.visibility = 'public' or public.are_friends(p.user_id)))
      or exists (select 1 from public.post_media m join public.posts p on p.id = m.post_id
                 where (m.image_path = obj or m.thumb_path = obj)
                   and p.status = 'approved' and public.author_visible(p.user_id)
                   and (p.visibility = 'public' or public.are_friends(p.user_id)));
$$;

-- A friend request is possible: both are Community members, eligible, no block,
-- not friends yet, the target is not suspended, and they have not asked me already.
create function public.can_request_friend(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and target is not null and target <> auth.uid()
     and public.community_eligible()
     and exists (select 1 from public.profiles where id = auth.uid() and community_joined_at is not null)
     and exists (select 1 from public.profiles where id = target and community_joined_at is not null and not suspended)
     and not public.blocked_with(target)
     and not public.are_friends(target)
     and not exists (select 1 from public.friend_requests where from_id = target and to_id = auth.uid());
$$;

create function public.chat_participant(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations
                 where id = conv and auth.uid() in (user_a, user_b));
$$;

-- Sending needs an open chat between friends, no block, and an eligible sender.
create function public.chat_can_send(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c
                 where c.id = conv and auth.uid() in (c.user_a, c.user_b) and c.closed_at is null
                   and public.are_friends(case when c.user_a = auth.uid() then c.user_b else c.user_a end)
                   and not public.blocked_with(case when c.user_a = auth.uid() then c.user_b else c.user_a end))
     and public.community_eligible();
$$;

-- Joining Community (the app calls this when a confirmed user opens it).
create function public.community_join()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.has_age_consent() then raise exception 'age_confirmation_required' using errcode = 'P0001'; end if;
  update public.profiles set community_joined_at = coalesce(community_joined_at, now())
   where id = auth.uid() and community_joined_at is null;
end;
$$;

create function public.set_searchable(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles set searchable = coalesce(p_on, true) where id = auth.uid();
end;
$$;

-- User search: Community members who keep search on; no blocked or suspended accounts.
create function public.search_users(p_query text, p_limit integer default 20)
returns table (id uuid, username text, avatar_path text, moderator boolean, i_follow boolean, friend_state text)
language sql stable security invoker set search_path = public as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as v)
  select pr.id, pr.username, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended),
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = pr.id),
         public.friend_state(pr.id)
    from public.profiles pr, q
   where char_length(q.v) between 2 and 30
     and public.has_age_consent()
     and pr.searchable and pr.community_joined_at is not null and not pr.suspended
     and pr.id <> auth.uid()
     and not public.blocked_with(pr.id)
     and strpos(lower(pr.username), q.v) > 0
   order by (lower(pr.username) = q.v) desc, (strpos(lower(pr.username), q.v) = 1) desc, lower(pr.username)
   limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

-- Friend requests: accepting creates the friendship and reopens a closed chat.
create function public.accept_friend_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into r from public.friend_requests where id = p_request and to_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not public.community_eligible() or public.blocked_with(r.from_id)
     or coalesce((select suspended from public.profiles where id = r.from_id), true) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.friendships (user_a, user_b) values (least(r.from_id, r.to_id), greatest(r.from_id, r.to_id))
  on conflict do nothing;
  delete from public.friend_requests
   where (from_id = r.from_id and to_id = r.to_id) or (from_id = r.to_id and to_id = r.from_id);
  update public.conversations set closed_at = null
   where user_a = least(r.from_id, r.to_id) and user_b = greatest(r.from_id, r.to_id);
end;
$$;

-- My friends (private: nobody else can list them).
create function public.friends_list()
returns table (user_id uuid, username text, avatar_path text, moderator boolean, since timestamptz)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.username, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended), f.created_at
    from public.friendships f
    join public.profiles pr on pr.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
   where auth.uid() in (f.user_a, f.user_b)
   order by lower(pr.username);
$$;

-- My incoming and outgoing friend requests.
create function public.friend_requests_list()
returns table (request_id uuid, direction text, user_id uuid, username text, avatar_path text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select r.id, case when r.to_id = auth.uid() then 'incoming' else 'outgoing' end,
         pr.id, pr.username, pr.avatar_path, r.created_at
    from public.friend_requests r
    join public.profiles pr on pr.id = case when r.to_id = auth.uid() then r.from_id else r.to_id end
   where auth.uid() in (r.from_id, r.to_id)
   order by r.created_at desc;
$$;

-- Open (or reopen) the chat with a friend; returns the conversation id.
create function public.open_chat(p_friend uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.community_eligible() or not public.are_friends(p_friend) or public.blocked_with(p_friend) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.conversations (user_a, user_b)
  values (least(auth.uid(), p_friend), greatest(auth.uid(), p_friend))
  on conflict (user_a, user_b) do update set closed_at = null
  returning id into cid;
  return cid;
end;
$$;

-- My conversations with the other person, the last message and my unread count.
create function public.chat_list()
returns table (conversation_id uuid, other_id uuid, other_name text, other_avatar text,
               last_message_at timestamptz, last_body text, last_from_me boolean, unread integer,
               closed boolean, can_send boolean)
language sql stable security invoker set search_path = public as $$
  select c.id, o.id, o.username, o.avatar_path, c.last_message_at, lm.body, lm.sender_id = auth.uid(),
         (select count(*)::int from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.id > coalesce((select r.last_read_id from public.chat_reads r
                                   where r.conversation_id = c.id and r.user_id = auth.uid()), 0)),
         c.closed_at is not null, public.chat_can_send(c.id)
    from public.conversations c
    join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
    left join lateral (select m.body, m.sender_id from public.messages m
                        where m.conversation_id = c.id order by m.id desc limit 1) lm on true
   where auth.uid() in (c.user_a, c.user_b)
   order by coalesce(c.last_message_at, c.created_at) desc;
$$;

-- Total unread messages (for the badge).
create function public.chat_unread_total()
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where auth.uid() in (c.user_a, c.user_b) and m.sender_id <> auth.uid()
     and m.id > coalesce((select r.last_read_id from public.chat_reads r
                           where r.conversation_id = c.id and r.user_id = auth.uid()), 0);
$$;

create function public.mark_read(p_conversation uuid, p_last_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  top bigint;
begin
  if not public.chat_participant(p_conversation) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select max(id) into top from public.messages where conversation_id = p_conversation;
  top := least(coalesce(p_last_id, top, 0), coalesce(top, 0));
  insert into public.chat_reads (conversation_id, user_id, last_read_id) values (p_conversation, auth.uid(), top)
  on conflict (conversation_id, user_id) do update
     set last_read_id = greatest(public.chat_reads.last_read_id, excluded.last_read_id);
end;
$$;

-- Comments of one post, oldest first (RLS on posts and post_comments applies).
create function public.post_comments_list(p_post uuid, p_after timestamptz default null, p_limit integer default 50)
returns table (id uuid, user_id uuid, username text, avatar_path text, moderator boolean, body text,
               created_at timestamptz, can_delete boolean)
language sql stable security invoker set search_path = public as $$
  select c.id, c.user_id, pr.username, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended), c.body,
         c.created_at, (c.user_id = auth.uid() or p.user_id = auth.uid() or public.is_moderator())
    from public.post_comments c
    join public.posts p on p.id = c.post_id
    join public.profiles pr on pr.id = c.user_id
   where c.post_id = p_post and (p_after is null or c.created_at > p_after)
   order by c.created_at, c.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Report one message: only the reported message is copied; moderators never
-- see the conversation.
create function public.report_message(p_message bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select msg.id, msg.sender_id, msg.body into m
    from public.messages msg
   where msg.id = p_message and public.chat_participant(msg.conversation_id);
  if not found or m.sender_id = auth.uid() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if public.is_suspended() or not public.moderation_ready() then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.reports (reporter_id, reported_user_id, reason, message_id, message_excerpt)
  values (auth.uid(), m.sender_id, left(coalesce(p_reason, ''), 500), m.id, left(m.body, 2000));
end;
$$;

-- Report one comment (comments are public content; a copy keeps the evidence).
create function public.report_comment(p_comment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select pc.id, pc.user_id, pc.post_id, pc.body into c from public.post_comments pc where pc.id = p_comment;
  if not found or c.user_id = auth.uid() or not public.post_interactable(c.post_id)
     or not public.author_visible(c.user_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if public.is_suspended() or not public.moderation_ready() then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.reports (reporter_id, reported_user_id, post_id, reason, comment_id, comment_excerpt)
  values (auth.uid(), c.user_id, c.post_id, left(coalesce(p_reason, ''), 500), c.id, left(c.body, 1000));
end;
$$;

-- Leave Community cleanup, called by the delete-account function (service_role only).
create function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

-- Daily purge (pg_cron): chats closed by unfriending after 30 days, messages
-- older than 12 months, report copies 90 days after resolution.
create function public.chat_purge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_conv integer;
  n_msg  integer;
  n_rep  integer;
begin
  delete from public.conversations where closed_at is not null and closed_at < now() - interval '30 days';
  get diagnostics n_conv = row_count;
  delete from public.messages where created_at < now() - interval '12 months';
  get diagnostics n_msg = row_count;
  update public.reports set message_excerpt = null, comment_excerpt = null
   where resolved_at < now() - interval '90 days' and (message_excerpt is not null or comment_excerpt is not null);
  get diagnostics n_rep = row_count;
  return jsonb_build_object('conversations', n_conv, 'messages', n_msg, 'report_copies', n_rep);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Changed existing objects
-- ---------------------------------------------------------------------------

-- 3a. Posts guard: as 0005, plus visibility locked once the post left 'pending'.
create or replace function public.posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.status := 'pending';
    new.published_at := null;
    new.created_at := now();
    return new;
  end if;
  if not public.is_moderator() then
    if old.status <> 'pending' and (new.caption is distinct from old.caption
                                    or new.visibility is distinct from old.visibility) then
      raise exception 'post_locked' using errcode = 'P0001';
    end if;
    new.status := old.status;
    new.published_at := old.published_at;
    new.user_id := old.user_id;
    new.image_path := old.image_path;
    new.thumb_path := old.thumb_path;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- 3b. Friends-only posts: visible to the author's friends (and author/moderators).
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (
  (status = 'approved' and public.has_age_consent() and public.author_visible(user_id)
   and (visibility = 'public' or public.are_friends(user_id)))
  or user_id = auth.uid() or public.is_moderator()
);

-- 3c. Reports inserted directly can never carry a message/comment copy (only
--     report_message / report_comment write those).
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (
  reporter_id = auth.uid() and not public.is_suspended() and public.moderation_ready()
  and message_id is null and message_excerpt is null and comment_id is null and comment_excerpt is null
);

-- 3d. create_post gains a visibility (the 2-argument calls of v47/v48 still work).
drop function public.create_post(text, jsonb);
create function public.create_post(p_text text, p_photos jsonb default '[]'::jsonb,
                                   p_visibility text default 'public')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  pid uuid;
  n   integer;
  i   integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  p_photos := coalesce(p_photos, '[]'::jsonb);
  if jsonb_typeof(p_photos) <> 'array' then raise exception 'invalid_photos' using errcode = 'P0001'; end if;
  n := jsonb_array_length(p_photos);
  if n > 4 then raise exception 'too_many_photos' using errcode = 'P0001'; end if;
  insert into public.posts (user_id, caption, image_path, thumb_path, visibility)
  values (auth.uid(), btrim(coalesce(p_text, '')),
          case when n > 0 then p_photos -> 0 ->> 'image' end,
          case when n > 0 then p_photos -> 0 ->> 'thumb' end,
          coalesce(p_visibility, 'public'))
  returning id into pid;
  for i in 1 .. n - 1 loop
    insert into public.post_media (post_id, position, image_path, thumb_path)
    values (pid, i, p_photos -> i ->> 'image', p_photos -> i ->> 'thumb');
  end loop;
  return pid;
end;
$$;

-- 3e. Report review: upholding a comment report deletes the comment.
create or replace function public.resolve_report(p_report uuid, p_outcome text, p_remove_post boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  rep_post    uuid;
  rep_user    uuid;
  rep_comment uuid;
  target      uuid;
begin
  if not public.is_moderator() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'dismissed') then raise exception 'invalid_outcome' using errcode = 'P0001'; end if;
  update public.reports set status = 'resolved'
   where id = p_report and status = 'open'
  returning post_id, reported_user_id, comment_id into rep_post, rep_user, rep_comment;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  target := coalesce(rep_user, (select user_id from public.posts where id = rep_post));
  if target is not null then
    insert into public.moderation_actions (user_id, post_id, report_id, action, moderator_id)
    values (target, rep_post, p_report, 'report_' || p_outcome, auth.uid());
  end if;
  if p_outcome = 'upheld' and p_remove_post then
    if rep_comment is not null then
      delete from public.post_comments where id = rep_comment;
    elsif rep_post is not null then
      update public.posts set status = 'rejected' where id = rep_post and status = 'approved';   -- logged as 'remove'
    end if;
  end if;
end;
$$;

-- 3f. Feeds: Everyone / Following show public posts only; 'friends' shows the
--     posts (public and friends-only) of my friends; 'user' shows a profile's
--     posts the caller may see. Adds the comment count and the visibility.
drop function public.community_feed(text, uuid, timestamptz, uuid, integer);
create function public.community_feed(p_scope text default 'everyone', p_user uuid default null,
                                      p_before timestamptz default null, p_before_id uuid default null,
                                      p_limit integer default 12)
returns table (post_id uuid, author_id uuid, author_name text, author_avatar text, author_moderator boolean,
               caption text, photos jsonb, activity_at timestamptz, reposted_by uuid, reposted_by_name text,
               likes integer, reposts integer, liked_by_me boolean, reposted_by_me boolean,
               comments integer, visibility text)
language sql stable security invoker set search_path = public as $$
  with followed as (
    select f.followee_id as id from public.follows f
     where p_scope = 'following' and f.follower_id = auth.uid()
  ),
  friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as id
      from public.friendships f
     where p_scope = 'friends' and auth.uid() in (f.user_a, f.user_b)
  ),
  items as (
    select p.id as post_id, null::uuid as reposted_by, coalesce(p.published_at, p.created_at) as activity_at
      from public.posts p
     where p.status = 'approved'
       and case p_scope when 'everyone'  then p.visibility = 'public'
                        when 'user'      then p.user_id = p_user
                        when 'following' then p.visibility = 'public' and p.user_id in (select id from followed)
                        when 'friends'   then p.user_id in (select id from friends)
                        else false end
    union all
    select r.post_id, r.user_id, r.created_at
      from public.reposts r
     where p_scope = 'following' and r.user_id in (select id from followed)
  ),
  latest as (
    select distinct on (i.post_id) i.post_id, i.reposted_by, i.activity_at
      from items i
     order by i.post_id, i.activity_at desc
  )
  select l.post_id, p.user_id, a.username, a.avatar_path, (a.role = 'moderator' and not a.suspended),
         p.caption,
         case when p.image_path is null then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object('image', p.image_path, 'thumb', p.thumb_path))
                   || coalesce((select jsonb_agg(jsonb_build_object('image', m.image_path, 'thumb', m.thumb_path)
                                                 order by m.position)
                                  from public.post_media m where m.post_id = p.id), '[]'::jsonb) end,
         l.activity_at, l.reposted_by, rb.username, coalesce(s.likes, 0), coalesce(s.reposts, 0),
         exists (select 1 from public.likes k where k.post_id = l.post_id and k.user_id = auth.uid()),
         exists (select 1 from public.reposts k where k.post_id = l.post_id and k.user_id = auth.uid()),
         coalesce(s.comments, 0), p.visibility
    from latest l
    join public.posts p on p.id = l.post_id and p.status = 'approved'
    join public.profiles a on a.id = p.user_id
    left join public.profiles rb on rb.id = l.reposted_by
    left join public.post_stats s on s.post_id = l.post_id
   where public.has_age_consent()
     and public.author_visible(p.user_id)
     and (p.visibility = 'public' or p.user_id = auth.uid() or public.are_friends(p.user_id))
     and (l.reposted_by is null or (rb.id is not null and public.author_visible(l.reposted_by)))
     and (p_before is null
          or (l.activity_at, l.post_id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by l.activity_at desc, l.post_id desc
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

-- 3g. Profile card: friend state, friend count / search setting (own profile only),
--     Community membership.
drop function public.profile_card(uuid);
create function public.profile_card(p_user uuid)
returns table (id uuid, username text, bio text, avatar_path text, moderator boolean, suspended boolean,
               followers integer, following integer, posts integer, i_follow boolean, blocked_by_me boolean,
               friend_state text, friends integer, searchable boolean, member boolean)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.username, pr.bio, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended),
         case when pr.id = auth.uid() or public.is_moderator() then pr.suspended end,
         coalesce(st.followers, 0), coalesce(st.following, 0),
         (select count(*)::int from public.posts p where p.user_id = pr.id and p.status = 'approved'
             and (p.visibility = 'public' or pr.id = auth.uid() or public.are_friends(pr.id))),
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = pr.id),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = pr.id),
         public.friend_state(pr.id),
         case when pr.id = auth.uid() then
           (select count(*)::int from public.friendships f where auth.uid() in (f.user_a, f.user_b)) end,
         case when pr.id = auth.uid() then pr.searchable end,
         pr.community_joined_at is not null
    from public.profiles pr
    left join public.profile_stats st on st.user_id = pr.id
   where pr.id = p_user and (pr.id = auth.uid() or public.has_age_consent());
$$;

-- 3h. Blocking also removes the friendship, pending requests, the chat and the
--     blocked user's comments on the blocker's posts.
create or replace function public.blocks_social_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from public.likes l using public.posts p
   where l.post_id = p.id and p.user_id = new.blocker_id and l.user_id = new.blocked_id;
  delete from public.reposts r using public.posts p
   where r.post_id = p.id and p.user_id = new.blocker_id and r.user_id = new.blocked_id;
  delete from public.conversations
   where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  delete from public.friendships
   where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  delete from public.friend_requests
   where (from_id = new.blocker_id and to_id = new.blocked_id) or (from_id = new.blocked_id and to_id = new.blocker_id);
  delete from public.post_comments c using public.posts p
   where c.post_id = p.id and p.user_id = new.blocker_id and c.user_id = new.blocked_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security on the new tables (signed-in users only)
-- ---------------------------------------------------------------------------

alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;
alter table public.chat_reads      enable row level security;
alter table public.post_comments   enable row level security;

create policy friend_requests_select on public.friend_requests for select to authenticated
  using (auth.uid() in (from_id, to_id));
create policy friend_requests_insert on public.friend_requests for insert to authenticated
  with check (from_id = auth.uid() and public.can_request_friend(to_id));
create policy friend_requests_delete on public.friend_requests for delete to authenticated
  using (auth.uid() in (from_id, to_id));

-- Friend lists are private: only the two friends see the row.
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (user_a, user_b));

create policy conversations_select on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy conversations_delete on public.conversations for delete to authenticated
  using (auth.uid() in (user_a, user_b));

-- Messages: the two participants only — no moderator access.
create policy messages_select on public.messages for select to authenticated
  using (public.chat_participant(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_can_send(conversation_id));
create policy messages_delete on public.messages for delete to authenticated
  using (sender_id = auth.uid());

create policy chat_reads_select_own on public.chat_reads for select to authenticated
  using (user_id = auth.uid());

-- Comments: visible with their post (posts RLS applies inside), without hidden
-- commenters; removable by the commenter, the post author or a moderator.
create policy post_comments_select on public.post_comments for select to authenticated using (
  public.has_age_consent()
  and exists (select 1 from public.posts p where p.id = post_id)
  and (user_id = auth.uid() or public.author_visible(user_id))
);
create policy post_comments_insert on public.post_comments for insert to authenticated with check (
  user_id = auth.uid() and public.community_eligible() and public.post_interactable(post_id)
);
create policy post_comments_delete on public.post_comments for delete to authenticated using (
  user_id = auth.uid() or public.is_moderator()
  or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

-- Server-set times (the purge relies on them) and the comment/last-message bookkeeping.
create function public.social2_guard_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  return new;
end;
$$;
create trigger friend_requests_guard before insert on public.friend_requests
  for each row execute function public.social2_guard_trg();
create trigger messages_guard before insert on public.messages
  for each row execute function public.social2_guard_trg();
create trigger post_comments_guard before insert on public.post_comments
  for each row execute function public.social2_guard_trg();

-- Friend requests: 20 per day, at most 3 to the same person in 30 days.
create function public.friend_request_rate_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n integer;
  k text;
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':friend_request'));
  delete from public.rate_events where user_id = auth.uid() and kind = 'friend_request'
     and created_at < now() - interval '24 hours';
  select count(*) into n from public.rate_events where user_id = auth.uid() and kind = 'friend_request';
  if n >= 20 then raise exception 'rate_limited:friend_request' using errcode = 'P0001'; end if;
  k := 'friend_request:' || new.to_id::text;
  delete from public.rate_events where user_id = auth.uid() and kind = k and created_at < now() - interval '30 days';
  select count(*) into n from public.rate_events where user_id = auth.uid() and kind = k;
  if n >= 3 then raise exception 'rate_limited:friend_request_same' using errcode = 'P0001'; end if;
  insert into public.rate_events (user_id, kind) values (auth.uid(), 'friend_request'), (auth.uid(), k);
  return new;
end;
$$;
create trigger friend_requests_rate before insert on public.friend_requests
  for each row execute function public.friend_request_rate_trg();

-- Messages: 20 per minute and 300 per day. Comments: 60 per hour and 300 per day.
create trigger messages_rate_min before insert on public.messages
  for each row execute function public.social_rate_trg('message_min', '20', '1 minute');
create trigger messages_rate_day before insert on public.messages
  for each row execute function public.social_rate_trg('message_day', '300', '24 hours');
create trigger post_comments_rate_hour before insert on public.post_comments
  for each row execute function public.social_rate_trg('comment_hour', '60', '1 hour');
create trigger post_comments_rate_day before insert on public.post_comments
  for each row execute function public.social_rate_trg('comment_day', '300', '24 hours');

create function public.messages_after_insert_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end;
$$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert_trg();

-- Unfriending closes the chat (read-only; purged after 30 days).
create function public.friendships_after_delete_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set closed_at = now()
   where user_a = old.user_a and user_b = old.user_b and closed_at is null;
  return null;
end;
$$;
create trigger friendships_after_delete after delete on public.friendships
  for each row execute function public.friendships_after_delete_trg();

create function public.post_comments_stats_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.post_stats (post_id, comments) values (new.post_id, 1)
    on conflict (post_id) do update set comments = public.post_stats.comments + 1;
  else
    update public.post_stats set comments = greatest(comments - 1, 0) where post_id = old.post_id;
  end if;
  return null;
end;
$$;
create trigger post_comments_stats after insert or delete on public.post_comments
  for each row execute function public.post_comments_stats_trg();

-- Report resolution time (for the 90-day purge of report copies).
create function public.reports_resolved_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;
create trigger reports_resolved before update on public.reports
  for each row execute function public.reports_resolved_trg();

-- ---------------------------------------------------------------------------
-- 6. Privileges (explicit, minimal)
-- ---------------------------------------------------------------------------

revoke all on public.friend_requests, public.friendships, public.conversations, public.messages,
  public.chat_reads, public.post_comments from public, anon, authenticated;
grant select, insert, delete on public.friend_requests, public.messages, public.post_comments to authenticated;
grant select, delete on public.friendships, public.conversations to authenticated;
grant select on public.chat_reads to authenticated;

revoke execute on function public.are_friends(uuid), public.friend_state(uuid), public.can_request_friend(uuid),
  public.chat_participant(uuid), public.chat_can_send(uuid), public.community_join(), public.set_searchable(boolean),
  public.search_users(text, integer), public.accept_friend_request(uuid), public.friends_list(),
  public.friend_requests_list(), public.open_chat(uuid), public.chat_list(), public.chat_unread_total(),
  public.mark_read(uuid, bigint), public.post_comments_list(uuid, timestamptz, integer),
  public.report_message(bigint, text), public.report_comment(uuid, text),
  public.create_post(text, jsonb, text), public.community_feed(text, uuid, timestamptz, uuid, integer),
  public.profile_card(uuid) from public, anon;
grant execute on function public.are_friends(uuid), public.friend_state(uuid), public.can_request_friend(uuid),
  public.chat_participant(uuid), public.chat_can_send(uuid), public.community_join(), public.set_searchable(boolean),
  public.search_users(text, integer), public.accept_friend_request(uuid), public.friends_list(),
  public.friend_requests_list(), public.open_chat(uuid), public.chat_list(), public.chat_unread_total(),
  public.mark_read(uuid, bigint), public.post_comments_list(uuid, timestamptz, integer),
  public.report_message(bigint, text), public.report_comment(uuid, text),
  public.create_post(text, jsonb, text), public.community_feed(text, uuid, timestamptz, uuid, integer),
  public.profile_card(uuid) to authenticated;
revoke execute on function public.community_leave_cleanup(uuid), public.chat_purge(),
  public.social2_guard_trg(), public.friend_request_rate_trg(), public.messages_after_insert_trg(),
  public.friendships_after_delete_trg(), public.post_comments_stats_trg(), public.reports_resolved_trg()
  from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Realtime (new messages and friend requests, under the same RLS), the
--    daily purge job, and the comment counter backfill
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'friend_requests'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

create extension if not exists pg_cron;
do $$ begin
  perform cron.schedule('gymquest-chat-purge', '23 3 * * *', 'select public.chat_purge()');
end $$;

insert into public.post_stats (post_id, comments)
select c.post_id, count(*) from public.post_comments c group by c.post_id
on conflict (post_id) do update set comments = excluded.comments;

commit;
