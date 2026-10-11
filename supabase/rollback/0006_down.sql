-- ============================================================================
-- GymQuest — ROLLBACK of migration 0006 (delete-account privileges)
-- ----------------------------------------------------------------------------
-- NOT A SAFE ROLLBACK — NOT PART OF ANY RELEASE ROLLBACK. Do not run it to undo
-- Release 1: the Release-1 rollback is 0005_down + the previous delete-account
-- function, and it KEEPS 0006 (0005_down never touches these privileges).
--
-- What revoking these privileges does (verified on a local stack with
-- "Automatically expose new tables" OFF, like production):
--   * pre-v47 function: brings back the deletion bug — "Leave Community"
--     answers ok but leaves the user's posts, reports and blocks (and bio) in
--     place; only Storage files are removed.
--   * v47 function: Leave Community AND full account deletion answer
--     500 db_delete_failed — nobody can delete their account any more (nothing
--     is reported as done, but the deletion is unavailable).
-- Use it only if one of these privileges itself is shown to cause a problem,
-- and re-apply 0006 (or a corrected grant) right after the fix.
--
-- Revokes exactly what 0006 granted. Schema USAGE is kept (Supabase grants it
-- to service_role at project creation; other features rely on it).
-- ============================================================================

begin;
revoke select (user_id), delete on public.posts from service_role;
revoke select (reporter_id), delete on public.reports from service_role;
revoke select (blocker_id, blocked_id), delete on public.blocks from service_role;
revoke select (id), update (bio, avatar_path) on public.profiles from service_role;
revoke select (user_id), delete on public.backups from service_role;
commit;
