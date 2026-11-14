-- Rollback 0021: obnoví definíciu z 0020 (verzia 12), nemení tabuľky ani údaje.
-- Obnoví aj pôvodné riziko konštanty v pripravenom pláne. Vrátiť pred 0020, jedna transakcia.
begin;

do $$
begin
  if public.community_social_version() <> 13 then raise exception '0021 rollback requires version 13'; end if;
end $$;

create or replace function public.community_social_version()
returns integer language sql immutable security invoker as $$ select 12 $$;
revoke execute on function public.community_social_version() from public, anon;
grant execute on function public.community_social_version() to authenticated;

commit;
