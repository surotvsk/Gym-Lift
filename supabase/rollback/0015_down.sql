-- Rollback of 0015 ("Seen" in chats). One transaction. Each person can again read only their own
-- read position; chat_reads leaves Realtime; version back to 7. The app stops showing "Seen" (it only
-- appears at version 8). No rows are removed. Run NOTIFY pgrst, 'reload schema'; afterwards.
begin;
drop policy if exists chat_reads_select_participants on public.chat_reads;
drop policy if exists chat_reads_select_own on public.chat_reads;
create policy chat_reads_select_own on public.chat_reads for select to authenticated
  using (user_id = auth.uid());
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads') then
    alter publication supabase_realtime drop table public.chat_reads;
  end if;
end $$;
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 7 $$;
commit;
