-- GymQuest Community — migration 0016: message alerts for the Android app (Firebase Cloud Messaging)
--
-- The Android app (Capacitor) cannot use Web Push. It registers its FCM token instead; after a chat
-- message the `push` Edge Function asks push_targets() as before and now also gets the recipient's FCM
-- tokens. Same rules as Web Push (0010): only the member's own devices, at most 10 per member, nobody
-- can read the table directly (RLS on, no policies, no grants), leaving Community or deleting the
-- account removes the tokens. Notifications still carry only the sender's username and the chat id.
-- Reminders on Android are scheduled by the phone itself, so reminders_due() is unchanged.
-- community_social_version() is NOT changed: the app finds out whether this migration exists by
-- calling push_fcm_register (missing function = not available yet), so 0015 and 0016 can be applied
-- in either order. Needs 0010 and 0012. Run once, as one transaction.
-- Rollback: supabase/rollback/0016_down.sql.
begin;

do $$
begin
  if to_regclass('public.push_subscriptions') is null then raise exception '0016 needs 0010 first'; end if;
  if to_regclass('public.push_reminders') is null then raise exception '0016 needs 0012 first'; end if;
  if to_regclass('public.push_fcm_tokens') is not null then raise exception '0016 is already applied'; end if;
end $$;

create table public.push_fcm_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lang       text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_fcm_tokens_token_check check (char_length(token) between 20 and 4096 and token ~ '^[A-Za-z0-9_:-]+$'),
  constraint push_fcm_tokens_lang_check check (lang in ('sk', 'en', 'es', 'pt-BR', 'fr', 'ar'))
);
create index push_fcm_tokens_user_idx on public.push_fcm_tokens (user_id);
alter table public.push_fcm_tokens enable row level security;   -- no policies: functions only

-- Register (or refresh) this phone for the signed-in member. A token that belonged to another
-- account on the same phone moves to the caller. At most 10 phones per member (newest kept).
create function public.push_fcm_register(p_token text, p_lang text default 'en')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_lang text := case when p_lang in ('sk', 'en', 'es', 'pt-BR', 'fr', 'ar') then p_lang else 'en' end;
begin
  if v_me is null or not public.community_eligible() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  insert into public.push_fcm_tokens (token, user_id, lang) values (p_token, v_me, v_lang)
  on conflict (token) do update set user_id = v_me, lang = excluded.lang, updated_at = now();
  delete from public.push_fcm_tokens
   where user_id = v_me
     and token in (select t.token from public.push_fcm_tokens t where t.user_id = v_me
                    order by t.updated_at desc offset 10);
end;
$$;

-- Remove this phone (sign-out, switch off). Only the caller's own row.
create function public.push_fcm_unregister(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_fcm_tokens where token = p_token and user_id = auth.uid();
$$;

-- Edge Function only: FCM said the token no longer exists (UNREGISTERED / 404).
create function public.push_fcm_gone(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_fcm_tokens where token = p_token;
$$;

-- Same checks as 0010; the result also lists the recipient's FCM tokens ("fcm").
create or replace function public.push_targets(p_sender uuid, p_message bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_msg  public.messages;
  v_conv public.conversations;
  v_to   uuid;
  v_name text;
  v_subs jsonb;
  v_fcm  jsonb;
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
  select coalesce(jsonb_agg(jsonb_build_object('token', f.token, 'lang', f.lang)), '[]'::jsonb)
    into v_fcm from public.push_fcm_tokens f where f.user_id = v_to;
  return jsonb_build_object('ok', true, 'conversation', v_conv.id, 'sender_name', coalesce(v_name, ''), 'subs', v_subs, 'fcm', v_fcm);
end;
$$;

-- Leaving Community also removes the member's phones (0012 definition + FCM tokens).
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
  delete from public.push_fcm_tokens where user_id = p_user;
  delete from public.message_reactions where user_id = p_user;
  delete from public.profile_achievements where user_id = p_user;
  delete from public.push_reminders where user_id = p_user;
  update public.profiles set community_joined_at = null where id = p_user;
end;
$$;

-- Privileges: no direct table access; two functions for signed-in users, two for the Edge Function.
revoke all on public.push_fcm_tokens from public, anon, authenticated;
revoke execute on function public.push_fcm_register(text, text), public.push_fcm_unregister(text),
  public.push_fcm_gone(text), public.push_targets(uuid, bigint) from public, anon, authenticated;
grant execute on function public.push_fcm_register(text, text), public.push_fcm_unregister(text) to authenticated;
grant execute on function public.push_fcm_gone(text), public.push_targets(uuid, bigint) to service_role;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
