-- ============================================================================
-- GymQuest — migration 0006: privileges for the delete-account Edge Function
-- ----------------------------------------------------------------------------
-- WHY: "Automatically expose new tables" is OFF (see 0002), so the tables of
-- 0001 and 0004 have no privileges for `service_role` — the role the
-- delete-account function uses. Its deletes/updates on these tables fail with
-- "permission denied" (42501). The function deployed before v47 ignores those
-- errors, so "Leave Community" answers ok but leaves posts, reports and blocks
-- in place (Storage deletes still work: Storage has its own privileges).
--
-- Grants ONLY what the function's statements need. PostgreSQL requires SELECT
-- on every column a DELETE/UPDATE filters on, so each table gets SELECT on its
-- filter column(s) only — never on content (captions, bios, backup payloads):
--
--   posts    DELETE ... WHERE user_id = <caller>
--   reports  DELETE ... WHERE reporter_id = <caller>
--   blocks   DELETE ... WHERE blocker_id = <caller>; ... WHERE blocked_id = <caller>
--   profiles UPDATE SET bio = '', avatar_path = NULL WHERE id = <caller>  (Leave Community)
--   backups  DELETE ... WHERE user_id = <caller>                          (full deletion)
--
-- Not granted, because the function never touches them directly:
--   * backup_versions, and every other row of a fully deleted account — they
--     are removed by ON DELETE CASCADE from auth.users, which PostgreSQL runs
--     with the table owner's rights;
--   * INSERT, TRUNCATE, REFERENCES, TRIGGER, full-row SELECT, and anything for
--     anon/authenticated (their privileges and RLS are unchanged).
-- The social tables of 0005 get their service_role privileges in 0005 itself.
--
-- Independent of 0005: needs only 0001–0004, works with 0005 applied, absent or
-- rolled back (0005_down restores only anon/PUBLIC privileges, so these stay).
-- Apply it BEFORE deploying the v47 delete-account function: that version
-- reports database failures, so without these grants Leave Community and
-- account deletion would answer 500 instead of silently doing nothing.
-- Applying it also makes the pre-v47 function's Leave Community work.
--
-- Additive, idempotent, one transaction. Keep it when rolling back 0005. Its
-- rollback (supabase/rollback/0006_down.sql) is NOT a safe default: it brings the
-- deletion bug back (pre-v47 function) or makes deletion fail (v47 function).
-- ============================================================================

begin;

-- Schema access (Supabase grants this at project creation; restated so the
-- file does not depend on it).
grant usage on schema public to service_role;

grant select (user_id), delete on public.posts to service_role;
grant select (reporter_id), delete on public.reports to service_role;
grant select (blocker_id, blocked_id), delete on public.blocks to service_role;
grant select (id), update (bio, avatar_path) on public.profiles to service_role;
grant select (user_id), delete on public.backups to service_role;

commit;
