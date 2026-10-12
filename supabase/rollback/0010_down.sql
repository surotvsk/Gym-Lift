-- Rollback of 0010 (push notifications). One transaction. Registered devices and the
-- "already notified" log are deleted; chats and messages are not touched. Afterwards the app
-- hides the notification switch (community_social_version() = 3) and stops calling `push`.
-- Run NOTIFY pgrst, 'reload schema'; afterwards. The `push` Edge Function can stay deployed:
-- without push_targets() it only returns an error and sends nothing.
begin;
drop function if exists public.push_subscribe(text, text, text, text);
drop function if exists public.push_unsubscribe(text);
drop function if exists public.push_status(text);
drop function if exists public.push_targets(uuid, bigint);
drop function if exists public.push_gone(text);
drop table if exists public.push_sent;
drop table if exists public.push_subscriptions;
create or replace function public.community_leave_cleanup(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  delete from public.conversations where user_a = p_user or user_b = p_user;   -- messages, read markers cascade
  delete from public.friendships where user_a = p_user or user_b = p_user;
  delete from public.friend_requests where from_id = p_user or to_id = p_user;
  delete from public.post_comments where user_id = p_user;
  delete from public.leaderboard_entries where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 3 $$;
commit;
