-- Phase 7: ranked feed and short-lived chat viewing leases. No existing content is rewritten.
begin;
do $$ begin
  if to_regclass('public.chat_presence') is not null then raise exception '0018 already applied'; end if;
  if public.community_social_version() <> 9 then raise exception '0018 requires version 9'; end if;
end $$;

-- Only an aggregate signal, never liker identities. Visibility is checked even for direct RPC calls.
create function public.community_feed_boost(p_post uuid, p_asof timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_age_consent() and public.post_interactable(p_post)
    and exists (select 1 from public.likes l join public.follows f on f.followee_id = l.user_id
      where l.post_id = p_post and f.follower_id = auth.uid() and l.created_at <= p_asof
        and f.created_at <= p_asof and public.author_visible(l.user_id));
$$;

-- RLS remains active: use precisely the approved/author/visibility gates of community_feed.
-- rank_at is the ordering timestamp, activity_at remains the actual published timestamp.
-- Recompute a deterministic sequence at the same as-of cutoff on each page. No stored feed tracking.
create function public.community_feed_ranked(p_before_tier integer default null,
  p_before timestamptz default null, p_before_id uuid default null,
  p_asof timestamptz default null, p_limit integer default 12)
returns setof jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_asof timestamptz := least(coalesce(p_asof, now()), now());
  v_ids uuid[]; v_authors uuid[]; v_tiers integer[]; v_scores timestamptz[];
  v_pending integer[] := '{}'; v_head integer:=1; v_tail integer:=0; v_i integer:=1; v_n integer;
  v_item jsonb; v_pos integer; v_tier integer; v_prev_tier integer := 0;
  v_at timestamptz; v_prev_at timestamptz; v_author uuid; v_last uuid; v_run integer := 0;
  v_count integer := 0; v_limit integer := least(greatest(coalesce(p_limit,12),1),50);
begin
  if auth.uid() is null or not public.has_age_consent() then return; end if;
  if p_before_tier is not null and (p_before_tier not in (1,2) or p_before is null or p_before_id is null or p_asof is null) then
    raise exception 'invalid_cursor' using errcode = '22023';
  end if;
  -- Compact ordering columns only. Payload/photos are fetched for at most p_limit rows.
  with candidates as (
    select p.id, p.user_id,
      case when public.are_friends(p.user_id) or exists(select 1 from public.follows f
        where f.follower_id=auth.uid() and f.followee_id=p.user_id and f.created_at<=v_asof) then 1 else 2 end as tier,
      coalesce(p.published_at,p.created_at) as published
    from public.posts p where p.status='approved' and public.author_visible(p.user_id)
      and (p.visibility='public' or public.are_friends(p.user_id))
      and coalesce(p.published_at,p.created_at)<=v_asof
  ), scored as (
    select c.*, published + case when tier=2 and public.community_feed_boost(id,v_asof)
      then interval '5 minutes' else interval '0' end as score from candidates c
  ), ordered as (select * from scored order by tier,score desc,id desc)
  select array_agg(id),array_agg(user_id),array_agg(tier),array_agg(score)
    into v_ids,v_authors,v_tiers,v_scores from ordered;
  v_n:=coalesce(array_length(v_ids,1),0);
  -- Streaming greedy merge. Each index is visited/enqueued/dequeued at most once.
  -- Deferred indices belong to one author, ahead of the unread chronological stream.
  while v_i<=v_n or v_head<=v_tail loop
    if v_head<=v_tail and (v_run<2 or v_authors[v_pending[v_head]]<>v_last or v_i>v_n) then
      v_pos:=v_pending[v_head]; v_head:=v_head+1;
    else
      while v_i<=v_n and v_tiers[v_i]=2 and v_run>=2 and v_authors[v_i]=v_last loop
        v_tail:=v_tail+1; v_pending[v_tail]:=v_i; v_i:=v_i+1;
      end loop;
      if v_i<=v_n then v_pos:=v_i; v_i:=v_i+1;
      else v_pos:=v_pending[v_head]; v_head:=v_head+1; end if;
    end if;
    v_tier:=v_tiers[v_pos]; v_author:=v_authors[v_pos]; v_at:=v_scores[v_pos];
    if v_tier=v_prev_tier then v_at:=least(v_at,v_prev_at-interval '1 microsecond'); end if;
    v_run:=case when v_tier=v_prev_tier and v_author=v_last then v_run+1 else 1 end;
    v_last:=v_author; v_prev_tier:=v_tier; v_prev_at:=v_at;
    if p_before_tier is null or v_tier>p_before_tier or
      (v_tier=p_before_tier and (v_at,v_ids[v_pos])<(p_before,p_before_id)) then
      select to_jsonb(payload) into v_item from (
    select p.id as post_id, p.user_id as author_id, a.username as author_name, a.avatar_path as author_avatar,
      (a.role = 'moderator' and not a.suspended) as author_moderator, p.caption,
      case when p.image_path is null then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object('image',p.image_path,'thumb',p.thumb_path)) ||
        coalesce((select jsonb_agg(jsonb_build_object('image',m.image_path,'thumb',m.thumb_path) order by m.position)
          from public.post_media m where m.post_id=p.id),'[]'::jsonb) end as photos,
      coalesce(p.published_at,p.created_at) as activity_at,
      null::uuid as reposted_by, null::text as reposted_by_name,
      coalesce(s.likes,0) as likes, coalesce(s.reposts,0) as reposts, coalesce(s.comments,0) as comments,
      exists(select 1 from public.likes l where l.post_id=p.id and l.user_id=auth.uid()) as liked_by_me,
      exists(select 1 from public.reposts r where r.post_id=p.id and r.user_id=auth.uid()) as reposted_by_me,
      p.visibility
    from public.posts p join public.profiles a on a.id=p.user_id
      left join public.post_stats s on s.post_id=p.id
    where p.id=v_ids[v_pos] and p.status='approved' and public.author_visible(p.user_id)
      and (p.visibility='public' or public.are_friends(p.user_id))
      ) payload;
      if v_item is not null then
        return next v_item || jsonb_build_object('rank_tier',v_tier,'rank_at',v_at,'rank_asof',v_asof,'suggested',v_tier=2);
        v_count:=v_count+1;
        if v_count>=v_limit then return; end if;
      end if;
    end if;
  end loop;
end;
$$;

create table public.chat_presence (
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewer_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  until timestamptz not null,
  primary key(user_id,viewer_id)
);
create index chat_presence_expiry on public.chat_presence(until);
alter table public.chat_presence enable row level security;
-- One ephemeral viewer per tab/app instance. No public read API or client-chosen TTL/user.
create function public.chat_viewing(p_viewer uuid, p_conversation uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or p_viewer is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  delete from public.chat_presence where until<=now();
  if p_conversation is null then
    delete from public.chat_presence where user_id=v_me and viewer_id=p_viewer; return;
  end if;
  if not public.community_eligible() or not exists(select 1 from public.conversations c
    where c.id=p_conversation and v_me in(c.user_a,c.user_b) and c.closed_at is null
      and public.are_friends(case when c.user_a=v_me then c.user_b else c.user_a end)
      and public.author_visible(case when c.user_a=v_me then c.user_b else c.user_a end)) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if not exists(select 1 from public.chat_presence where user_id=v_me and viewer_id=p_viewer)
    and (select count(*) from public.chat_presence where user_id=v_me)>=10 then
    raise exception 'too_many_viewers' using errcode='42501';
  end if;
  insert into public.chat_presence(user_id,viewer_id,conversation_id,until) values(v_me,p_viewer,p_conversation,now()+interval '30 seconds')
    on conflict(user_id,viewer_id) do update set conversation_id=excluded.conversation_id,until=excluded.until;
end;
$$;

-- Wrap the proven targeting/duplicate/block checks without changing their semantics.
alter function public.push_targets(uuid,bigint) rename to push_targets_v9;
create function public.push_targets(p_sender uuid,p_message bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb; v_viewing boolean;
begin
  v_result := public.push_targets_v9(p_sender,p_message);
  if v_result->>'ok'='true' then
    select exists(select 1 from public.chat_presence p join public.conversations c on c.id=p.conversation_id
      where c.id=(v_result->>'conversation')::uuid and p.user_id=case when c.user_a=p_sender then c.user_b else c.user_a end
        and p.until>now()) into v_viewing;
    v_result := v_result || jsonb_build_object('viewing',v_viewing);
    -- A fully suppressed notification must not start the 20-second delivered-notification cooldown.
    -- Apple targets still receive a push, so retain grouping for those recipients.
    if v_viewing and not exists(select 1 from jsonb_array_elements(v_result->'subs') s
      where s->>'endpoint' ~* '^https://([a-z0-9-]+\.)*push\.apple\.com/') then
      update public.push_sent set notified=false where message_id=p_message;
    end if;
  end if;
  return v_result;
end;
$$;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 10 $$;
revoke all on public.chat_presence from public,anon,authenticated,service_role;
revoke execute on function public.community_feed_boost(uuid,timestamptz),
  public.community_feed_ranked(integer,timestamptz,uuid,timestamptz,integer),public.chat_viewing(uuid,uuid),
  public.push_targets(uuid,bigint),public.push_targets_v9(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.community_feed_boost(uuid,timestamptz),
  public.community_feed_ranked(integer,timestamptz,uuid,timestamptz,integer),public.chat_viewing(uuid,uuid) to authenticated;
grant execute on function public.push_targets(uuid,bigint) to service_role;
commit;
