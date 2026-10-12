-- GymQuest Community — migration 0010: push notifications for chat messages
--
-- A member can register this device's Web Push subscription (endpoint + p256dh/auth keys).
-- After sending a chat message the app asks the `push` Edge Function to notify the friend;
-- the function calls push_targets() with the service_role key, which checks that the message
-- is the caller's own, recent and not yet notified, and returns the recipient's devices.
-- Notifications carry only the sender's username and the chat id (never the message text).
-- Nobody can read the tables directly (RLS on, no policies, no grants).
-- community_social_version() = 4. Needs 0005, 0006, 0008 and 0009. Run once, as one transaction.
-- Rollback: supabase/rollback/0010_down.sql.
begin;

do $$
begin
  if to_regclass('public.leaderboard_entries') is null then raise exception '0010 needs 0009 first'; end if;
  if to_regclass('public.push_subscriptions') is not null then raise exception '0010 is already applied'; end if;
end $$;

create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  lang       text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_check check (endpoint ~ '^https?://[^[:space:]]+$' and char_length(endpoint) <= 1000),
  constraint push_subscriptions_keys_check check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$' and auth ~ '^[A-Za-z0-9_-]{20,24}$'),
  constraint push_subscriptions_lang_check check (lang in ('sk', 'en', 'es', 'pt-BR', 'fr', 'ar'))
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- One row per message that was already handed to the push function (no double notifications).
create table public.push_sent (
  message_id      bigint primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  notified        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index push_sent_recent_idx on public.push_sent (conversation_id, recipient_id, created_at desc);

-- RLS on, no policies: only the SECURITY DEFINER functions below reach the tables.
alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;

-- Register (or refresh) this device for the signed-in member. At most 10 devices per member.
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'en')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_lang text := case when p_lang in ('sk', 'en', 'es', 'pt-BR', 'fr', 'ar') then p_lang else 'en' end;
begin
  if v_me is null or not public.community_eligible() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https?://[^[:space:]]+$' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{20,24}$' then
    raise exception 'invalid_subscription' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang)
  values (p_endpoint, v_me, p_p256dh, p_auth, v_lang)
  on conflict (endpoint) do update
    set user_id = v_me, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang, updated_at = now();
  delete from public.push_subscriptions
   where user_id = v_me
     and endpoint in (select s.endpoint from public.push_subscriptions s where s.user_id = v_me
                       order by s.updated_at desc offset 10);
end;
$$;

-- Remove this device (sign-out, switch off). Only the caller's own row.
create function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Is this device registered for the signed-in member?
create function public.push_status(p_endpoint text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid());
$$;

-- Edge Function only (service_role): who gets a notification for this message.
-- Returns {ok:false, reason} unless the message is the sender's own, at most 10 minutes old,
-- in an open chat without a block, and not yet notified. Marks it as handled. At most one
-- notification per chat and recipient every 20 seconds: quick follow-up messages are grouped
-- into the notification that is already on the phone (reason 'recent').
create function public.push_targets(p_sender uuid, p_message bigint)
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

-- Edge Function only: the push service said the subscription no longer exists (404/410).
create function public.push_gone(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- Leaving Community also removes the member's devices.
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

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 4 $$;

-- Privileges: no direct table access; three functions for signed-in users, two for the Edge Function.
revoke all on public.push_subscriptions, public.push_sent from public, anon, authenticated;
revoke execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text),
  public.push_status(text), public.push_targets(uuid, bigint), public.push_gone(text) from public, anon, authenticated;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text),
  public.push_status(text) to authenticated;
grant execute on function public.push_targets(uuid, bigint), public.push_gone(text) to service_role;
revoke execute on function public.community_leave_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.community_leave_cleanup(uuid) to service_role;

commit;
