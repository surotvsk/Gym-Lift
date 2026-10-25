# GymQuest Community — owner setup (Supabase, Free plan)

The Community is **optional** and ships **disabled**. Until you complete these steps the app stays
exactly as before: fully offline, no accounts, no network requests. Nothing below is done for you.

> Cost: everything here fits the Supabase **Free plan**. Do not upgrade automatically.

---

## 1. Create the project
1. Create a Supabase project (Free plan), note the **Project URL** and the **publishable / anon key**
   (Project settings → API). These two are safe in frontend code.

## 2. Run the database migrations
Run **all** migrations, in order (there is no 0007 — the number is reserved):
1. [`migrations/0001_community.sql`](./migrations/0001_community.sql) — tables, functions, triggers, RLS, buckets.
2. [`migrations/0002_community_grants.sql`](./migrations/0002_community_grants.sql) — explicit `GRANT`s.
3. [`migrations/0003_community_moderation_and_upload_caps.sql`](./migrations/0003_community_moderation_and_upload_caps.sql) — moderator suspension policy and a per-user Storage object cap.
4. [`migrations/0004_private_backup.sql`](./migrations/0004_private_backup.sql) — private per-user cloud backup: `backups` + `backup_versions` tables, `save_backup()` (revision/conflict), and a private `backups` Storage bucket with **owner-only** policies (no moderator access).
5. [`migrations/0005_social_feed.sql`](./migrations/0005_social_feed.sql) — social feed (Release 1): one-way follows, likes, internal shares, the *Following* feed, profile counts and lists, text-only posts and posts with 1–4 photos, a 16+ confirmation for every account (no birth date stored), spam limits, block clean-up, hidden suspended authors, moderation history and report review. It also closes four gaps in 0001–0004: post text is locked after review, photo paths must start with the author's id (and a referenced path can never be re-uploaded), signed-out (`anon`) access to Community tables is removed, and usernames get a reserved list plus a 30-day rename limit. Every new post still waits for a moderator.

6. [`migrations/0006_delete_account_grants.sql`](./migrations/0006_delete_account_grants.sql) — the privileges the `delete-account` function needs on the 0001/0004 tables (see below). Independent of 0005.
7. [`migrations/0008_social_phase2.sql`](./migrations/0008_social_phase2.sql) — Community Phase 2: user search (Community members only, "Show me in search" on by default), friend requests and private friend lists, friends-only posts, comments, one-to-one live chat between friends (Supabase Realtime; moderators can never read chats), message/comment reports that store only a copy of the reported item, and a daily `pg_cron` purge. Needs 0005 and 0006 and the `pg_cron` extension (Database → Extensions).
8. [`migrations/0009_leaderboard.sql`](./migrations/0009_leaderboard.sql) — Community leaderboard (top 20 by XP): one row per member, the app reports XP through `leaderboard_submit()` and the server applies the limits (300 training XP per UTC day, 1,000 per ISO week, achievement XP computed on the server from the earned ids, at most 5,150), members appear by default and can hide themselves, moderators can remove a member. `community_social_version()` becomes 3. Needs 0008.
9. [`migrations/0010_push.sql`](./migrations/0010_push.sql) — push notifications for chat messages: members register a device (Web Push subscription) through `push_subscribe()`; after sending a message the app calls the `push` Edge Function, which asks `push_targets()` (service_role only) whether the message is the caller's own, recent, in an open chat without a block and not yet notified, and gets the friend's devices. At most one notification per chat every 20 seconds; the notification carries only the sender's username and the chat id. Nobody can read the device table directly. Leaving Community or deleting the account removes the devices. `community_social_version()` becomes 4. Needs 0009.
10. [`migrations/0011_social_extras.sql`](./migrations/0011_social_extras.sql) — chat replies (`messages.reply_to`, same chat only) and reactions (`message_reactions`: ❤️ 😂 👍 😮 💪 🔥, one per person per message, participants only, not in Realtime), shared workout plans / finished workouts on messages (`messages.attachment`) and under posts (`post_attachments`, visible exactly like the post, added only while it waits for review via `create_post_shared()`), all validated by `share_attachment_valid()`; and the top 3 achievements on profiles (`profile_achievements`, real ids only, can be hidden). `community_social_version()` becomes 5. Needs 0010.
11. [`migrations/0012_reminders.sql`](./migrations/0012_reminders.sql) — water / meal / workout reminders: `push_reminders` (settings per member, in the phone's time zone), `reminders_due()` (service_role only, marks what it returns as sent), and a `pg_cron` job (`gymquest-reminders`, every 5 minutes) that calls the `reminders` Edge Function through `pg_net` with a shared secret read from Vault. Installs `pg_net`. `community_social_version()` becomes 6. Needs 0011.

12. [`migrations/0013_reminders_default_on.sql`](./migrations/0013_reminders_default_on.sql) — reminders on by default (see below). Version stays 6. Needs 0012.
13. [`migrations/0014_train_together.sql`](./migrations/0014_train_together.sql) — train together with a friend: `train_sessions` (an invitation valid 30 minutes, an active session valid 6 hours, optional shared plan in the 0011 format), `train_progress` (each participant's small live summary: plan name, current exercise, sets done / planned, last set, finished — validated by `train_progress_valid()`, nothing else accepted) and `train_cheers` (💪 🔥 👏 🙌). Only the two participants can read their rows; every change goes through `train_invite()`, `train_respond()`, `train_end()`, `train_progress_put()`, `train_cheer()` (friends only, no blocks, Community-eligible, one live session per person, 30 invitations a day, 30 cheers per 10 minutes); the app reads everything with `train_current()`. Unfriending (also Leave Community and blocking) deletes the pair's sessions through a trigger on `friendships`; old sessions are deleted after 7 days. The three tables are added to the Realtime publication. No Edge Function change. `community_social_version()` becomes 7. Needs 0013.

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

Release order (as released on 2026-10-11): the app (v47+) first — it sends the 16+ confirmation at
signup and hides social features until 0005 exists — then `0006`, then the v47 `delete-account`
function, then 0005. The v47 function works with and without 0005 (it skips the social tables until
they exist), so deploying it before 0005 leaves no window in which *Leave Community* misses the
user's follows, likes and shares.

**0006 — privileges for `delete-account`.** With “Automatically expose new tables” off, the 0001/0004
tables have no privileges for `service_role`, the role the function uses, so its deletes fail with
`permission denied`. The function deployed before v47 ignores those errors: *Leave Community* answers
ok while the posts, reports and blocks stay (only the Storage files go; full deletion still works
through the cascade from `auth.users`). 0006 grants only the statements the function runs — `DELETE`
on `posts`, `reports`, `blocks`, `backups`, `UPDATE (bio, avatar_path)` on `profiles`, and `SELECT` on
just the columns those statements filter on (PostgreSQL requires it) — no content reads, no inserts,
nothing on `backup_versions` (removed by the cascade). Run it once (one transaction); it also fixes the
pre-v47 function. It does not depend on 0005 and survives `0005_down`: a Release-1 rollback is
`0005_down` alone, **keeping 0006 and the v47 function** (see *Rollback* below). [`rollback/0006_down.sql`](./rollback/0006_down.sql)
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
Afterwards reload the API schema cache (`NOTIFY pgrst, 'reload schema';`). **Keep `0006` and the v47
`delete-account` function**: the function works while 0005 is rolled back (it skips the moved social
tables) and `0005_down` never touches the 0006 privileges. Do not redeploy the pre-v47 function and do
not run `0006_down`. The app (v47+) falls back to the pre-0005 Community by itself.

**0008 — friends, chat, comments, search.** Run it once, as one transaction, after 0005 and 0006
(it refuses to run without 0005, without `pg_cron`, or a second time). Release order: the app (v49+)
first — it shows the new features only when `community_social_version()` answers 2 and otherwise keeps
the Release-1 Community — then 0008, then the `delete-account` function that calls
`community_leave_cleanup` (the older function keeps working, but *Leave Community* then leaves the
user's friendships, chats and comments until full deletion). Retention, enforced by the daily job
`gymquest-chat-purge` (03:23 UTC): a chat closed by unfriending is deleted after 30 days, messages
after 12 months, report copies 90 days after the report is resolved. Deleting a message or a chat
removes it for both people; blocking removes the friendship, requests and the chat. Afterwards reload
the API schema cache (`NOTIFY pgrst, 'reload schema';`) and check Database → Replication shows
`messages` and `friend_requests` in `supabase_realtime`.

**0008 rollback:** [`rollback/0008_down.sql`](./rollback/0008_down.sql) (one transaction) restores the
0005 functions and policies and removes the purge job. Friend requests, friendships, chats, messages
and comments move to `community_rollback` (deleting an account still removes them; re-running 0008
moves them back). Friends-only posts stay visible only to their author and moderators. The copies of
reported messages/comments are dropped. Roll back **0008 before 0005** — never run `0005_down` while
0008 is applied. Keep 0006 and the `delete-account` function; the v49 app falls back by itself.

**0009 — leaderboard.** Release order: the app (v57+) first — it shows the leaderboard only when `community_social_version()` answers 3 — then run 0009 once, as one transaction, then `NOTIFY pgrst, 'reload schema';`. The `delete-account` function does not need redeploying (it calls `community_leave_cleanup`, which 0009 extends). **Rollback:** [`rollback/0009_down.sql`](./rollback/0009_down.sql) drops the leaderboard (there is no other data to keep: XP lives in the app) and sets the version back to 2; the app hides the leaderboard by itself.

**0010 — push notifications.** Release order:
1. The app (v60+) first. It shows the notification switch only when `community_social_version()` answers 4 and `community-config.js` has `vapidPublicKey`.
2. Run 0010 once, as one transaction, then `NOTIFY pgrst, 'reload schema';`.
3. Set the three function secrets (the key pair is generated once; only the **public** half is in `community-config.js`):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<base64url public key> VAPID_PRIVATE_KEY=<base64url private key> VAPID_SUBJECT=https://surotvsk.github.io/Gymquest/
   ```
4. Deploy the function: `supabase functions deploy push` (keep JWT verification on).

Between steps 2 and 4 people can already turn notifications on; messages are simply not notified yet. The `delete-account` function does not need redeploying (0010 extends `community_leave_cleanup`; full deletion removes the devices by cascade). **Rollback:** [`rollback/0010_down.sql`](./rollback/0010_down.sql) removes the devices and the "already notified" log and sets the version back to 3; the app hides the switch and stops calling `push` by itself. The `push` function can stay deployed (without 0010 it sends nothing). Roll back **0010 before 0009**.

**0011 — replies, reactions, shared plans/workouts, profile achievements.** Release order: the app (v63+) first — it shows these features only when `community_social_version()` answers 5 or more — then run 0011 once, as one transaction, then `NOTIFY pgrst, 'reload schema';`. No function needs redeploying. Messages that carry a plan or workout keep a normal text line, so older app versions still read them. **Rollback:** [`rollback/0011_down.sql`](./rollback/0011_down.sql) (roll back 0012 first if it is applied) removes reactions, the shared items under posts, the achievement showcase and the reply links / shared items on messages (message texts stay); version back to 4.

**0012 — reminders.** Release order:
1. The app (v63+) (shows the Reminders card only at version 6).
2. Run 0012 once, as one transaction, then `NOTIFY pgrst, 'reload schema';` (installs `pg_net`, creates the cron job).
3. Generate one random secret (at least 32 characters) and set it as a function secret: `supabase secrets set REMINDER_SECRET=<secret>`.
4. Deploy the function **without JWT verification** (the database calls it, protected by the secret): `supabase functions deploy reminders --no-verify-jwt`.
5. Store the function URL and the same secret in Vault (SQL editor):
   ```sql
   select vault.create_secret('https://<project>.supabase.co/functions/v1/reminders', 'gq_reminders_url');
   select vault.create_secret('<the same secret>', 'gq_reminders_secret');
   ```
Until step 5 the job runs but sends nothing. **Rollback:** [`rollback/0012_down.sql`](./rollback/0012_down.sql) removes the job, settings and functions (version back to 5); delete the two Vault secrets and the `reminders` function if they are no longer wanted.

**0014 — train together.** App (v72+) first (it shows nothing new until version 7), then run 0014 once as one transaction + `NOTIFY pgrst, 'reload schema';`. Post-check: `select public.community_social_version()` = 7; the three `train_*` tables are in `supabase_realtime`; `anon` has no access. **Rollback:** [`rollback/0014_down.sql`](./rollback/0014_down.sql) (removes the sessions, summaries, cheers, functions and trigger; version back to 6; the app hides the feature again). Roll back 0014 before 0013.

**0013 — reminders on by default.** App (v65+) first, then run 0013 once + `NOTIFY pgrst, 'reload schema';`. `reminders_get()` returns the defaults switched on and `saved: false` for members who never saved settings; the app then saves them once in the phone's time zone. Version stays 6. **Rollback:** [`rollback/0013_down.sql`](./rollback/0013_down.sql) (defaults off again; saved rows keep their values). Roll back 0013 before 0012.

## 3. Authentication (email + password)
1. **Authentication → Providers → Email**: enable **Email** and keep **Confirm email** ON.
   Do **not** disable email confirmation to work around mail limits.
2. **Authentication → SMTP**: configure **custom SMTP** (e.g. Resend, Postmark, SendGrid, or your own).
   Supabase's built-in mailer is for testing only and is heavily rate-limited — real sign-ups need
   custom SMTP. Without it, verification emails will not reach most users.
3. **Authentication → URL configuration**: set **Site URL** to your deployed app
   (`https://surotvsk.github.io/Gymquest/`) and add it under **Redirect URLs**.
4. **Authentication → Email Templates → Reset Password**: make the link
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` (instead of `{{ .ConfirmationURL }}`).
   Opening that link only shows GymQuest's set-password form; the one-time token is used when the
   person presses **Set password**, so email scanners that open links first (Outlook Safe Links,
   antivirus, company gateways) can no longer use it up. Links in the old format keep working.

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

### Push notifications function (0010)
```bash
supabase functions deploy push
```
It needs the secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see 0010 above) and
answers `server_not_configured` without them. It only contacts the browsers' push services
(Google FCM, Apple, Mozilla, Microsoft); payloads are encrypted for each device (RFC 8291) and signed
with VAPID (RFC 8292). Generate a key pair once, e.g.:
```bash
node -e 'const c=require("crypto");const k=c.generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({format:"jwk"});const b=(s)=>Buffer.from(s,"base64url");console.log("public:",Buffer.concat([Buffer.from([4]),b(k.x),b(k.y)]).toString("base64url"));console.log("private:",k.d)'
```
Put the public key into `community-config.js` (`vapidPublicKey`) and keep the private key only in the
function secrets. Changing the key pair later makes every device register again: the app tries this
by itself on its next start, and on iPhone the person may have to turn the switch on again.

## 5. Point the app at your project
Edit [`../community-config.js`](../community-config.js) and set ONLY:
```js
supabaseUrl: 'https://<project>.supabase.co',
supabaseAnonKey: '<publishable/anon key>',
vapidPublicKey: '<Web Push public key, only with 0010>',
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
