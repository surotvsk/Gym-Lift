-- Rollback of 0011 (chat replies and reactions, shared plans/workouts, profile achievements).
-- One transaction. Deleted: reactions, the shared items under posts, the achievement showcase,
-- and the reply links and shared items on messages (the message texts themselves stay — a message
-- that carried a plan keeps its text line). Afterwards the app hides these features by itself
-- (community_social_version() = 4). Run NOTIFY pgrst, 'reload schema'; afterwards.
-- Roll back 0011 before 0010.
begin;
drop function if exists public.create_post_shared(text, jsonb, text, jsonb);
drop function if exists public.profile_achievements_set(text[], integer);
drop function if exists public.profile_achievements_hide(boolean);
drop function if exists public.profile_achievements_get(uuid);
drop function if exists public.achievement_catalog();
drop table if exists public.profile_achievements;
drop table if exists public.post_attachments;
drop table if exists public.message_reactions;
drop function if exists public.message_visible_to_me(bigint);
drop function if exists public.message_reactable(bigint);
drop trigger if exists messages_reply_guard on public.messages;
drop function if exists public.messages_reply_guard_trg();
alter table public.messages drop constraint if exists messages_attachment_check;
alter table public.messages drop column if exists attachment;
alter table public.messages drop column if exists reply_to;
drop function if exists public.share_attachment_valid(jsonb);
create or replace function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  delete from public.leaderboard_entries where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 4 $$;
commit;
