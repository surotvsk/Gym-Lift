-- Rollback of 0016 (Android message alerts via FCM). One transaction. Registered Android phones are
-- deleted; chats, messages, web push devices and reminders are not touched. push_targets() and
-- community_leave_cleanup() go back to their 0010 / 0012 definitions. The app then shows "not
-- available" for Android notifications (push_fcm_register is gone). The `push` Edge Function can stay
-- deployed: without an "fcm" list it only sends Web Push.
-- Run NOTIFY pgrst, 'reload schema'; afterwards.
begin;

create or replace function public.push_targets(p_sender uuid, p_message bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_msg  public.messages;
  v_conv public.conversations;
  v_to   uuid;
  v_name text;
  v_subs jsonb;
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or v_msg.sender_id is distinct from p_sender or v_msg.created_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if not found or v_conv.closed_at is not null then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  v_to := case when v_conv.user_a = p_sender then v_conv.user_b else v_conv.user_a end;
  if exists (select 1 from public.blocks
              where (blocker_id = p_sender and blocked_id = v_to) or (blocker_id = v_to and blocked_id = p_sender)) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  insert into public.push_sent (message_id, conversation_id, recipient_id) values (p_message, v_conv.id, v_to) on conflict do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'duplicate'); end if;
  if exists (select 1 from public.push_sent
              where conversation_id = v_conv.id and recipient_id = v_to and notified
                and message_id <> p_message and created_at > now() - interval '20 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'recent');
  end if;
  update public.push_sent set notified = true where message_id = p_message;
  select username into v_name from public.profiles where id = p_sender;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang)), '[]'::jsonb)
    into v_subs from public.push_subscriptions s where s.user_id = v_to;
  return jsonb_build_object('ok', true, 'conversation', v_conv.id, 'sender_name', coalesce(v_name, ''), 'subs', v_subs);
end;
$$;

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
  delete from public.push_reminders where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

drop function if exists public.push_fcm_register(text, text);
drop function if exists public.push_fcm_unregister(text);
drop function if exists public.push_fcm_gone(text);
drop table if exists public.push_fcm_tokens;

revoke execute on function public.push_targets(uuid, bigint) from public, anon, authenticated;
grant execute on function public.push_targets(uuid, bigint) to service_role;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
