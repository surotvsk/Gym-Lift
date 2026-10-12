-- Rollback of 0009 (leaderboard). One transaction. Leaderboard rows and the two leaderboard
-- moderation actions are deleted (there is nothing else to keep: XP lives in the app).
begin;
drop function if exists public.leaderboard_submit(integer, integer, text, integer, text[]);
drop function if exists public.leaderboard_top(text);
drop function if exists public.leaderboard_me();
drop function if exists public.leaderboard_set_hidden(boolean);
drop function if exists public.leaderboard_moderate(uuid, boolean);
drop function if exists public.leaderboard_achievement_value(text[], integer);
drop table if exists public.leaderboard_entries;
delete from public.moderation_actions where action in ('leaderboard_remove', 'leaderboard_restore');
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('approve', 'reject', 'remove', 'report_upheld', 'report_dismissed', 'suspend', 'unsuspend'));
create or replace function public.community_leave_cleanup(p_user uuid)
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
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 2 $$;
commit;
