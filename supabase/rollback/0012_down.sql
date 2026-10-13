-- Rollback of 0012 (reminders). One transaction. Removes the cron job, the reminder settings and the
-- functions; version back to 5. pg_net and the Vault secrets are left in place (harmless without the
-- job; delete the secrets gq_reminders_url / gq_reminders_secret in Vault if no longer wanted).
-- Run NOTIFY pgrst, 'reload schema'; afterwards. Roll back 0012 before 0011.
begin;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gymquest-reminders') then perform cron.unschedule('gymquest-reminders'); end if;
end $$;
drop function if exists public.reminders_dispatch();
drop function if exists public.reminders_due();
drop function if exists public.reminders_set(jsonb);
drop function if exists public.reminders_get();
drop table if exists public.push_reminders;
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
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 5 $$;
commit;
