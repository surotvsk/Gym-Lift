-- GymQuest — 0021: verzia schémy sa kontroluje pri vykonaní, aj pri zdieľanom pripravenom pláne.
-- Vyžaduje 0020 (verzia 12). Bez zmien tabuliek alebo údajov. Rollback: 0021_down.sql.
begin;

do $$
begin
  if public.community_social_version() >= 13 then raise exception '0021 already applied'; end if;
  if public.community_social_version() <> 12 then raise exception '0021 requires version 12'; end if;
end $$;

-- IMMUTABLE by zložilo volanie na konštantu; samotné STABLE stále dovoľuje vloženie SQL tela.
-- STABLE + lokálny search_path ponechajú volanie aj kontrolu EXECUTE v každom vykonaní plánu.
create or replace function public.community_social_version()
returns integer language sql stable security invoker set search_path = public as $$ select 13 $$;
revoke execute on function public.community_social_version() from public, anon;
grant execute on function public.community_social_version() to authenticated;

commit;
