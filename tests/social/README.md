# Social feed (migration 0005) — local verification suite

Everything here runs against a **local Supabase test stack** (Docker, `supabase start`), never
production: `lib.js` refuses any URL that is not `http://127.0.0.1` / `localhost`. The local stack's
service key and db container are used only to create disposable users, act as a local test
moderator and inspect rows; neither exists in production.

## Permanent production test accounts — NEVER DELETE

`gqsync-c`, `gqsocial-a` and `gqsocial-b` are permanent production test accounts for ongoing GymQuest
development. **Never delete them** and never use them for full account deletion ("Delete my account",
`delete-account` mode `full`) or for injected-failure tests. Full deletion and failure-injection tests
run only with disposable **local** accounts on the local Supabase stack (`tests/social/delete-account.js`).
Do not create another production account without separate approval. Their credentials live outside
the repository.

## Run

```bash
# local stack: supabase init + 0001–0004 copied into its migrations/, then `supabase start`
export GQ_LOCAL_URL=http://127.0.0.1:54321 GQ_LOCAL_ANON=... GQ_LOCAL_SERVICE=...   # supabase status -o env
export GQ_STATE=/tmp/gq-seed.json                                                 # outside the repo

node tests/social/seed-pre0005.js      # v46-style data + shows the pre-0005 gaps are open
# apply supabase/migrations/0005_social_feed.sql to the LOCAL db (one transaction)
node tests/social/run.js               # feature, privacy and access-rule (RLS) suite
# apply supabase/migrations/0006_delete_account_grants.sql; serve the function: `supabase functions serve`
node tests/social/delete-account.js    # both deletion modes, every failure reported, 0006 least privilege
GQ_BASELINE=<snapshot after 0001–0004> GQ_SNAPSHOT=<snapshot cmd> node tests/social/rollback.js
GQ_COMMUNITY_CONFIG=<local community-config.js> node tests/social/ui.js   # real Chrome
```

**Match production:** set `auto_expose_new_tables = false` under `[api]` in the local stack's
`supabase/config.toml` before `supabase db reset` (production has “Automatically expose new tables”
off). With the default (on), every table is granted to `anon`/`authenticated`/`service_role` and
privilege bugs stay hidden — the pre-v47 Leave Community bug passed locally that way.

The existing suites (`tests/auth`, `tests/sync`) run against the same local stack with
`GQ_COMMUNITY_CONFIG` (serves a local `community-config.js` instead of the repository's) and a Node
`GQ_GENLINK` helper; both harnesses now also run on Linux.

## What is covered

| File | Proves |
|---|---|
| `seed-pre0005.js` | data created by the v46 flows; before 0005 an approved post's text can be edited, a post can point at another user's photo, and signed-out visitors can read profiles |
| `run.js` | migration keeps the pre-0005 data; 16+ at signup (admin and public paths) and the one-time prompt; existing users without it keep private sync but see no posts; no signed-out access to any Community table, function or photo; text-only and 1–4 photo posts, size/type/count limits; photo-path ownership, no photo added later, no swap after review; text locked after review; pending/rejected/approved visibility of posts and photos 1–4; follows (duplicate/self refused, counts, lists); likes (one per user, "who liked" private also from authors and moderators); shares; Following feed (shares once, newest first, paging); block clean-up and mutual hiding of profiles, posts, photos and lists; suspension and lifting; report review (dismiss / uphold + remove); privacy of backups, consents, moderation history, rate events; reserved usernames, look-alikes of moderators, 30-day rename limit; spam limits; v46 app queries still work; Leave Community and full deletion leave no social rows, and a delete failure is reported |
| `rollback.js` | `0005_down` restores the pre-0005 schema, policies and privileges (compared with a snapshot); every row is preserved in `community_rollback`; v46 flows work; deleting an account while rolled back still removes its archived rows; re-applying 0005 restores the rows and rebuilds the counters exactly; a second rollback gives the same result |
| `delete-account.js` | needs 0006; runs with 0005 applied, absent or rolled back. service_role has exactly the 0006 privileges — checked with SQL and through the real Data API with the service key (allowed deletes/updates succeed; content reads, inserts, other columns, `backup_versions` refused with 42501); anon has no access to any Community/backup table or bucket; a user cannot read or change another user's backup, blocks, reports, bio or posts; unauthenticated calls refused; Leave Community removes posts, reports, blocks both ways, files (and with 0005 follows both ways, likes, shares, rate events), clears the bio, keeps account, backup and 16+ confirmation; full deletion leaves nothing (incl. `backup_versions` via the cascade from `auth.users`); an injected failure in **every** database step of both modes (each delete, the profile update, the auth-user delete) answers 500 with the step and never ok — full deletion then keeps the account — and a retry completes; revoking any single 0006 privilege makes its step fail visibly. Disposable **local** accounts only |
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

## Results — 0006 grants fix (2026-10-11, local stack with auto-expose OFF like production)

Privileges after `db reset` match production: `anon` gets 42501 on all six 0001/0004 tables, helper
functions stay executable, `service_role` has no SELECT/INSERT/UPDATE/DELETE on them. The production
function (`a2fd84f`) reproduces the production bug here exactly.

| Step | Result |
|---|---|
| seed (gap 3 is already closed with auto-expose off) | 3 / 3 |
| 0005 refused with a hijacked post, schema identical; then applied | ok |
| `run.js` | **216 / 216** |
| `rollback.js` (schema incl. 0006 grants identical to the baseline after each rollback) | **54 / 54** |
| `delete-account.js` — 0005 applied / rolled back / absent | **148 / 148**, **128 / 128**, **128 / 128** |
| new function while 0005 is rolled back (`ef-rolledback`) | 3 / 3 |
| legacy Community UI (0001–0004 + 0006, v47 function, incl. Leave Community) | 24 / 24 |
| `ui.js` real Chrome | **48 / 48** |
| `tests/auth/run-auth.js` | 53 / 55 — F and M fail only locally: the local auth server (GoTrue v2.197.0) answers `422 user_already_exists` for a signup with a registered email, production (same version) answers neutrally; F/M passed 12 / 12 on production on 2026-10-11 |
| `tests/sync/run.js "^smoke\|^offline"` / `live-verify.js` / `"RLS\|delete cloud backup"` | 12 / 12, 38 / 38, 7 / 7 |

Rollback matrix (function served locally; L = Leave Community, F = full deletion; F works in every case
with grants, by cascade):

| Schema | 0006 | Function | Result |
|---|---|---|---|
| 0001–0004 | no | production | **bug**: L answers ok, posts/reports/blocks/bio stay |
| 0001–0004 | yes | production | L and F correct |
| 0001–0004 | rolled back | production | **bug again** |
| 0001–0004 | yes | v47 | L and F correct |
| 0005 | yes | production (before the v47 function is deployed) | L removes posts/reports/blocks/bio/files; the user's follows/likes/shares stay until v47 is deployed; F correct |
| 0005 | rolled back | production | **bug** |
| 0005 | rolled back | v47 | L **and F** answer 500 `db_delete_failed` — no false success, but no one can delete their account |
| 0005 | re-applied | v47 | correct |
| 0005 rolled back | yes | v47 / production (= Release-1 rollback target) | correct |
| 0005 rolled back | rolled back | production | **bug** (= production today) |
