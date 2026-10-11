-- ============================================================================
-- GymQuest Community — ROLLBACK of migration 0008 (friends, chat, comments, search)
-- ----------------------------------------------------------------------------
-- Restores the 0005 behaviour of every function and policy 0008 replaced. The
-- app (v49+) detects community_social_version() = 1 and hides friends, chat,
-- comments and search; v47/v48 work unchanged.
--
-- PRESERVED (nothing is deleted):
--   * accounts, profiles, posts, likes, shares, follows, reports, blocks, private
--     backups — untouched;
--   * friend requests, friendships, conversations, messages, read markers and
--     comments: MOVED into the unexposed schema community_rollback (no API
--     access). Their foreign keys stay, so deleting an account still deletes
--     its rows. Re-applying 0008 moves them back and rebuilds the comment counts.
-- KEPT ON PURPOSE (schema difference after rollback):
--   * posts.visibility: friends-only posts stay visible ONLY to their author and
--     moderators (the restored policies require visibility = 'public' for
--     everyone else), and the posts guard keeps the visibility locked after review;
--   * profiles.searchable / community_joined_at (unused while rolled back;
--     re-applying keeps everyone's search choice);
--   * the pg_cron extension (the purge job itself is removed).
-- LOST:
--   * the copies of reported messages/comments and the report resolution times
--     (reports.message_* / comment_* / resolved_at are dropped); the reports stay;
--   * the comment counters (derived; rebuilt by re-applying 0008).
--
-- Run in one transaction, then reload the API schema cache:
--   NOTIFY pgrst, 'reload schema';
-- Keep 0006, 0005 and the delete-account function (it skips missing tables).
-- ============================================================================

begin;

do $$ begin
  if to_regclass('public.friendships') is null then
    raise exception '0008 is not applied (public.friendships is missing)';
  end if;
end $$;

-- 1. Purge job and Realtime publication.
do $$ begin
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'gymquest-chat-purge') then
    perform cron.unschedule('gymquest-chat-purge');
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['messages', 'friend_requests'] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- 2. Triggers 0008 added (on new and existing tables).
drop trigger if exists friend_requests_guard on public.friend_requests;
drop trigger if exists friend_requests_rate on public.friend_requests;
drop trigger if exists messages_guard on public.messages;
drop trigger if exists messages_rate_min on public.messages;
drop trigger if exists messages_rate_day on public.messages;
drop trigger if exists messages_after_insert on public.messages;
drop trigger if exists friendships_after_delete on public.friendships;
drop trigger if exists post_comments_guard on public.post_comments;
drop trigger if exists post_comments_rate_hour on public.post_comments;
drop trigger if exists post_comments_rate_day on public.post_comments;
drop trigger if exists post_comments_stats on public.post_comments;
drop trigger if exists reports_resolved on public.reports;

-- 3. 0005 definitions restored; friends-only posts stay hidden from others.
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 1 $$;

create or replace function public.post_interactable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where p.id = pid and p.status = 'approved' and public.author_visible(p.user_id)
                   and (p.visibility = 'public' or p.user_id = auth.uid()));
$$;

create or replace function public.post_repostable(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.post_interactable(pid)
         and coalesce((select user_id from public.posts where id = pid and visibility = 'public') <> auth.uid(), false);
$$;

create or replace function public.community_object_visible(obj text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts p
                 where (p.image_path = obj or p.thumb_path = obj)
                   and p.status = 'approved' and p.visibility = 'public' and public.author_visible(p.user_id))
      or exists (select 1 from public.post_media m join public.posts p on p.id = m.post_id
                 where (m.image_path = obj or m.thumb_path = obj)
                   and p.status = 'approved' and p.visibility = 'public' and public.author_visible(p.user_id));
$$;

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (
  (status = 'approved' and visibility = 'public' and public.has_age_consent() and public.author_visible(user_id))
  or user_id = auth.uid() or public.is_moderator()
);

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (
  reporter_id = auth.uid() and not public.is_suspended() and public.moderation_ready()
);

drop function public.create_post(text, jsonb, text);
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

create or replace function public.resolve_report(p_report uuid, p_outcome text, p_remove_post boolean default false)
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

drop function public.community_feed(text, uuid, timestamptz, uuid, integer);
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

drop function public.profile_card(uuid);
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
  return null;
end;
$$;

revoke execute on function public.create_post(text, jsonb), public.community_feed(text, uuid, timestamptz, uuid, integer),
  public.profile_card(uuid) from public, anon;
grant execute on function public.create_post(text, jsonb), public.community_feed(text, uuid, timestamptz, uuid, integer),
  public.profile_card(uuid) to authenticated;

-- 4. Policies of the new tables (so the helpers can be dropped), then archive them.
drop policy if exists friend_requests_select on public.friend_requests;
drop policy if exists friend_requests_insert on public.friend_requests;
drop policy if exists friend_requests_delete on public.friend_requests;
drop policy if exists friendships_select on public.friendships;
drop policy if exists friendships_delete on public.friendships;
drop policy if exists conversations_select on public.conversations;
drop policy if exists conversations_delete on public.conversations;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_delete on public.messages;
drop policy if exists chat_reads_select_own on public.chat_reads;
drop policy if exists post_comments_select on public.post_comments;
drop policy if exists post_comments_insert on public.post_comments;
drop policy if exists post_comments_delete on public.post_comments;

do $$
declare t text;
begin
  foreach t in array array['friend_requests', 'friendships', 'conversations', 'messages', 'chat_reads',
                           'post_comments'] loop
    execute format('alter table public.%I set schema community_rollback', t);
    execute format('revoke all on community_rollback.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- 5. Columns 0008 added that are dropped (report copies, derived counter).
alter table public.post_stats drop column if exists comments;
alter table public.reports
  drop column if exists message_id,
  drop column if exists message_excerpt,
  drop column if exists comment_id,
  drop column if exists comment_excerpt,
  drop column if exists resolved_at;

-- 6. Functions added by 0008.
drop function public.are_friends(uuid);
drop function public.friend_state(uuid);
drop function public.can_request_friend(uuid);
drop function public.chat_participant(uuid);
drop function public.chat_can_send(uuid);
drop function public.community_join();
drop function public.set_searchable(boolean);
drop function public.search_users(text, integer);
drop function public.accept_friend_request(uuid);
drop function public.friends_list();
drop function public.friend_requests_list();
drop function public.open_chat(uuid);
drop function public.chat_list();
drop function public.chat_unread_total();
drop function public.mark_read(uuid, bigint);
drop function public.post_comments_list(uuid, timestamptz, integer);
drop function public.report_message(bigint, text);
drop function public.report_comment(uuid, text);
drop function public.community_leave_cleanup(uuid);
drop function public.chat_purge();
drop function public.social2_guard_trg();
drop function public.friend_request_rate_trg();
drop function public.messages_after_insert_trg();
drop function public.friendships_after_delete_trg();
drop function public.post_comments_stats_trg();
drop function public.reports_resolved_trg();

commit;
