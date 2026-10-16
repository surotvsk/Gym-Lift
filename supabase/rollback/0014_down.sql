-- Rollback of 0014 (train together). One transaction. Removes the training sessions, live summaries,
-- cheers, their functions and the unfriend trigger; version back to 6. The app hides "Train with a friend"
-- again (it only appears at version 7). Rows in rate_events of kind train_* stay (harmless, pruned).
-- Run NOTIFY pgrst, 'reload schema'; afterwards. Roll back 0014 before 0013.
begin;
drop trigger if exists friendships_train_cleanup on public.friendships;
drop function if exists public.train_friendship_deleted_trg();
drop function if exists public.train_current();
drop function if exists public.train_cheer(uuid, text);
drop function if exists public.train_progress_put(uuid, jsonb);
drop function if exists public.train_end(uuid);
drop function if exists public.train_respond(uuid, boolean);
drop function if exists public.train_invite(uuid, jsonb);
drop function if exists public.train_busy(uuid);
drop function if exists public.train_rate(text, integer, interval);
drop function if exists public.train_live(public.train_sessions);
drop table if exists public.train_cheers;      -- leaves the Realtime publication with the table
drop table if exists public.train_progress;
drop table if exists public.train_sessions;
drop function if exists public.train_participant(uuid);
drop function if exists public.train_progress_valid(jsonb);
create or replace function public.community_social_version()
returns integer language sql immutable as $$ select 6 $$;
commit;
