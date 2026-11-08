-- Only transient viewing leases are discarded; posts, messages and identities are untouched.
begin;
drop function if exists public.push_targets(uuid,bigint);
alter function public.push_targets_v9(uuid,bigint) rename to push_targets;
grant execute on function public.push_targets(uuid,bigint) to service_role;
drop function if exists public.chat_viewing(uuid,uuid);
drop table if exists public.chat_presence;
drop function if exists public.community_feed_ranked(integer,timestamptz,uuid,timestamptz,integer);
drop function if exists public.community_feed_boost(uuid,timestamptz);
create or replace function public.community_social_version() returns integer language sql immutable as $$ select 9 $$;
commit;
