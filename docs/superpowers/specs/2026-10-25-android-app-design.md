# GymQuest Android app (Google Play) — design

Date: 2026-10-25 · Status: draft, awaiting owner approval

## Intent

The owner wants GymQuest in the Google Play Store as a real Android app: installed from the store,
own icon, full screen, works offline from the first launch, updates delivered as store releases.
iPhone users keep using the web app in Safari exactly as today. One codebase must keep serving
web, iPhone (web) and Android, so a fix lands everywhere.

## Goals

- An Android app built from the existing GymQuest files, opened and built in Android Studio
  (installed 2026-10-25 as Flatpak `com.google.AndroidStudio`, run with `flatpak run com.google.AndroidStudio`).
- Everything needed to publish on Google Play: signed release bundle (AAB), store listing texts,
  privacy policy page, Data safety answers, step-by-step instructions for the owner's Play Console
  and Firebase steps.
- Native feel: hardware back button closes the top sheet/dialog before leaving the app, splash
  screen, status/navigation bar colours follow light/dark theme, safe areas correct.
- All exercise videos bundled (MP4 only) so the app works fully offline right after install.
  Expected download size ≈ 33 MB (owner chose this over a 3 MB on-demand app).
- Notifications on day one:
  - chat message alerts via Firebase Cloud Messaging (FCM);
  - water / meal / workout reminders scheduled on the phone itself (local notifications).

- **Health Connect, in the first store release** (owner's decision):
  - after a workout ends, read heart rate for the workout's time window and show average / max
    BPM (and active calories when the watch recorded them) on the finished workout;
  - write each finished workout to Health Connect as an exercise session ("cross-platform
    workout", so it appears in Samsung Health, Fitbit, Google Fit etc.);
  - opt-in from Settings, Android permission prompt; with it off or denied nothing changes.
  Real-time BPM during a workout is **not** wanted (owner: people don't look at the phone
  mid-set), so no Bluetooth heart-rate connection.

## Non-goals

- No rewrite in Kotlin; no framework migration of `script.js`.
- No iOS app (iPhone stays web).
- No change to how the website is deployed. GitHub Pages keeps serving the repo root as is, no
  build step for the web.
- Code cleanup / dead-code removal is a **separate later project** (owner wants it; it saves
  < 1 MB, the size is in the videos).
- No deep links / App Links in the first release (see email links below).
- No live heart rate / Bluetooth sensors. No Apple Health (iPhone stays web; the heart-rate
  section is simply not shown on web).

## Anti-goals (would be a failure even if it "works")

- The web app or iPhone experience changes or breaks.
- Any user data lost, or production Supabase touched without the approval protocol
  (pre-check → exact change → impact/rollback → approval → post-check).
- Protected accounts (moderator, real users, `gqsync-c`, `gqsocial-a`, `gqsocial-b`) used for
  destructive tests.
- Signing key lost or committed to the repo (losing the upload key blocks future updates until
  Google resets it).
- The app feels like a web page: browser-style downloads that silently fail, back button exiting
  the app from an open sheet, "update available" web notices inside the app.

## Decided by the owner

- Distribution: Google Play Store.
- Updates: through the store (web files bundled in the app, not loaded from the website).
- Approach: same code packaged as an Android app (option 1), not a native rewrite.
- Videos: bundled.
- Notifications: from day one.
- Version policy: web and Android release independently. The owner keeps shipping design updates to
  the web as usual; each Android release is a snapshot of the committed web app (`main`) at the
  time it is built, so Android catches up only when the owner decides to publish a store update.
  The first Android build takes whatever `main` is when it is built (not tied to v79 or v80).
  The Android work must not block or slow web releases.
- App ID: neutral, not containing "gymquest", because the name may change later. Store name
  "GymQuest" for now (display name can change any time).

## How (builder's calls made during the design, marked as such)

- **Packaging: Capacitor** (my call). Android project lives in `android/` in the repo, Capacitor
  config in `capacitor.config.json`, npm deps in `package.json`. Plugins are reached through the
  global `Capacitor.Plugins.*` bridge, so `script.js` stays a plain global script with no bundler.
- **App ID: `surotvsk.gymapp`** (owner's choice, 2026-10-25; permanent after the first upload).
- **Build step only for Android** (my call): a script (e.g. `tools/android/build-www.sh`) copies the
  app into `www/` (gitignored): `index.html`, `script.js`, `style.css`, `community-config.js`
  (production values), `vendor/`, `fonts/`, icons, `media/*.mp4`, `media/*.jpg|png|webp`.
  Excluded: `media/*.webm`, `tests/`, `tools/`, `design-concepts/`, `docs/`, `supabase/`,
  `node_modules/`. Then `npx cap sync android`.
- **Native mode detection**: `window.Capacitor?.isNativePlatform?.()`. In native mode:
  - the service worker is not registered and the "update available" / "Check for updates" UI is
    hidden (updates come from the store);
  - video `<source>` choice prefers MP4 (WebM files are not present);
  - backup export writes the file with Filesystem and opens the Android share sheet (Share
    plugin), because `<a download>`/blob downloads do not work in the WebView;
  - `navigator.share` calls go through the Share plugin where the WebView lacks it;
  - Web Push UI is replaced by FCM registration; reminders use Local Notifications.
  Web behaviour must be byte-for-byte unchanged when not in native mode.
- **Back button** (`@capacitor/app` `backButton`): close the topmost open sheet/modal/sub-screen;
  on a main tab other than Home go to Home; on Home exit the app. Never during an active workout
  without the existing confirmation.
- **Splash + bars**: `@capacitor/splash-screen`, `@capacitor/status-bar`; colours from the current
  theme (light/dark/system), updated when the theme changes.
- **Message alerts (FCM)** — touches production, each step under the protocol:
  - Owner creates a free Firebase project, adds the Android app with the app ID, downloads
    `google-services.json` (kept out of git, copied into `android/app/` at build time) and a
    service-account key (stored only as a Supabase function secret).
  - New migration `0016_push_fcm.sql`: a table/function to register FCM tokens per member
    (same eligibility, device limit and language rules as `push_subscribe` in 0010), and
    `push_targets()` also returning FCM tokens; rollback file in `supabase/rollback/`.
  - `push` Edge Function sends FCM HTTP v1 messages to FCM tokens alongside Web Push; payload
    keeps the 0010 rule (sender username + chat id, never message text). Tapping the
    notification opens that chat.
  - Old clients unaffected (additive migration; `community_social_version` bump only if the app
    needs to detect it).
- **Reminders (local)**: the app reads the same reminder settings (`reminders_get`) and schedules
  them with `@capacitor/local-notifications`, rescheduling when settings change, on app start and
  after reboot. Server reminders keep going only to Web Push targets, so no duplicates. Android 13+
  notification permission and exact-alarm rules handled.
- **Email links** (my call): sign-up confirmation and password reset keep opening the website;
  the user then signs in inside the app. No Supabase redirect-list change needed.
- **Health data handling** (my call):
  - heart-rate stats are stored as an additive optional field on the workout history entry
    (state migration must be additive per CLAUDE.md), so they show in history and sync with the
    user's private backup like the rest of the workout;
  - never shown in Community posts, shares, chats or leaderboards;
  - read only the workout's time window; write only GymQuest's own sessions;
  - re-reading later is allowed when the watch synced late (e.g. a "refresh heart rate" action on
    a recent workout);
  - the privacy policy and Data safety form declare health data;
  - the Health Connect permission declaration in Play Console is part of the release checklist.
  Plugin choice (community Capacitor plugin vs small custom plugin) is left to the builder.
- **Guest data**: browser guest data does not move into the app (separate storage). Accounts with
  cloud sync see their data. Mentioned in the store description/FAQ.
- **Pricing** (my call): free, no ads, no in-app purchases — keeps Data safety and policy simple.
- **Store listing languages** (my call): English and Slovak first; others can be added later.
- **Signing**: upload keystore generated locally, stored **outside the repo** next to the other
  credentials (e.g. `~/Documents/gymquest-backup-2026-10-10/claude-code/android-keys/`), with a
  backup instruction for the owner; Play App Signing on.
- **Versioning**: `versionCode` increments every upload; `versionName` = `1.0.0 (v80)` style,
  tying the store build to `CACHE_VERSION`.
- **Target SDK**: whatever Google Play currently requires for new apps (API 35+), minSdk per
  Capacitor default.
- **Play policy items to prepare**:
  - privacy policy page (e.g. `privacy.html` on GitHub Pages — a web deploy, needs approval);
  - in-app and web account deletion: already exists — `delete-account` Edge Function mode `full`
    ("Delete my account and all cloud data") deletes cloud data and the auth user; the web URL
    for Play's deletion form is the website, which offers the same flow when signed in;
  - Data safety form answers;
  - content rating questionnaire;
  - store listing in English and Slovak: short and full description, feature graphic,
    phone screenshots taken from the emulator.
- **Owner-only steps** (prepared as a checklist, done by the owner with their Google login):
  - Play Console developer account ($25, identity verification);
  - Firebase project;
  - recruiting 12+ testers for the mandatory 14-day closed test (new personal accounts);
  - pressing publish.

## Testing (left to the builder in detail)

- Existing web regression must stay green (web behaviour unchanged).
- Android: emulator (Android Studio AVD) plus, if available, a real phone. The WebView can be
  driven over Chrome DevTools via `adb forward`, so the existing headless-Chrome harness style can
  be reused for a native smoke suite: launch, all tabs, light/dark, offline, a full workout, photo
  pick, backup export via share sheet, Health Connect read/write with emulator test data, back-button behaviour, local reminder firing, FCM message
  alert between two local-stack accounts.
- FCM / migration tested on the local Supabase stack before any production step.

## Left to the builder

Plugin versions, exact file layout of the Android build script, test harness design, how
native-mode branches are organised in `script.js` (follow existing Slovak comments and section
style), icon/adaptive-icon generation from the existing icons, splash artwork.

## Release order (each step separately approved)

1. Local: Capacitor project, native-mode code, local tests green; web unchanged.
2. Commit (approval) — web deploy only if web files changed (cache bump rules apply).
3. Owner: Play Console account + Firebase project.
4. Production: migration 0016 + `push` function deploy (protocol).
5. Signed AAB → Play closed testing track; 14 days with 12+ testers.
6. Production release on Play.
