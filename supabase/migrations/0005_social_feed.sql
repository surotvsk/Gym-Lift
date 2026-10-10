-- ============================================================================
-- GymQuest Community — migration 0005: social feed (Release 1)
-- ----------------------------------------------------------------------------
-- Adds: one-way follows, likes, internal shares (reposts), the "Following"
-- feed, profiles with counts and lists, text-only posts and posts with 1–4
-- photos, an account-level 16+ confirmation (no birth date), spam limits,
-- block clean-up (blocked users and their profiles disappear both ways),
-- hiding suspended authors, a moderation history and a report review.
-- No auto-publish: every new post still waits for a moderator.
--
-- Security fixes to the existing Community:
--   * post text is locked once a post has left 'pending';
--   * every photo path must begin with the author's own user id, and a path
--     that a post references can never be uploaded again (no photo swap);
--   * signed-out (anon) access to Community tables and helpers is removed;
--   * reserved usernames and a 30-day rename limit.
--
-- Private data is untouched: backups, backup_versions and the `backups` bucket
-- keep their owner-only policies; moderators gain no access to anything private
-- (no access to likes either).
--
-- Rollback: supabase/rollback/0005_down.sql. It restores the pre-0005
-- definitions and privileges but PRESERVES the new data: the social tables are
-- moved into the unexposed schema `community_rollback` (re-applying this file
-- moves them back), counters are rebuilt here from the rows, and posts — text
-- only or not — stay in public.posts.
--
-- Apply ONCE, in one transaction, after 0001–0004.
-- ============================================================================

begin;

do $$ begin
  if to_regclass('public.follows') is not null then
    raise exception '0005 is already applied (public.follows exists)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 0. Rollback schema + snapshot of the privileges this migration revokes
-- ---------------------------------------------------------------------------

create schema if not exists community_rollback;
revoke all on schema community_rollback from public, anon, authenticated;

-- What anon/PUBLIC could do before 0005 on the Community objects, so the
-- rollback can restore exactly that (whatever "auto-expose" granted).
create table community_rollback.privileges_before (
  kind      text not null check (kind in ('table', 'column', 'function')),
  object    text not null,
  col       text,
  grantee   text not null,
  privilege text not null
);

insert into community_rollback.privileges_before (kind, object, col, grantee, privilege)
select 'table', quote_ident(n.nspname) || '.' || quote_ident(c.relname), null,
       case when a.grantee = 0 then 'public' else quote_ident(a.grantee::regrole::text) end, a.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where c.oid in ('public.profiles'::regclass, 'public.posts'::regclass,
                 'public.reports'::regclass, 'public.blocks'::regclass)
   and (a.grantee = 0 or a.grantee = 'anon'::regrole);

insert into community_rollback.privileges_before (kind, object, col, grantee, privilege)
select 'column', quote_ident(n.nspname) || '.' || quote_ident(c.relname), at.attname,
       case when a.grantee = 0 then 'public' else quote_ident(a.grantee::regrole::text) end, a.privilege_type
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(at.attacl) a
 where c.oid in ('public.profiles'::regclass, 'public.posts'::regclass,
                 'public.reports'::regclass, 'public.blocks'::regclass)
   and at.attnum > 0 and at.attacl is not null
   and (a.grantee = 0 or a.grantee = 'anon'::regrole);

insert into community_rollback.privileges_before (kind, object, col, grantee, privilege)
select 'function', 'public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')', null,
       case when a.grantee = 0 then 'public' else quote_ident(a.grantee::regrole::text) end, a.privilege_type
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where p.oid in ('public.is_moderator()'::regprocedure, 'public.is_suspended()'::regprocedure,
                 'public.active_post_count(uuid)'::regprocedure, 'public.moderation_ready()'::regprocedure,
                 'public.community_object_count(uuid)'::regprocedure)
   and (a.grantee = 0 or a.grantee = 'anon'::regrole);

-- ---------------------------------------------------------------------------
-- 1. Tables (moved back from community_rollback if a rollback archived them)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['community_consents', 'follows', 'likes', 'reposts', 'post_media',
                           'moderation_actions', 'rate_events', 'username_changes'] loop
    if to_regclass('community_rollback.' || t) is not null then
      execute format('alter table community_rollback.%I set schema public', t);
    end if;
  end loop;
end $$;

-- Account-level 16+ confirmation. Stores only the fact, never a birth date.
create table if not exists public.community_consents (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  age_min     smallint not null default 16 check (age_min = 16),
  accepted_at timestamptz not null default now(),
  source      text not null check (source in ('signup', 'prompt'))
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);
create index if not exists follows_follower_idx on public.follows (follower_id, created_at desc);

-- likes / reposts use a surrogate key: if (post_id, user_id) were the primary
-- key, PostgREST would treat these tables as posts<->profiles junctions and the
-- v46 app's `posts?select=...,profiles(...)` embed would become ambiguous.
create table if not exists public.likes (
  id         bigserial primary key,
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_post_user_key unique (post_id, user_id)
);
create index if not exists likes_user_idx on public.likes (user_id, created_at desc);

create table if not exists public.reposts (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint reposts_user_post_key unique (user_id, post_id)
);
create index if not exists reposts_post_idx on public.reposts (post_id);
create index if not exists reposts_user_created_idx on public.reposts (user_id, created_at desc);

-- Photos 2–4 of a post (photo 1 stays in posts.image_path / thumb_path, so
-- single-photo posts keep exactly their old shape).
create table if not exists public.post_media (
  post_id    uuid not null references public.posts(id) on delete cascade,
  position   smallint not null check (position between 1 and 3),
  image_path text not null,
  thumb_path text not null,
  primary key (post_id, position),
  constraint post_media_path_shape check (
    image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\.(jpg|jpeg|png|webp)$'
    and thumb_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\.(jpg|jpeg|png|webp)$'
    and split_part(image_path, '/', 1) = split_part(thumb_path, '/', 1))
);
create index if not exists post_media_image_idx on public.post_media (image_path);
create index if not exists post_media_thumb_idx on public.post_media (thumb_path);

-- Moderation history (written only by triggers / resolve_report; read only by moderators).
create table if not exists public.moderation_actions (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  post_id      uuid,                       -- no FK: the record survives post deletion
  report_id    uuid,
  action       text not null check (action in ('approve', 'reject', 'remove', 'report_upheld',
                                               'report_dismissed', 'suspend', 'unsuspend')),
  moderator_id uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists moderation_actions_user_idx on public.moderation_actions (user_id, created_at desc);

-- Spam-limit ledger (counts every attempt, so follow/unfollow churn still counts).
create table if not exists public.rate_events (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (user_id, kind, created_at);

-- Last self-chosen username change (30-day limit).
create table if not exists public.username_changes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  changed_at timestamptz not null
);

-- Counters: derived data, always rebuilt from the rows below (section 7).
create table public.post_stats (
  post_id uuid primary key references public.posts(id) on delete cascade,
  likes   integer not null default 0 check (likes >= 0),
  reposts integer not null default 0 check (reposts >= 0)
);
create table public.profile_stats (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  followers integer not null default 0 check (followers >= 0),
  following integer not null default 0 check (following >= 0)
);

-- posts: text-only posts allowed; photo paths must sit in the author's own folder.
alter table public.posts alter column image_path drop not null, alter column thumb_path drop not null;
alter table public.posts
  add constraint posts_photo_pair check ((image_path is null) = (thumb_path is null)),
  add constraint posts_has_content check (image_path is not null or char_length(btrim(caption)) > 0),
  add constraint posts_paths_own check (
    image_path is null or (
      image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\.(jpg|jpeg|png|webp)$'
      and thumb_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\.(jpg|jpeg|png|webp)$'
      and split_part(image_path, '/', 1) = user_id::text
      and split_part(thumb_path, '/', 1) = user_id::text));
create index posts_user_status_published_idx on public.posts (user_id, status, published_at desc);
create index posts_image_path_idx on public.posts (image_path);
create index posts_thumb_path_idx on public.posts (thumb_path);

-- ---------------------------------------------------------------------------
-- 2. Helper functions — all evaluate the CALLER (auth.uid()); none lets a
--    caller probe relationships between two other users.
-- ---------------------------------------------------------------------------

-- Feature detection for the app (absent => the app hides social features).
create function public.community_social_version()
returns integer language sql immutable as $$ select 1 $$;

create function public.has_age_consent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_consents where user_id = auth.uid());
$$;

create function public.community_eligible()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_age_consent() and not public.is_suspended() and public.moderation_ready();
$$;

-- A block exists between the caller and `other`, in either direction.
create function public.blocked_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = auth.uid() and blocked_id = other)
                    or (blocker_id = other and blocked_id = auth.uid()));
$$;

-- The author is not suspended and there is no block with the caller.
create function public.author_visible(author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not suspended from public.profiles where id = author), false)
         and not public.blocked_with(author);
$$;

-- Others may like/share a post only if it is approved and its author visible.
create function public.post_interactable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where p.id = pid and p.status = 'approved' and public.author_visible(p.user_id));
$$;

create function public.post_repostable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.post_interactable(pid)
         and coalesce((select user_id from public.posts where id = pid) <> auth.uid(), false);
$$;

-- A community object belongs to an approved post (any of its photos) whose author is visible.
create function public.community_object_visible(obj text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where (p.image_path = obj or p.thumb_path = obj)
                   and p.status = 'approved' and public.author_visible(p.user_id))
      or exists (select 1 from public.post_media m join public.posts p on p.id = m.post_id
                 where (m.image_path = obj or m.thumb_path = obj)
                   and p.status = 'approved' and public.author_visible(p.user_id));
$$;

-- A path some post already references (re-uploading it would swap a reviewed photo).
create function public.community_path_referenced(obj text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where image_path = obj or thumb_path = obj)
      or exists (select 1 from public.post_media where image_path = obj or thumb_path = obj);
$$;

-- Usernames: lower case, look-alike digits mapped (0→o 1→i 3→e 4→a 5→s 7→t, l→i), separators removed.
create function public.username_normalize(n text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(translate(lower(coalesce(n, '')), '013457l', 'oieasti'), '[^a-z0-9]', '', 'g');
$$;

-- Reserved names and obvious variations, plus look-alikes of current moderators.
create function public.username_reserved(n text)
returns boolean language sql stable security definer set search_path = public as $$
  with f(v) as (
    select public.username_normalize(n)
    union all
    select regexp_replace(lower(coalesce(n, '')), '[^a-z]', '', 'g')     -- letters only
  )
  select exists (
    select 1 from f
     where v ~ '(gymquest|moderat|officia[il])'
        or v ~ '^(admin|support|staff|system)' or v ~ '(admin|support|staff|system)$'
        or v in ('mod', 'mods', 'root', 'owner', 'team', 'help', 'info', 'contact', 'security', 'gq')
        or exists (select 1 from public.profiles p
                    where p.role = 'moderator' and p.id is distinct from auth.uid()
                      and (public.username_normalize(p.username) = f.v
                           or regexp_replace(lower(p.username), '[^a-z]', '', 'g') = f.v))
  );
$$;

-- One-time 16+ confirmation for accounts created before this migration.
create function public.accept_age_requirement()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.community_consents (user_id, source) values (auth.uid(), 'prompt')
  on conflict (user_id) do nothing;
end;
$$;

-- Create a post (text and/or 1–4 photos) in ONE transaction. SECURITY INVOKER:
-- the caller's RLS, the posts guard and every constraint apply. Photos 2–4 can
-- only be attached here (post_media insert requires the post's own transaction).
create function public.create_post(p_text text, p_photos jsonb default '[]'::jsonb)
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
  insert into public.posts (user_id, caption, image_path, thumb_path)
  values (auth.uid(), btrim(coalesce(p_text, '')),
          case when n > 0 then p_photos -> 0 ->> 'image' end,
          case when n > 0 then p_photos -> 0 ->> 'thumb' end)
  returning id into pid;
  for i in 1 .. n - 1 loop
    insert into public.post_media (post_id, position, image_path, thumb_path)
    values (pid, i, p_photos -> i ->> 'image', p_photos -> i ->> 'thumb');
  end loop;
  return pid;
end;
$$;

-- Moderator report review: resolve with an outcome, optionally removing the post.
create function public.resolve_report(p_report uuid, p_outcome text, p_remove_post boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  rep_post uuid;
  rep_user uuid;
  target   uuid;
begin
  if not public.is_moderator() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'dismissed') then raise exception 'invalid_outcome' using errcode = 'P0001'; end if;
  update public.reports set status = 'resolved'
   where id = p_report and status = 'open'
  returning post_id, reported_user_id into rep_post, rep_user;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  target := coalesce(rep_user, (select user_id from public.posts where id = rep_post));
  if target is not null then
    insert into public.moderation_actions (user_id, post_id, report_id, action, moderator_id)
    values (target, rep_post, p_report, 'report_' || p_outcome, auth.uid());
  end if;
  if p_outcome = 'upheld' and p_remove_post and rep_post is not null then
    update public.posts set status = 'rejected' where id = rep_post and status = 'approved';   -- logged as 'remove'
  end if;
end;
$$;

-- Feeds: 'everyone' (approved posts), 'following' (approved posts and shares by
-- accounts the caller follows, each post once under its newest activity) and
-- 'user' (one profile's approved posts). Keyset paging on (activity_at, post_id).
-- SECURITY INVOKER, so RLS on posts/profiles/follows/reposts applies.
create function public.community_feed(p_scope text default 'everyone', p_user uuid default null,
                                      p_before timestamptz default null, p_before_id uuid default null,
                                      p_limit integer default 12)
returns table (post_id uuid, author_id uuid, author_name text, author_avatar text, author_moderator boolean,
               caption text, photos jsonb, activity_at timestamptz, reposted_by uuid, reposted_by_name text,
               likes integer, reposts integer, liked_by_me boolean, reposted_by_me boolean)
language sql stable security invoker set search_path = public as $$
  with followed as (
    select f.followee_id as id from public.follows f
     where p_scope = 'following' and f.follower_id = auth.uid()
  ),
  items as (
    select p.id as post_id, null::uuid as reposted_by, coalesce(p.published_at, p.created_at) as activity_at
      from public.posts p
     where p.status = 'approved'
       and case p_scope when 'everyone'  then true
                        when 'user'      then p.user_id = p_user
                        when 'following' then p.user_id in (select id from followed)
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
         exists (select 1 from public.reposts k where k.post_id = l.post_id and k.user_id = auth.uid())
    from latest l
    join public.posts p on p.id = l.post_id and p.status = 'approved'
    join public.profiles a on a.id = p.user_id
    left join public.profiles rb on rb.id = l.reposted_by
    left join public.post_stats s on s.post_id = l.post_id
   where public.has_age_consent()
     and public.author_visible(p.user_id)
     and (l.reposted_by is null or (rb.id is not null and public.author_visible(l.reposted_by)))
     and (p_before is null
          or (l.activity_at, l.post_id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by l.activity_at desc, l.post_id desc
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

-- One public profile with its counts. No row when the profile is hidden (block)
-- or, for someone else's profile, when the caller has not confirmed 16+.
create function public.profile_card(p_user uuid)
returns table (id uuid, username text, bio text, avatar_path text, moderator boolean, suspended boolean,
               followers integer, following integer, posts integer, i_follow boolean, blocked_by_me boolean)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.username, pr.bio, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended),
         case when pr.id = auth.uid() or public.is_moderator() then pr.suspended end,
         coalesce(st.followers, 0), coalesce(st.following, 0),
         (select count(*)::int from public.posts p where p.user_id = pr.id and p.status = 'approved'),
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = pr.id),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = pr.id)
    from public.profiles pr
    left join public.profile_stats st on st.user_id = pr.id
   where pr.id = p_user and (pr.id = auth.uid() or public.has_age_consent());
$$;

-- Follower / following list of one profile, newest first, paged by follow time.
create function public.follow_list(p_user uuid, p_kind text, p_before timestamptz default null,
                                   p_limit integer default 50)
returns table (user_id uuid, username text, avatar_path text, moderator boolean, followed_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.username, pr.avatar_path, (pr.role = 'moderator' and not pr.suspended), f.created_at
    from public.follows f
    join public.profiles pr on pr.id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
   where p_kind in ('followers', 'following')
     and (case when p_kind = 'followers' then f.followee_id else f.follower_id end) = p_user
     and (p_before is null or f.created_at < p_before)
   order by f.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- 3. Changed existing objects (Community only)
-- ---------------------------------------------------------------------------

-- 3a. Every new account must carry the 16+ confirmation (server-enforced for all
--     signup paths; the app sends it from the required checkbox).
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

-- 3b. Posts guard: as 0001, plus server-set created_at and text locked after review.
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
    if old.status <> 'pending' and new.caption is distinct from old.caption then
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

-- 3c. Profiles guard: as 0001, plus reserved usernames and the 30-day rename limit
--     for self-chosen names (owner SQL and moderator renames are not limited).
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  last_change timestamptz;
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'changing role is not allowed';
  end if;
  if new.suspended is distinct from old.suspended and auth.uid() is not null and not public.is_moderator() then
    raise exception 'changing suspended is not allowed';
  end if;
  if new.username is distinct from old.username and auth.uid() is not null and auth.uid() = old.id then
    if not public.is_moderator() and public.username_reserved(new.username) then
      raise exception 'username_reserved' using errcode = 'P0001';
    end if;
    select changed_at into last_change from public.username_changes where user_id = old.id;
    if last_change is not null and last_change > now() - interval '30 days' then
      raise exception 'username_cooldown:%', to_char((last_change + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        using errcode = 'P0001';
    end if;
    insert into public.username_changes (user_id, changed_at) values (old.id, now())
    on conflict (user_id) do update set changed_at = excluded.changed_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 3d. Profiles: signed-in only; hidden both ways by a block (moderators see all).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_moderator() or not public.blocked_with(id)
);

-- 3e. Others' approved posts only with 16+ consent and a visible author.
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (
  (status = 'approved' and public.has_age_consent() and public.author_visible(user_id))
  or user_id = auth.uid() or public.is_moderator()
);

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated with check (
  user_id = auth.uid()
  and public.community_eligible()
  and public.active_post_count(auth.uid()) < 10
);

-- 3f. Storage: photos of hidden posts stop loading; uploads only into one's own
--     folder, never onto a path a post already references; 40 files per user
--     (10 active posts, up to 4 photos each + thumbnails, capped at 20 photos).
drop policy if exists community_read on storage.objects;
create policy community_read on storage.objects for select to authenticated using (
  bucket_id = 'community' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_moderator()
    or (public.has_age_consent() and public.community_object_visible(name))
  )
);

drop policy if exists community_insert_own on storage.objects;
create policy community_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.community_eligible()
  and public.active_post_count(auth.uid()) < 10
  and public.community_object_count(auth.uid()) < 40
  and not public.community_path_referenced(name)
);

-- 3g. Signed-out (anon) access removed from Community tables and helpers.
revoke all on public.profiles, public.posts, public.reports, public.blocks from public, anon;
revoke execute on function public.is_moderator(), public.is_suspended(), public.active_post_count(uuid),
  public.moderation_ready(), public.community_object_count(uuid) from public, anon;
grant execute on function public.is_moderator(), public.is_suspended(), public.active_post_count(uuid),
  public.moderation_ready(), public.community_object_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security on the new tables (signed-in users only)
-- ---------------------------------------------------------------------------

alter table public.community_consents enable row level security;
alter table public.follows            enable row level security;
alter table public.likes              enable row level security;
alter table public.reposts            enable row level security;
alter table public.post_media         enable row level security;
alter table public.post_stats         enable row level security;
alter table public.profile_stats      enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.rate_events        enable row level security;   -- no policies: no client access
alter table public.username_changes   enable row level security;

create policy consents_select_own on public.community_consents for select to authenticated
  using (user_id = auth.uid());
create policy username_changes_select_own on public.username_changes for select to authenticated
  using (user_id = auth.uid());

-- Follower/following lists: signed-in users who confirmed 16+, without blocked people.
create policy follows_select on public.follows for select to authenticated using (
  public.has_age_consent() and not public.blocked_with(follower_id) and not public.blocked_with(followee_id)
);
create policy follows_insert on public.follows for insert to authenticated with check (
  follower_id = auth.uid()
  and public.community_eligible()
  and not public.blocked_with(followee_id)
  and exists (select 1 from public.profiles t where t.id = followee_id and not t.suspended)
);
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- Likes: only one's own are readable ("who liked" stays private, also from moderators).
create policy likes_select_own on public.likes for select to authenticated using (user_id = auth.uid());
create policy likes_insert on public.likes for insert to authenticated with check (
  user_id = auth.uid() and public.community_eligible() and public.post_interactable(post_id)
);
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());

create policy reposts_select on public.reposts for select to authenticated using (
  public.has_age_consent() and (user_id = auth.uid() or public.author_visible(user_id))
);
create policy reposts_insert on public.reposts for insert to authenticated with check (
  user_id = auth.uid() and public.community_eligible() and public.post_repostable(post_id)
);
create policy reposts_delete on public.reposts for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator());

-- Extra photos: visible exactly when their post is (posts RLS applies inside);
-- attached only by the author, to a pending post created in the same transaction
-- (i.e. inside create_post), inside the author's own folder.
create policy post_media_select on public.post_media for select to authenticated using (
  exists (select 1 from public.posts p where p.id = post_id)
);
create policy post_media_insert on public.post_media for insert to authenticated with check (
  exists (select 1 from public.posts p
           where p.id = post_id and p.user_id = auth.uid() and p.status = 'pending'
             and p.created_at = now() and p.image_path is not null)
  and split_part(image_path, '/', 1) = auth.uid()::text
);

create policy post_stats_select on public.post_stats for select to authenticated using (true);
create policy profile_stats_select on public.profile_stats for select to authenticated using (true);
create policy moderation_actions_select on public.moderation_actions for select to authenticated
  using (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

-- Spam limits: tg_argv = (kind, max, window). Owner/service SQL (no auth.uid()) is exempt.
create function public.social_rate_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k   text     := tg_argv[0];
  lim integer  := tg_argv[1]::integer;
  win interval := tg_argv[2]::interval;
  n   integer;
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || k));
  delete from public.rate_events where user_id = auth.uid() and kind = k and created_at < now() - win;
  select count(*) into n from public.rate_events where user_id = auth.uid() and kind = k;
  if n >= lim then raise exception 'rate_limited:%', k using errcode = 'P0001'; end if;
  insert into public.rate_events (user_id, kind) values (auth.uid(), k);
  return new;
end;
$$;
create trigger follows_rate before insert on public.follows
  for each row execute function public.social_rate_trg('follow', '200', '24 hours');
create trigger likes_rate before insert on public.likes
  for each row execute function public.social_rate_trg('like', '300', '1 hour');
create trigger reposts_rate before insert on public.reposts
  for each row execute function public.social_rate_trg('repost', '50', '24 hours');
create trigger reports_rate before insert on public.reports
  for each row execute function public.social_rate_trg('report', '20', '24 hours');
create trigger posts_rate before insert on public.posts
  for each row execute function public.social_rate_trg('post', '20', '24 hours');

-- Counters.
create function public.social_stats_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'likes' then
    if tg_op = 'INSERT' then
      insert into public.post_stats (post_id, likes) values (new.post_id, 1)
      on conflict (post_id) do update set likes = public.post_stats.likes + 1;
    else
      update public.post_stats set likes = greatest(likes - 1, 0) where post_id = old.post_id;
    end if;
  elsif tg_table_name = 'reposts' then
    if tg_op = 'INSERT' then
      insert into public.post_stats (post_id, reposts) values (new.post_id, 1)
      on conflict (post_id) do update set reposts = public.post_stats.reposts + 1;
    else
      update public.post_stats set reposts = greatest(reposts - 1, 0) where post_id = old.post_id;
    end if;
  else
    if tg_op = 'INSERT' then
      insert into public.profile_stats (user_id, following) values (new.follower_id, 1)
      on conflict (user_id) do update set following = public.profile_stats.following + 1;
      insert into public.profile_stats (user_id, followers) values (new.followee_id, 1)
      on conflict (user_id) do update set followers = public.profile_stats.followers + 1;
    else
      update public.profile_stats set following = greatest(following - 1, 0) where user_id = old.follower_id;
      update public.profile_stats set followers = greatest(followers - 1, 0) where user_id = old.followee_id;
    end if;
  end if;
  return null;
end;
$$;
create trigger likes_stats after insert or delete on public.likes
  for each row execute function public.social_stats_trg();
create trigger reposts_stats after insert or delete on public.reposts
  for each row execute function public.social_stats_trg();
create trigger follows_stats after insert or delete on public.follows
  for each row execute function public.social_stats_trg();

-- A new block removes follows in both directions and the blocked user's likes
-- on, and shares of, the blocker's posts.
create function public.blocks_social_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from public.likes l using public.posts p
   where l.post_id = p.id and p.user_id = new.blocker_id and l.user_id = new.blocked_id;
  delete from public.reposts r using public.posts p
   where r.post_id = p.id and p.user_id = new.blocker_id and r.user_id = new.blocked_id;
  return null;
end;
$$;
create trigger blocks_social_cleanup after insert on public.blocks
  for each row execute function public.blocks_social_cleanup();

-- Moderation history (only actions taken by a moderator are recorded). Each
-- table has its own branch: PL/pgSQL only resolves the fields of the branch run.
create function public.moderation_log_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a text;
begin
  if not public.is_moderator() then return null; end if;
  if tg_table_name = 'posts' then
    if old.status is distinct from new.status then
      a := case when new.status = 'approved' then 'approve'
                when new.status = 'rejected' and old.status = 'approved' then 'remove'
                when new.status = 'rejected' then 'reject' end;
      if a is not null then
        insert into public.moderation_actions (user_id, post_id, action, moderator_id)
        values (new.user_id, new.id, a, auth.uid());
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if old.suspended is distinct from new.suspended then
      insert into public.moderation_actions (user_id, action, moderator_id)
      values (new.id, case when new.suspended then 'suspend' else 'unsuspend' end, auth.uid());
    end if;
  end if;
  return null;
end;
$$;
create trigger posts_moderation_log after update on public.posts
  for each row execute function public.moderation_log_trg();
create trigger profiles_moderation_log after update on public.profiles
  for each row execute function public.moderation_log_trg();

-- ---------------------------------------------------------------------------
-- 6. Privileges (explicit; Supabase's default grants to anon/authenticated on
--    new objects are revoked first)
-- ---------------------------------------------------------------------------

revoke all on public.community_consents, public.follows, public.likes, public.reposts, public.post_media,
  public.post_stats, public.profile_stats, public.moderation_actions, public.rate_events,
  public.username_changes from public, anon, authenticated;
revoke all on sequence public.moderation_actions_id_seq, public.rate_events_id_seq, public.likes_id_seq,
  public.reposts_id_seq from public, anon, authenticated;
grant usage on sequence public.likes_id_seq, public.reposts_id_seq to authenticated;
grant select, insert, delete on public.follows, public.likes, public.reposts to authenticated;
grant select, insert on public.post_media to authenticated;
grant select on public.post_stats, public.profile_stats, public.community_consents,
  public.moderation_actions, public.username_changes to authenticated;
grant select, insert, update, delete on public.community_consents, public.follows, public.likes, public.reposts,
  public.post_media, public.post_stats, public.profile_stats, public.moderation_actions, public.rate_events,
  public.username_changes to service_role;

revoke execute on function public.community_social_version(), public.has_age_consent(), public.community_eligible(),
  public.blocked_with(uuid), public.author_visible(uuid), public.post_interactable(uuid), public.post_repostable(uuid),
  public.community_object_visible(text), public.community_path_referenced(text), public.username_normalize(text),
  public.username_reserved(text), public.accept_age_requirement(), public.create_post(text, jsonb),
  public.resolve_report(uuid, text, boolean),
  public.community_feed(text, uuid, timestamptz, uuid, integer), public.profile_card(uuid),
  public.follow_list(uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.community_social_version(), public.has_age_consent(), public.community_eligible(),
  public.blocked_with(uuid), public.author_visible(uuid), public.post_interactable(uuid), public.post_repostable(uuid),
  public.community_object_visible(text), public.community_path_referenced(text), public.accept_age_requirement(),
  public.create_post(text, jsonb), public.resolve_report(uuid, text, boolean),
  public.community_feed(text, uuid, timestamptz, uuid, integer), public.profile_card(uuid),
  public.follow_list(uuid, text, timestamptz, integer) to authenticated;
revoke execute on function public.username_normalize(text), public.username_reserved(text) from authenticated;
revoke execute on function public.social_rate_trg(), public.social_stats_trg(), public.blocks_social_cleanup(),
  public.moderation_log_trg() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Backfill
--    * counters are rebuilt from the rows (also after a rollback + re-apply);
--    * already-approved posts are credited once in the moderation history.
--    (No consents are backfilled: existing users confirm once in the app.)
-- ---------------------------------------------------------------------------

insert into public.post_stats (post_id, likes, reposts)
select p.id,
       (select count(*) from public.likes l where l.post_id = p.id),
       (select count(*) from public.reposts r where r.post_id = p.id)
  from public.posts p
 where exists (select 1 from public.likes l where l.post_id = p.id)
    or exists (select 1 from public.reposts r where r.post_id = p.id);

insert into public.profile_stats (user_id, followers, following)
select pr.id,
       (select count(*) from public.follows f where f.followee_id = pr.id),
       (select count(*) from public.follows f where f.follower_id = pr.id)
  from public.profiles pr
 where exists (select 1 from public.follows f where f.followee_id = pr.id or f.follower_id = pr.id);

insert into public.moderation_actions (user_id, post_id, action, moderator_id, created_at)
select p.user_id, p.id, 'approve', null, coalesce(p.published_at, p.created_at)
  from public.posts p
 where p.status = 'approved'
   and not exists (select 1 from public.moderation_actions m where m.post_id = p.id and m.action = 'approve');

commit;
