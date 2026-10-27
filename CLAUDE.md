# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GymQuest is a static, offline-first workout-tracker PWA (vanilla HTML/CSS/JS, no framework, no build
step). It is deployed by GitHub Pages straight from `main` / root to https://surotvsk.github.io/Gymquest/.
The files in the repo are exactly the files the browser runs. The optional online part (Community +
private account sync) uses Supabase through the vendored `vendor/supabase-js.js`. With empty values in
`community-config.js`, the app makes no network requests at all.

## Commands

There is no build, lint or unit-test runner. `package.json` only pins the `supabase` CLI (dev dependency).

```bash
node --check script.js                    # syntax check after edits (the whole app is one file)
python3 -m http.server 8124               # serve locally; http://localhost:8124/ is in the Auth redirect allow list
npx supabase start                        # local Supabase stack (Docker) for tests/social and local runs of the others
```

The test suites are Node scripts that drive real headless Chrome over the DevTools protocol (no test
framework). Each suite's README has the full environment setup:

```bash
node tests/sync/run.js                    # offline-first sync suite; first arg is a scenario regex filter:
node tests/sync/run.js "^smoke|^offline"  #   run a subset / a single scenario
node tests/sync/live-verify.js            # UI-driven end-to-end sync check with one account on two "devices"
node tests/auth/run-auth.js "H/I/J"       # account emails (signup confirm, resend, reset); optional filter
node tests/social/run.js                  # Community RLS/feature suite (local stack only; see tests/social/README.md for order)
```

Required environment (see `tests/sync/README.md`): `GQ_CREDS_DIR` (credential JSONs, kept **outside**
the repo), `GQ_TEST_IDS` (the only account ids the harness may touch), `GQ_PROTECTED_IDS`, and a short
`GQ_WORK` path. Optional: `GQ_BASE` runs against a deployed site, and `GQ_COMMUNITY_CONFIG` serves a
local `community-config.js` so the suite points at the local stack. The test server listens on port 8124.

**Test account safety:** `gqsync-c`, `gqsocial-a` and `gqsocial-b` are permanent production test
accounts. Never delete them, and never use them for full account deletion or failure-injection tests.
Those run only against disposable accounts on the local stack. Do not create new production accounts.
Results of verification runs are recorded in `tests/*/RESULTS.md` or the suite README.

## Releasing a change (cache versioning)

Every deploy needs **both** of these, or installed clients keep the old cached files:
1. Bump `CACHE_VERSION` in `sw.js` (e.g. `'v49'` → `'v50'`). Commit messages carry this number, e.g. "(v49)".
2. Bump the `?v=` query strings in `index.html` (`style.css`, `community-config.js`,
   `vendor/supabase-js.js`, `script.js`), and the matching entries in `sw.js` `PRECACHE`. The cache key
   is the full URL, including `?v=`.

New app-shell files the app needs offline must be added to `PRECACHE`. Demonstration media (`media/*`)
is **not** precached: `sw.js` keeps it in the long-lived `gymquest-media` cache on first view
(Range → 206 for Safari), so a changed media file needs a new filename (e.g. `-v2`). Media is
produced with `tools/media/process.sh`, and its tests are in `tests/media/`. Updates are user-driven:
the app shows an "update available" notice and never reloads during an active workout or open form.

## Architecture

- **`script.js` (~20k lines) is the whole app.** It is organised into sections marked
  `/* ---------- Name ---------- */` and `/* ===== … ===== */`. **Code comments are in Slovak.** Match
  that in surrounding code. Navigate with `grep -n '^/\* -----' script.js`. It is all globals (no
  modules); the tests call functions like `state`, `persistState()`, `selectedPlan`, `syncMetaRead()`
  directly in-page, so renaming globals can break `tests/`.
- **State:** a single `state` object persisted to `localStorage` under `STORAGE_KEY`, versioned, with
  forward migrations (`migrateV1toV2`, `migrateV2toV3`, `loadState`). Migrations must be additive:
  backfill new fields and never drop history, records or achievements. Derived values (XP, level,
  streaks, PRs, achievements) are recomputed from history, not accumulated. Media (progress photos,
  personal exercise media) live in IndexedDB.
- **i18n:** six languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar`, with `ar` right-to-left) in the
  `I18N` object, plus feature dictionaries like `SYNC_I18N` that are merged in at startup. Use
  `t(key, vars)`. Static HTML uses `data-i18n`, `data-i18n-title` and `data-i18n-aria`. `en` is the
  reference: `verifyI18n()` warns about keys missing in other languages. Every user-visible string
  needs all six. Built-in plan and exercise names are translated at display time. User-entered names
  and history snapshots are never rewritten.
- **Workspaces and sync** (section starting "Pracovné priestory"): each signed-in account has its own
  device workspace (its own localStorage state key, IndexedDB, and sync metadata, listed in a
  registry). Signed out is a separate guest workspace, and pre-workspace data is the `legacy`
  workspace. Switching accounts reloads the page. Sync is three-way (revision, last-synced content
  hash, local change counter) through a serial task queue. It never silently overwrites either side:
  divergence becomes a persistent conflict that the user resolves, with recovery copies of both sides.
  `DEVICE_SETTING_KEYS` / `DEVICE_STATE_KEYS` are never uploaded. `gqHook(name)` is a no-op in
  production. The test harness installs `window.__GQ_TEST__` to turn the hooks into deterministic
  barriers and failure injections.
- **Single tab:** Web Locks allow only one active tab per device. Other tabs show "Use here".
- **Supabase backend** (`supabase/`): migrations `0001`–`0016` (there is no `0007`; `0016` = phone tokens for the Android app's message alerts, it does not change the version) and rollbacks in
  `supabase/rollback/`; never put rollbacks in `migrations/`. Production has no CLI migration history
  and "auto-expose new tables" is off. Apply each new migration once, as one transaction, never with
  `supabase db push`. Grants are explicit (see `0002` and `0006`). The app detects which schema
  release is live (e.g. `community_social_version()`: 2 = 0008, 3 = 0009 leaderboard, 4 = 0010 push, 5 = 0011 replies/reactions/sharing/achievements, 6 = 0012 reminders, 7 = 0014 train together, 8 = 0015 chat Seen) and falls back, so the release order is app
  first, then migration, then the `delete-account` Edge Function. `supabase/README.md` holds the
  authoritative release and rollback steps.
- **`community-config.js`** holds only the public project URL, the publishable (anon) key and the
  public Web Push key (`vapidPublicKey`). Never put service-role keys, the VAPID private key, secrets
  or passwords in the repo or in test output.
- **Edge Functions** (`supabase/functions/`): `delete-account`, `push` (chat notifications, Web Push
  with VAPID; `webpush.ts` is dependency-free WebCrypto and is imported directly by Node tests) and
  `reminders` (called only by the `pg_cron` job through `pg_net`, JWT verification off, shared secret).
  Tests that roll back a migration use `L.rollbackFrom(n)` / `L.reapply()` (newest first, then in order).
- **Android app** (`android/`, `capacitor.config.json`, `tools/android/`, `docs/android/`, `tests/android/`): Capacitor wraps a
  copy of the web files (`www/`, built by `tools/android/build-www.sh`, gitignored). `script.js` has native branches behind
  `isNativeApp()` / `nativePlugin(name)` (no service worker, FCM alerts via `push_fcm_register`, on-phone reminders, Health
  Connect via the Kotlin plugin `GymHealth`, system bar colours via `GymBars`); in a browser they do nothing. The `push` Edge
  Function also sends FCM when the secret `FCM_SERVICE_ACCOUNT` is set. Keys and `google-services.json` are never committed.
- **`design-concepts/`** holds standalone redesign prototypes (shared `data.js`, `frame.css`, `icons.js`,
  and an `index.html` gallery). It is not part of the app, is not precached, and `sw.js` skips every request
  under `/design-concepts/` (and `privacy.html`, the privacy policy linked from Google Play and Health Connect;
  `tests/app/sw-pages.js` checks both).
  `design-concepts/app/` holds copies of the owner's chosen round 2–7 designs; the in-app Design previews were removed
  (2026-10-24), so nothing in the app links there any more. `app/r2/03-bento.html` (dark `app/r7/02-classic-dark.html`)
  stays as the reference the app's design follows.

- **Design (v78+): Bento, light and dark.** The look is a token layer at the end of `style.css`
  (`:root, html[data-theme="light"]` and `html[data-theme="dark"]`: `--bg`, `--surface*`, `--text*`,
  `--accent`, `--on-accent`, `--lime`, `--tile-*`, `--ink`, `--nav-*`, `--fig-*`), plus Bento shapes
  (tiles, pill buttons, floating tab bar, Today grid, coloured plan tiles). The mode comes from
  localStorage `gymquest_theme` (`light` / `dark` / absent = automatic) and is set on `<html data-theme>`
  by an inline script in `<head>` before the first paint; `applyTheme()` / `setThemePref()` in `script.js`
  switch it (Settings → Appearance). It is device-only: never put it into `state`. The font is
  `fonts/space-grotesk-*.woff2` (precached). Use tokens, not literal colours, in new CSS, and check new
  UI in both modes (`tests/app/bento-theme.js` has contrast and overflow checks). Today is a Bento tile grid
  (`#bento-grid`, filled by `renderBento()`; `data-go` tiles open existing features through `bentoGo()`; ids such as
  `week-count`, `btn-start-workout`, `btn-excuse`, `btn-choose-mode` are kept for tests). `tests/app/bento-home.js` checks every tile.
  The whole app follows the Bento reference (`design-concepts/app/r2/03-bento.html`; dark `r7/02-classic-dark.html`;
  CSS section "Bento podľa referencie" at the end of `style.css` uses its exact sizes). Menu: `dnes`, `trening`,
  `pokrok` (Stats tiles `renderStatsGrid()`, sub-views are full sheets via `.sheet-open`, default `pokrokView = 'stats'`),
  `spravy` (Messages: the Community screen in `communityMode = 'messages'`, opened by `openMessagesTab()`; the chats list is the page),
  `komunita` (tiles from `communityNavHtml()` on the feed, sub-views are sheets; `openOwnProfileSheet()` opens the own profile
  directly and Back returns via `communityReturnTab`) and `ty` (`renderTy()`). Train with a friend = `#btn-train-tile` in Workout. `kalendar` is a
  full sheet opened with `openCalendarPage()`. Workout has two states (`bentoTrainMode()`): plan picker, or the session
  tile + exercise tiles (set squares = `.set-btn.sq`, per-set `.set-pill` with `.set-reps`/`.set-weight`/`.set-fail`).
  Rest timer = `#modal-rest`. Presentation-only: no v77 element id was removed (`tests/app/bento-parity.js`), and
  `tests/sync/bento-upgrade.js` (local stack) proves update and rollback without any data change.

## Working conventions in this repo

- Prefer minimal, targeted fixes that preserve existing user data and behaviour over rewrites.
- A feature or fix counts as verified only when it works in a real browser (UI updates, survives a
  refresh, works in every language, no console errors). `node --check` and grep are not proof.
- Destructive actions need a confirmation dialog in the current language; full reset is two-step.
- Public-facing text (README, docs, commit messages) is in English. The README documents
  user-visible behaviour in detail, so update it when behaviour changes.
- Ask for approval before committing, pushing or deploying. Change things additively: never force-push,
  rewrite history, or create a second repo or Pages site.
