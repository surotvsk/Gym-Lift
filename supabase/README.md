# GymQuest Community — owner setup (Supabase, Free plan)

The Community is **optional** and ships **disabled**. Until you complete these steps the app stays
exactly as before: fully offline, no accounts, no network requests. Nothing below is done for you.

> Cost: everything here fits the Supabase **Free plan**. Do not upgrade automatically.

---

## 1. Create the project
1. Create a Supabase project (Free plan), note the **Project URL** and the **publishable / anon key**
   (Project settings → API). These two are safe in frontend code.

## 2. Run the database migrations
Run **all six** migrations, in order:
1. [`migrations/0001_community.sql`](./migrations/0001_community.sql) — tables, functions, triggers, RLS, buckets.
2. [`migrations/0002_community_grants.sql`](./migrations/0002_community_grants.sql) — explicit `GRANT`s.
3. [`migrations/0003_community_moderation_and_upload_caps.sql`](./migrations/0003_community_moderation_and_upload_caps.sql) — moderator suspension policy and a per-user Storage object cap.
4. [`migrations/0004_private_backup.sql`](./migrations/0004_private_backup.sql) — private per-user cloud backup: `backups` + `backup_versions` tables, `save_backup()` (revision/conflict), and a private `backups` Storage bucket with **owner-only** policies (no moderator access).
5. [`migrations/0005_social_feed.sql`](./migrations/0005_social_feed.sql) — social feed (Release 1): one-way follows, likes, internal shares, the *Following* feed, profile counts and lists, text-only posts and posts with 1–4 photos, a 16+ confirmation for every account (no birth date stored), spam limits, block clean-up, hidden suspended authors, moderation history and report review. It also closes four gaps in 0001–0004: post text is locked after review, photo paths must start with the author's id (and a referenced path can never be re-uploaded), signed-out (`anon`) access to Community tables is removed, and usernames get a reserved list plus a 30-day rename limit. Every new post still waits for a moderator.

6. [`migrations/0006_delete_account_grants.sql`](./migrations/0006_delete_account_grants.sql) — the privileges the `delete-account` function needs on the 0001/0004 tables (see below). Independent of 0005.

SQL editor → paste a file → Run, **or** with the CLI: `supabase db push`.

`0002` is required **because you disabled “Automatically expose new tables”**: without it the new
tables have no privileges for the `authenticated` role and the API cannot reach them at all. It grants
the minimum columns/tables the app uses (`role` is deliberately **not** granted, so it can only be set
by the owner via SQL).

`0003` fixes two things the first review surfaced: a moderator could not actually suspend another
user (only an own-row update policy existed, so the update was filtered to 0 rows), and the post quota
counted `posts` rows rather than stored objects, so a direct caller could upload unlimited objects. It
adds the moderator update policy and a per-user object cap enforced on upload.

`0001` creates `profiles`, `posts`, `reports`, `blocks`, the helper functions, the triggers (new-user
profile, role/suspension guard, post guard), all RLS policies, and the two Storage buckets
(`community` private, `avatars` public) with their policies. Each file is safe to run once — **never
re-run an already-applied migration** (run only the files not yet applied — for example `0004` if `0001`–`0003` are already in place).

Verify afterwards: **Storage** shows `community` (private, 6 MB limit) and `avatars` (public, 2 MB).

**0005 on an existing project.** Production has no CLI migration history, so do **not** use
`supabase db push` (it would try to re-run 0001–0004). Run `0005_social_feed.sql` once, as one
transaction (SQL editor or the Management API). Before that, check read-only that no post points at a
photo outside its author's folder — the new `posts_paths_own` constraint makes 0005 refuse to apply
(nothing changes) while such a row exists:

```sql
select id from public.posts
 where image_path is not null and (split_part(image_path, '/', 1) <> user_id::text
                                   or split_part(thumb_path, '/', 1) <> user_id::text);
```

Release order: the app (v47+) first — it sends the 16+ confirmation at signup and hides social
features until 0005 exists — then `0006`, then 0005, then the `delete-account` function.

**0006 — privileges for `delete-account`.** With “Automatically expose new tables” off, the 0001/0004
tables have no privileges for `service_role`, the role the function uses, so its deletes fail with
`permission denied`. The function deployed before v47 ignores those errors: *Leave Community* answers
ok while the posts, reports and blocks stay (only the Storage files go; full deletion still works
through the cascade from `auth.users`). 0006 grants only the statements the function runs — `DELETE`
on `posts`, `reports`, `blocks`, `backups`, `UPDATE (bio, avatar_path)` on `profiles`, and `SELECT` on
just the columns those statements filter on (PostgreSQL requires it) — no content reads, no inserts,
nothing on `backup_versions` (removed by the cascade). Run it once (one transaction); it also fixes the
pre-v47 function. It does not depend on 0005 and survives `0005_down`: a Release-1 rollback is
`0005_down` + the previous function, **keeping 0006**. [`rollback/0006_down.sql`](./rollback/0006_down.sql)
exists but is **not a safe rollback**: it brings the deletion bug back (pre-v47 function) or makes Leave
Community *and* account deletion fail with `500 db_delete_failed` (v47 function) — use it only if one of
the grants itself causes a problem, and re-apply 0006 right after.

**Rollback:** [`rollback/0005_down.sql`](./rollback/0005_down.sql) (one transaction) restores the
exact pre-0005 functions, policies and `anon` privileges. It **keeps all data**: posts stay (also
text-only posts — the photo columns then stay nullable), and follows, likes, shares, 16+ confirmations,
moderation history, spam counters, rename dates and photos 2–4 move to the unexposed schema
`community_rollback` (deleting an account still removes them). Re-running 0005 moves them back and
rebuilds the counters. While rolled back, photos 2–4 of a post are visible only to the author and
moderators. Run the rollback file only from `supabase/rollback/` — never place it in `migrations/`.

## 3. Authentication (email + password)
1. **Authentication → Providers → Email**: enable **Email** and keep **Confirm email** ON.
   Do **not** disable email confirmation to work around mail limits.
2. **Authentication → SMTP**: configure **custom SMTP** (e.g. Resend, Postmark, SendGrid, or your own).
   Supabase's built-in mailer is for testing only and is heavily rate-limited — real sign-ups need
   custom SMTP. Without it, verification emails will not reach most users.
3. **Authentication → URL configuration**: set **Site URL** to your deployed app
   (`https://surotvsk.github.io/Gymquest/`) and add it under **Redirect URLs**.

## 4. Deploy the privileged delete-account function
```bash
supabase functions deploy delete-account
```
Do **not** set `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` yourself — these are
**reserved secrets that Supabase provides to Edge Functions automatically**; attempting to set them
manually is rejected. The function reads them from `Deno.env` at runtime, so the **service_role key is
never** placed in `community-config.js`, the repository, or logs.
The function needs migration `0006` (privileges); every failed database step returns HTTP 500 with
the step (`db_delete_failed` + table, `db_update_failed`, `delete_failed`) — never a false success.

## 5. Point the app at your project
Edit [`../community-config.js`](../community-config.js) and set ONLY:
```js
supabaseUrl: 'https://<project>.supabase.co',
supabaseAnonKey: '<publishable/anon key>',
```
Then bump `CACHE_VERSION` in `sw.js` **and** the `?v=` strings in `index.html`, and redeploy. (The
service worker precaches the config file, so a version bump is what makes it refresh.)

## 6. Grant the first moderator (owner only)
In the SQL editor, as the project owner:
```sql
update public.profiles set role = 'moderator' where username = 'YOUR_USERNAME';
```
The API can never do this — the `profiles_guard` trigger rejects `role` changes from clients.
**Publishing stays disabled until at least one moderator exists** (`moderation_ready()`): that is the
"moderated beta" switch.

## 7. Test with two accounts
Sign up two users in the app (opt in via ☰ Community), make one a moderator, then verify: approve
posts, feed visibility, profile, reports, blocking, quotas, and account deletion.

---

## Community rules & privacy (shown in the app)
- Share only your own photos, and only what you are comfortable making public.
- No nudity, harassment, hate, or medical/body-shaming claims. Moderators may remove content and
  suspend accounts.
- **Community is online and public.** Everything else in GymQuest — workouts, history, measurements,
  timers, and your **private Progress photos** — stays on your device (or, with sync, in your private
  account) and is never published. Only the text and the photos you explicitly put in a post are
  uploaded, and only after a moderator approves the post do others see it.
- Removing your account deletes your community profile, posts and stored community media. It cannot
  recall copies others already saved, and it never touches your private on-device data.

## Owner decisions / legal (not asserted)
- **Minimum age: 16** (decided). Every account confirms it at signup (server-enforced, only the fact is
  stored, never a birth date); accounts created before 0005 confirm once before they can see or
  interact with other people's posts. Private sync works without it.
- **Moderation capacity & response times**, a takedown/appeal process, a content policy and a privacy
  notice are **your** decisions. This repository provides the mechanism, not legal compliance.
- **Data residency / GDPR-style obligations** for public user content depend on your jurisdiction —
  review them before enabling the beta.

## Limits (Free-plan friendly)
- ~5 MB maximum upload copy (the app already compresses and generates thumbnails); buckets cap at
  6 MB (`community`) and 2 MB (`avatars`).
- **10 active (pending + approved) posts per user**, **at most 4 photos per post** and **40 stored files
  per user** (20 photos + thumbnails), enforced server-side.
- Spam limits (server-side): 200 follows/day, 300 likes/hour, 50 shares/day, 20 reports/day, 20 posts/day.
- Feed is paginated and only ever requests thumbnails for cards; signed photo links last **10 minutes**
  and are refreshed when a feed reloads. Shares point to the original post — nothing is copied and
  there are no public or external links.
