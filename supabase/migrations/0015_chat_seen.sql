-- GymQuest Community — migration 0015: "Seen" in chats.
--   * chat_reads — both people in a conversation may now read each other's read position (last_read_id).
--                  Before, each person could only read their own row. The row holds nothing but the id of
--                  the last message that person has read; it changes only through mark_read() (0008).
--   * chat_reads joins Realtime, so "Seen" appears as soon as the friend opens the chat (rows are still
--                  filtered by RLS: only the two participants receive them).
-- No new data is collected: read positions already exist since 0008 (they drive the unread badges).
-- community_social_version() = 8. Needs 0014. Run once, as one transaction.
-- Rollback: supabase/rollback/0015_down.sql.
begin;

do $$
begin
  if to_regclass('public.train_sessions') is null then raise exception '0015 needs 0014 first'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_reads'
               and policyname = 'chat_reads_select_participants') then
    raise exception '0015 is already applied';
  end if;
end $$;

drop policy if exists chat_reads_select_own on public.chat_reads;
create policy chat_reads_select_participants on public.chat_reads for select to authenticated
  using (public.chat_participant(conversation_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reads') then
    alter publication supabase_realtime add table public.chat_reads;
  end if;
end $$;

create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 8 $$;

commit;
