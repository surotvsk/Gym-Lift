# Social feed (migration 0005) — local verification suite

Everything here runs against a **local Supabase test stack** (Docker, `supabase start`), never
production: `lib.js` refuses any URL that is not `http://127.0.0.1` / `localhost`. The local stack's
service key and db container are used only to create disposable users, act as a local test
moderator and inspect rows; neither exists in production.

## Run

```bash
# local stack: supabase init + 0001–0004 copied into its migrations/, then `supabase start`
export GQ_LOCAL_URL=http://127.0.0.1:54321 GQ_LOCAL_ANON=... GQ_LOCAL_SERVICE=...   # supabase status -o env
export GQ_STATE=/tmp/gq-seed.json                                                 # outside the repo

node tests/social/seed-pre0005.js      # v46-style data + shows the pre-0005 gaps are open
# apply supabase/migrations/0005_social_feed.sql to the LOCAL db (one transaction)
node tests/social/run.js               # feature, privacy and access-rule (RLS) suite
GQ_BASELINE=<snapshot after 0001–0004> GQ_SNAPSHOT=<snapshot cmd> node tests/social/rollback.js
GQ_COMMUNITY_CONFIG=<local community-config.js> node tests/social/ui.js   # real Chrome
```

The existing suites (`tests/auth`, `tests/sync`) run against the same local stack with
`GQ_COMMUNITY_CONFIG` (serves a local `community-config.js` instead of the repository's) and a Node
`GQ_GENLINK` helper; both harnesses now also run on Linux.

## What is covered

| File | Proves |
|---|---|
| `seed-pre0005.js` | data created by the v46 flows; before 0005 an approved post's text can be edited, a post can point at another user's photo, and signed-out visitors can read profiles |
| `run.js` | migration keeps the pre-0005 data; 16+ at signup (admin and public paths) and the one-time prompt; existing users without it keep private sync but see no posts; no signed-out access to any Community table, function or photo; text-only and 1–4 photo posts, size/type/count limits; photo-path ownership, no photo added later, no swap after review; text locked after review; pending/rejected/approved visibility of posts and photos 1–4; follows (duplicate/self refused, counts, lists); likes (one per user, "who liked" private also from authors and moderators); shares; Following feed (shares once, newest first, paging); block clean-up and mutual hiding of profiles, posts, photos and lists; suspension and lifting; report review (dismiss / uphold + remove); privacy of backups, consents, moderation history, rate events; reserved usernames, look-alikes of moderators, 30-day rename limit; spam limits; v46 app queries still work; Leave Community and full deletion leave no social rows, and a delete failure is reported |
| `rollback.js` | `0005_down` restores the pre-0005 schema, policies and privileges (compared with a snapshot); every row is preserved in `community_rollback`; v46 flows work; deleting an account while rolled back still removes its archived rows; re-applying 0005 restores the rows and rebuilds the counters exactly; a second rollback gives the same result |
| `ui.js` | the app in Chrome: 16+ checkbox, composing from a device file and a progress photo with GPS/camera EXIF — stored files carry none; moderator approval refused when the text changed after review; like, share (with confirmation), photo viewer, follow, lists, Following feed, report reasons, block, age card, reserved names; social features hidden when 0005 is missing; no untranslated keys in 6 languages; no page exceptions |

## Results — v47 release candidate (2026-10-10, local stack, Fedora 44, Docker 29.7)

One clean run from a freshly reset local database (0001–0004), final code:

| Step | Result |
|---|---|
| seed: pre-0005 gaps open (text editable after approval, foreign photo path, anon reads profiles) | 3 / 3 confirmed |
| 0005 with a post pointing at another user's photo | refused, schema identical to the baseline |
| 0005 applied (one transaction) | ok |
| `run.js` access rules / features / privacy / deletion | **216 / 216** |
| `rollback.js` down → compare → re-apply → down → re-apply | **54 / 54** |
| new `delete-account` while 0005 is rolled back (Leave Community) | 3 / 3 |
| `ui.js` real Chrome | **48 / 48** |
| `tests/auth/run-auth.js` | 53 / 55 — the 2 failures (F, M: signup with an already-registered email) are a difference of the local auth server, which answers `422 user_already_exists`; the unchanged v46 build fails the same 2 checks locally, and both passed on production (v46). Re-run on production after release. |
| `tests/sync/run.js "^smoke"` | 6 / 6 |
| `tests/sync/live-verify.js` | 38 / 38 |
| `tests/sync/run.js "RLS\|delete cloud backup"` | 7 / 7 |
