-- ============================================================================
-- GymQuest Community — ROLLBACK of migration 0005 (social feed, Release 1)
-- ----------------------------------------------------------------------------
-- Restores the exact pre-0005 behaviour: the 0001/0003 definitions of every
-- function and policy 0005 replaced, and the anon/PUBLIC privileges 0005
-- recorded before revoking them. The current app (v47+) detects the missing
-- social functions and falls back to the pre-0005 Community.
--
-- PRESERVED (nothing is deleted):
--   * auth accounts, profiles, posts (also text-only posts, with their text),
--     the first photo of every post and its links, reports, blocks, private
--     backups/versions/backup media, every storage object;
--   * follows, likes, shares, 16+ confirmations, moderation history, spam-limit
--     events, rename dates and photos 2–4 of multi-photo posts: these tables are
--     MOVED into the unexposed schema `community_rollback` (no API access).
--     Their foreign keys stay, so deleting an account still deletes its rows.
--     Re-applying 0005 moves them back and rebuilds the counters.
-- NOT AVAILABLE while rolled back:
--   * photos 2–4 of multi-photo posts are visible only to their author and
--     moderators (the files and their references are kept);
--   * the counters (post_stats / profile_stats) are dropped — they are derived
--     data and 0005 rebuilds them exactly from the archived rows.
-- SCHEMA DIFFERENCE after rollback (only if text-only posts exist):
--   posts.image_path / thumb_path stay nullable so those posts survive.
--
-- Run in one transaction, then reload the API schema cache:
--   NOTIFY pgrst, 'reload schema';
-- Keep everything else: the frontend (v47+ handles both schemas), migration 0006
-- and the v47 delete-account Edge Function (it works while 0005 is rolled back).
-- Do NOT redeploy the pre-v47 function and do NOT run 0006_down.
-- ============================================================================

begin;

do $$ begin
  if to_regclass('public.follows') is null then
    raise exception '0005 is not applied (public.follows missing)';
  end if;
end $$;

-- 1. Triggers 0005 put on pre-existing tables.
drop trigger if exists posts_rate on public.posts;
drop trigger if exists reports_rate on public.reports;
drop trigger if exists blocks_social_cleanup on public.blocks;
drop trigger if exists posts_moderation_log on public.posts;
drop trigger if exists profiles_moderation_log on public.profiles;

-- 2. Original definitions (0001 / 0003); they no longer reference 0005 helpers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10))
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.status := 'pending';
    new.published_at := null;
    return new;
  end if;
  if not public.is_moderator() then
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

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'changing role is not allowed';
  end if;
  if new.suspended is distinct from old.suspended and auth.uid() is not null and not public.is_moderator() then
    raise exception 'changing suspended is not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (
  status = 'approved' or user_id = auth.uid() or public.is_moderator()
);

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert with check (
  user_id = auth.uid()
  and not public.is_suspended()
  and public.moderation_ready()
  and public.active_post_count(auth.uid()) < 10
);

drop policy if exists community_read on storage.objects;
create policy community_read on storage.objects for select using (
  bucket_id = 'community' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_moderator()
    or exists (
      select 1 from public.posts p
      where p.status = 'approved'
        and (p.image_path = name or p.thumb_path = name)
    )
  )
);

drop policy if exists community_insert_own on storage.objects;
create policy community_insert_own on storage.objects for insert with check (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_suspended()
  and public.moderation_ready()
  and public.active_post_count(auth.uid()) < 10
  and public.community_object_count(auth.uid()) < 20
);

-- 3. Policies and triggers of the new tables (so the helpers can be dropped).
drop policy if exists consents_select_own on public.community_consents;
drop policy if exists username_changes_select_own on public.username_changes;
drop policy if exists follows_select on public.follows;
drop policy if exists follows_insert on public.follows;
drop policy if exists follows_delete on public.follows;
drop policy if exists likes_select_own on public.likes;
drop policy if exists likes_insert on public.likes;
drop policy if exists likes_delete on public.likes;
drop policy if exists reposts_select on public.reposts;
drop policy if exists reposts_insert on public.reposts;
drop policy if exists reposts_delete on public.reposts;
drop policy if exists post_media_select on public.post_media;
drop policy if exists post_media_insert on public.post_media;
drop policy if exists moderation_actions_select on public.moderation_actions;
drop trigger if exists follows_rate on public.follows;
drop trigger if exists likes_rate on public.likes;
drop trigger if exists reposts_rate on public.reposts;
drop trigger if exists likes_stats on public.likes;
drop trigger if exists reposts_stats on public.reposts;
drop trigger if exists follows_stats on public.follows;

-- 4. Archive the social data (kept, not exposed); drop the derived counters.
do $$
declare t text;
begin
  foreach t in array array['community_consents', 'follows', 'likes', 'reposts', 'post_media',
                           'moderation_actions', 'rate_events', 'username_changes'] loop
    execute format('alter table public.%I set schema community_rollback', t);
    execute format('revoke all on community_rollback.%I from public, anon, authenticated', t);
  end loop;
end $$;
drop table public.post_stats;
drop table public.profile_stats;

-- 5. Functions added by 0005.
drop function public.community_social_version();
drop function public.accept_age_requirement();
drop function public.create_post(text, jsonb);
drop function public.resolve_report(uuid, text, boolean);
drop function public.community_feed(text, uuid, timestamptz, uuid, integer);
drop function public.profile_card(uuid);
drop function public.follow_list(uuid, text, timestamptz, integer);
drop function public.social_rate_trg();
drop function public.social_stats_trg();
drop function public.blocks_social_cleanup();
drop function public.moderation_log_trg();
drop function public.community_object_visible(text);
drop function public.community_path_referenced(text);
drop function public.post_repostable(uuid);
drop function public.post_interactable(uuid);
drop function public.author_visible(uuid);
drop function public.blocked_with(uuid);
drop function public.community_eligible();
drop function public.has_age_consent();
drop function public.username_reserved(text);
drop function public.username_normalize(text);

-- 6. posts: constraints and indexes added by 0005; NOT NULL only when no post needs NULL.
alter table public.posts drop constraint posts_photo_pair, drop constraint posts_has_content,
  drop constraint posts_paths_own;
drop index public.posts_user_status_published_idx;
drop index public.posts_image_path_idx;
drop index public.posts_thumb_path_idx;
do $$ begin
  if exists (select 1 from public.posts where image_path is null or thumb_path is null) then
    raise notice 'text-only posts exist: posts.image_path/thumb_path stay nullable so they are preserved';
  else
    alter table public.posts alter column image_path set not null, alter column thumb_path set not null;
  end if;
end $$;

-- 7. Privileges: restore exactly what anon/PUBLIC had before 0005.
do $$
declare r record;
begin
  for r in select * from community_rollback.privileges_before loop
    if r.kind = 'table' then
      execute format('grant %s on table %s to %s', r.privilege, r.object, r.grantee);
    elsif r.kind = 'column' then
      execute format('grant %s (%I) on table %s to %s', r.privilege, r.col, r.object, r.grantee);
    else
      execute format('grant %s on function %s to %s', r.privilege, r.object, r.grantee);
    end if;
  end loop;
end $$;
drop table community_rollback.privileges_before;

commit;
