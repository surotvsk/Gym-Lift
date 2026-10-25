# GymQuest Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing GymQuest web app as a Google Play Android app (`surotvsk.gymapp`) with
native back button, theme-aware bars, share-sheet export, FCM message alerts, on-device reminders and
Health Connect heart rate + workout write, plus everything needed for the Play release.

**Architecture:** Capacitor 8 wraps a copy of the web files (`www/`, built by a script, gitignored)
in `android/`. `script.js` gains one native section: every native branch is guarded by
`isNativeApp()`, so the web/iPhone app is unchanged. Native features are reached through
`Capacitor.Plugins.*` (no bundler). Health Connect uses a small in-app Kotlin plugin `GymHealth`.
Message alerts reuse the `push` Edge Function, extended to FCM HTTP v1, with a new additive
migration `0016_push_fcm.sql`.

**Tech Stack:** Capacitor 8.5.x (`@capacitor/core|cli|android` 8.5.3, `app` 8.1.2, `splash-screen`
8.0.2, `status-bar` 8.0.4, `filesystem` 8.1.5, `share` 8.0.3, `push-notifications` 8.1.3,
`local-notifications` 8.3.1, `@capacitor/assets` 3.0.5 dev-only), Kotlin + `androidx.health.connect:connect-client`,
Firebase Cloud Messaging, Supabase (Postgres migration + Deno Edge Function), existing headless-Chrome
test harness (`tests/sync/lib.js`), Android emulator + `adb`.

**Spec:** `docs/superpowers/specs/2026-10-25-android-app-design.md`

## Global Constraints

- App ID `surotvsk.gymapp` (permanent); store/launcher name `GymQuest`.
- Web behaviour byte-for-byte unchanged when `isNativeApp()` is false; GitHub Pages deploy keeps serving repo root with no build step.
- `www/`, `android/app/google-services.json`, keystores and `*.jks` are never committed. Keystore lives in `~/Documents/gymquest-backup-2026-10-10/claude-code/android-keys/`.
- Bundle `media/*.mp4` + images only; no `media/*.webm`, `tests/`, `tools/`, `design-concepts/`, `docs/`, `supabase/`, `node_modules/` in `www/`. Release AAB ≈ 33 MB, hard ceiling 40 MB.
- Code comments in Slovak, matching `script.js`; every user-visible string in all six languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar`), `en` is the reference.
- State changes additive only (CLAUDE.md migrations rule). New history field: `entry.health` (optional).
- Health data never appears in Community posts, shares, chats, leaderboards or the share-card image.
- Notification payloads: sender username + chat id only, never message text (0010 rule).
- Build with JDK 21 (Android Studio's bundled JBR), not the system JDK 25. `targetSdk` = what Google Play requires for new apps at build time (≥ 35); `minSdk` = Capacitor 8 default.
- Commits, web deploys, production migrations, Edge Function deploys and Play uploads each need the owner's explicit approval; production writes follow `gymquest-production-write-protocol` (pre-check → exact change → impact/rollback → approval → post-check). Protected accounts (moderator, real users, `gqsync-c`, `gqsocial-a`, `gqsocial-b`) never used for destructive tests.
- Android work never blocks web releases: each Android release is built from committed `main`.

## Review Focus

1. **Undo / delete of a workout that was already written to Health Connect** — the session must be deleted from Health Connect too (by `clientRecordId = entry.id`). Test in Task 10.
2. **Back button during an active workout or with an unsaved form** — it closes the sheet, never exits the app or discards the workout silently; on Home with a running workout it does not exit. Test in Task 3.
3. **Permission denied** (notifications on Android 13+, Health Connect, exact alarms) — the toggle goes back to off with a translated note, no crash, no retry loop. Tests in Tasks 6, 9, 10.
4. **Account switch / sign-out on the phone** — FCM token unregistered for the old account, local reminders cancelled, no alerts for the previous account. Test in Task 9.
5. **Watch synced late or no watch at all** — no heart-rate data gives no `health` stats (never zeros), and "Refresh heart rate" later fills them in. Test in Task 10.

---

### Task 0: Toolchain (owner + builder)

**Files:** none in repo. Notes go to `docs/android/README.md` (created in Task 1).

- [ ] **Step 1 (owner):** Run `flatpak run com.google.AndroidStudio`, finish the setup wizard (Standard install, accept SDK licences). SDK lands in `~/Android/Sdk`.
- [ ] **Step 2:** In Android Studio's SDK Manager, install Platform for the Play-required API (≥ 35), Build-Tools, Platform-Tools, Emulator, and a system image "Google Play, x86_64" of the same API. Create an AVD `gq-pixel` (Pixel 8 profile).
- [ ] **Step 3: Verify**

Run: `~/Android/Sdk/platform-tools/adb version && ~/Android/Sdk/emulator/emulator -list-avds`
Expected: adb version printed; `gq-pixel` listed. Locate the bundled JBR (`find ~/.local/share/flatpak/app/com.google.AndroidStudio -maxdepth 6 -type d -name jbr`) and record its path as `JAVA_HOME` for Gradle in `docs/android/README.md`.

---

### Task 1: Capacitor project + `www/` build

**Files:**
- Modify: `package.json` (deps above, scripts `android:www`, `android:sync`, `android:open`), `.gitignore` (`www/`, `android/app/google-services.json`, `*.jks`, `*.keystore`, `android/**/build/`, `android/.gradle/`)
- Create: `capacitor.config.json`, `tools/android/build-www.sh`, `android/` (generated by `npx cap add android`), `docs/android/README.md`, `resources/icon.png` + `resources/splash.png` (from `icon-512.png`)
- Test: `tests/android/build-www.js`

**Interfaces:**
- Produces: `bash tools/android/build-www.sh` → fresh `www/`; `npm run android:sync` = build-www + `npx cap sync android`.
- `capacitor.config.json`: `appId: "surotvsk.gymapp"`, `appName: "GymQuest"`, `webDir: "www"`, `android.allowMixedContent: false`, plugin config for SplashScreen (`launchAutoHide: false`) and LocalNotifications (small icon `ic_stat_gq`).

- [ ] **Step 1: Write `tests/android/build-www.js`** — runs the script, then asserts: `www/index.html`, `www/script.js`, `www/style.css`, `www/community-config.js`, `www/vendor/supabase-js.js`, `www/fonts/`, all icons exist; every `media/*.mp4` and `media/*-poster.jpg` copied; zero `.webm`; no `tests|tools|design-concepts|docs|supabase|node_modules` dirs; `www/sw.js` absent; total size < 40 MB; files byte-identical to repo sources; repo-root `index.html`/`script.js` unchanged (sha before/after).
- [ ] **Step 2: Run it** — `node tests/android/build-www.js` → FAIL (script missing).
- [ ] **Step 3: Write `tools/android/build-www.sh`** (rsync with include list; `set -euo pipefail`; deletes old `www/` first). Install deps, `npx cap add android`, generate icons/splash with `npx @capacitor/assets generate --android`.
- [ ] **Step 4: Run test** → PASS. Then `npm run android:sync && (cd android && JAVA_HOME=<jbr> ./gradlew assembleDebug)` → `BUILD SUCCESSFUL`.
- [ ] **Step 5: Smoke on emulator** — `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, launch, screenshot (`adb exec-out screencap -p`): Today screen visible, no browser chrome.
- [ ] **Step 6: Commit** (with owner approval) — `git commit -m "Android: Capacitor project and www build"`.

---

### Task 2: Native mode core + fake-Capacitor test harness

**Files:**
- Modify: `script.js` — new section `/* ---------- Android appka (Capacitor) ---------- */` placed before `registerServiceWorker`; guard in `registerServiceWorker()`; update-banner/"Check for updates" render functions; video source choice where `EXERCISE_MEDIA` entries are turned into `<video>`.
- Create: `tests/android/lib-native.js`, `tests/android/native-core.js`

**Interfaces:**
- Produces in `script.js`: `isNativeApp(): boolean` (`!!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())`); `nativePlugin(name): object|null` (`Capacitor.Plugins[name]` or null); `nativeInit(): void` called once from app start after state load.
- Produces in tests: `installFakeCapacitor(page, opts)` — injects via `Page.addScriptToEvaluateOnNewDocument` a `window.Capacitor` with `isNativePlatform: () => true`, `getPlatform: () => 'android'` and recording fakes for App, StatusBar, SplashScreen, Filesystem, Share, PushNotifications, LocalNotifications, GymHealth; `window.__nativeCalls` = array of `{plugin, method, args}`; `opts` sets fake return values (e.g. permission `'denied'`, heart-rate samples). `fireNative(page, plugin, event, data)` triggers registered listeners.

- [ ] **Step 1: Write `tests/android/native-core.js`** (pattern of `tests/app/bento-home.js`, port 8124, empty community config). Cases: (a) without fake → `isNativeApp()===false`, SW registered, update setting visible (web unchanged); (b) with fake → `isNativeApp()===true`, `navigator.serviceWorker.getRegistrations()` empty, update banner and Settings "Check for updates" row hidden, exercise sheet `<video>` uses the `.mp4` URL and has no `.webm` source; `SplashScreen.hide` called once after first render; no console errors in either mode.
- [ ] **Step 2: Run** `node tests/android/native-core.js` → FAIL.
- [ ] **Step 3: Implement** the three functions and the guards.
- [ ] **Step 4: Run** → PASS; also `node tests/app/bento-update.js` and `node tests/media/*.js` still green.
- [ ] **Step 5: Commit** (approval).

---

### Task 3: Hardware back button

**Files:** Modify `script.js` (native section); Test `tests/android/native-back.js`

**Interfaces:**
- Produces: `NATIVE_BACK_CLOSE` — ordered array of `[modalId, closeButtonId]` covering all 26 `#modal-*` in `index.html` (e.g. `['modal-exercise','btn-exercise-close']`, `['modal-settings','btn-settings-close']`, `['modal-excuse','btn-excuse-done']`, `['modal-result','btn-result-close']` …), topmost first by CSS stacking; `nativeBack(): 'closed'|'view'|'home'|'exit'|'blocked'`.
- Order: (1) first visible modal in `NATIVE_BACK_CLOSE` → click its close button; (2) nested panels the Escape handler already knows (custom timer, preset manage, Community compose/chat/comments, calendar/Progress sub-views) → same calls the Escape handler makes; (3) tab ≠ `dnes` → `switchTab('dnes')`; (4) on `dnes`: if `getSession()` or `totalSetsDone() > 0` → `'blocked'` (show existing toast "workout running"), else `App.exitApp()`.
- Wired in `nativeInit()` via `App.addListener('backButton', nativeBack)`.

- [ ] **Step 1: Write test**: for every modal in the table, open it, fire `backButton`, assert it is hidden and app not exited; two stacked (library → exercise) close one at a time; Community chat → list → Home → exit (`App.exitApp` recorded once); active workout on Home → `'blocked'`, `exitApp` not called, session intact; settings open during workout → closes settings only; a test that every `#modal-*` id in `index.html` appears in `NATIVE_BACK_CLOSE` (no modal forgotten).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** (approval).

---

### Task 4: Status bar, navigation bar, splash follow theme

**Files:** Modify `script.js` (`applyTheme()` calls `nativeThemeBars(theme)`); Modify `android/app/src/main/res/values/styles.xml` (edge-to-edge, splash theme colours `#0c0d10` dark / light colour from `THEME_COLORS`); Test `tests/android/native-theme.js`

**Interfaces:** `nativeThemeBars(t: 'light'|'dark'): void` → `StatusBar.setStyle({style: t==='dark'?'DARK':'LIGHT'})`, `StatusBar.setBackgroundColor({color: THEME_COLORS[t]})`.

- [ ] **Step 1: Test**: light, dark and system (emulate `prefers-color-scheme` both ways) each record the matching `StatusBar` calls; switching theme chips re-calls; `env(safe-area-inset-*)` padding still applied (computed style of the top bar > 0 when emulated insets set).
- [ ] **Steps 2–5:** fail → implement → pass → emulator screenshot light + dark → commit (approval).

---

### Task 5: Export backup and share through Android

**Files:** Modify `script.js` — `exportData()` and the share-image path near `navigator.share` (≈ line 20265); Test `tests/android/native-share.js`

**Interfaces:** `nativeSaveAndShare(fileName: string, mime: string, data: string|Blob): Promise<boolean>` — writes to `Directory.Cache` via Filesystem (`base64` for Blob), then `Share.share({ files: [uri], title: 'GymQuest' })`; returns false on cancel/error with existing error toast.

- [ ] **Step 1: Test**: native `exportData()` records `Filesystem.writeFile` with name `gymquest-backup-<today>.json` whose decoded content equals the web export JSON (no `activeSession`/`activeActivity`), then `Share.share`; no `<a download>` created; share-card image path uses `nativeSaveAndShare` with `image/png`; user cancel (fake rejects) → no error toast; web mode still uses the `<a download>` path. Import (`<input type=file>`) unchanged — verify on emulator in Task 11.
- [ ] **Steps 2–5:** fail → implement → pass → commit (approval).

---

### Task 6: Reminders on the phone (Local Notifications)

**Files:** Modify `script.js` (reminders section ≈ line 15890; `remindersSave()`, `remindersLoad()`, sign-out/account-switch paths); Modify `android/app/src/main/AndroidManifest.xml` (`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` or inexact fallback, `RECEIVE_BOOT_COMPLETED`); Test `tests/android/native-reminders.js`

**Interfaces:**
- `nativeReminderSchedule(data: object|null): Array<{id:number, title:string, body:string, schedule:{on:{hour:number, minute:number, weekday?:number}, repeats:true, allowWhileIdle:true}}>` — pure, from the `reminders_get` shape (water `water_every` minutes from `water_from` to `water_to`, `meal_times[]`, `workout_days[]` 1–7 Mon–Sun at `workout_time`, each only if its switch is on). IDs: water 1000+i, meals 2000+i, workout 3000+weekday. Texts reuse existing reminder i18n keys used by the server function (move them into `I18N` if they exist only server-side; all 6 languages).
- `nativeRemindersApply(): Promise<void>` — `LocalNotifications.cancel` all 1000–3999, then `schedule` the list; called after load, save, on app start and on `App` `resume`; with `data === null` or signed out → only cancel.
- In native mode the reminders card no longer needs Web Push: it is available when signed in and `remindersAvailable()`; permission via `LocalNotifications.requestPermissions()`.

- [ ] **Step 1: Test**: water 60 min 08:00–20:00 → 13 notifications at whole hours (check boundary inclusion matches `reminders_due` in 0012, read the SQL); 3 meals; Mon/Wed/Fri 18:00 → weekdays 2,4,6 in Capacitor's 1=Sunday convention; all off → nothing scheduled; sign-out → cancel recorded, no schedule; permission `'denied'` → toggle back off, translated note shown, nothing scheduled; total ≤ 64.
- [ ] **Steps 2–5:** fail → implement → pass → commit (approval).

---

### Task 7: Migration 0016 — FCM tokens

**Files:** Create `supabase/migrations/0016_push_fcm.sql`, `supabase/rollback/0016_down.sql`; Modify `supabase/README.md`; Test `tests/social/push-fcm.js` (local stack only)

**Interfaces (SQL):**
- Guard: needs 0015 (`community_social_version() = 8`), refuses re-run. Sets `community_social_version() = 9`.
- Table `public.push_fcm_tokens(token text primary key check (char_length between 20 and 4096 and token ~ '^[A-Za-z0-9_:\-]+$'), user_id uuid not null references profiles(id) on delete cascade, lang text not null default 'en' check (lang in six), created_at, updated_at)`; RLS on, no policies, no grants.
- `push_fcm_register(p_token text, p_lang text default 'en') returns void` — security definer, same eligibility (`community_eligible()`) and ≤ 10 devices per member rule as `push_subscribe`; re-registering a token moves it to the caller.
- `push_fcm_unregister(p_token text) returns void` — deletes only the caller's row.
- `push_targets()` — `create or replace` with identical checks and grouping, result gains `"fcm": [{token, lang}]` next to the existing subscriptions key; execute stays service_role only.
- Grants: execute on register/unregister to `authenticated` only.

- [ ] **Step 1: Test** on local stack: register/unregister by owner; other user cannot unregister it; anon denied; 11th device → error; push_targets returns fcm tokens for recipient only, respects block/closed/duplicate/recent exactly like web subs; account deletion cascades tokens; rollback removes everything and `community_social_version()` back to 8; 0016 applied twice → refused.
- [ ] **Steps 2–5:** fail → write SQL → pass, plus existing `node tests/social/run.js` green → commit (approval). **Not applied to production here** (Task 13).

---

### Task 8: `push` Edge Function sends FCM

**Files:** Create `supabase/functions/push/fcm.ts`; Modify `supabase/functions/push/index.ts`; Test `tests/social/push-fcm-ef.js`

**Interfaces:**
- `fcm.ts`: `fcmAccessToken(sa: {client_email, private_key, project_id}): Promise<string>` (RS256 JWT via WebCrypto → `https://oauth2.googleapis.com/token`, cached until expiry); `sendFcm(token, data: {type:'chat', conv, from}, title, body, sa): Promise<number>` → POST `https://fcm.googleapis.com/v1/projects/<id>/messages:send` with `android.priority: 'high'`, `android.notification.tag = conv` (groups like Web Push `topic`), `data` for tap routing. 404/`UNREGISTERED` → delete token via service role.
- Secret: `FCM_SERVICE_ACCOUNT` (JSON string). Missing secret → FCM part skipped, Web Push unchanged. Test-only overrides `FCM_TOKEN_URL`/`FCM_SEND_URL` read only when `SUPABASE_URL` is a localhost URL.
- Title/body built with the same per-language strings the Web Push payload uses; never message text.

- [ ] **Step 1: Test** against local stack with a tiny local mock FCM server: message to a member with one web sub + one FCM token → both delivered, FCM body has username + chat id only; unregistered token → row deleted; no secret → only web push; follow-up within 20 s → no second send (same as web).
- [ ] **Steps 2–5:** fail → implement → pass → commit (approval). Deploy to production only in Task 13.

---

### Task 9: App registers for FCM, opens chat on tap

**Files:** Modify `script.js` (push section ≈ 15715: `pushSupported`, `pushEnable`, `pushDisable`, `pushRefresh`, push card); Create Android FCM setup per `@capacitor/push-notifications` docs (Gradle `google-services` plugin, applied only if `google-services.json` exists so CI/dev builds without it still compile); Test `tests/android/native-push.js`

**Interfaces:**
- Native branches: `pushSupported()` true when `nativePlugin('PushNotifications')`; `pushAvailable()` = `communityVersion >= 9`; `pushEnable()` → `requestPermissions()` → `register()` → `registration` event token → `rpc('push_fcm_register', {p_token, p_lang: lang})` → `pushDeviceWrite({uid, fcm: token})`; `pushDisable(sb)` → `rpc('push_fcm_unregister')` + `unregister()`; `pushRefresh` re-registers when the token changes or the account differs.
- `pushNotificationActionPerformed` with `data.type==='chat'` → open Messages tab and that conversation (existing open-chat function).
- Channel `messages` (high importance) created at init; reminders use channel `reminders`.

- [ ] **Step 1: Test** (fake plugins + local stack accounts from `seed-community.js`): enable → register RPC called with fake token; denied → toggle off + note, no RPC; sign-out → unregister RPC + `unregister()`; account switch → old token unregistered, new registered; tap event → chat with that id open; web mode still uses `pushManager` path.
- [ ] **Steps 2–5:** fail → implement → pass → commit (approval).

---

### Task 10: Health Connect — `GymHealth` plugin + workout heart rate

**Files:**
- Create: `android/app/src/main/java/surotvsk/gymapp/GymHealthPlugin.kt`, register in `MainActivity`; Manifest: Health Connect permissions `READ_HEART_RATE`, `READ_ACTIVE_CALORIES_BURNED`, `WRITE_EXERCISE`, the `ACTION_SHOW_PERMISSIONS_RATIONALE` activity-alias pointing at the privacy policy, `<queries>` for `com.google.android.apps.healthdata`.
- Modify: `script.js` (native section, `confirmFinish()` after `saveState()`, undo-workout and history-delete paths, `renderDayDetail()`, result modal fill, Settings), `index.html` (Settings row "Health Connect" + `#result-health` `<p>` in `modal-result`), `style.css`, i18n for keys `health.title`, `health.switch`, `health.note`, `health.denied`, `health.unavailable`, `health.hr`, `health.kcal`, `health.refresh`, `health.none` in six languages.
- Test: `tests/android/native-health.js`; manual/emulator check in Task 11.

**Interfaces:**
- Kotlin plugin `GymHealth` methods: `isAvailable() → {available: boolean}` (SDK status), `requestPermissions() → {granted: string[]}`, `readStats({start: ISO, end: ISO}) → {hrAvg?: number, hrMax?: number, hrCount: number, kcal?: number}` (aggregate `HeartRateRecord.BPM_AVG/BPM_MAX`, `ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL`), `writeWorkout({id, start, end, title}) → {ok}` (`ExerciseSessionRecord`, type `EXERCISE_TYPE_WEIGHTLIFTING`, `metadata.clientRecordId = id`, upsert by clientRecordId), `deleteWorkout({id}) → {ok}`.
- JS: setting `state.settings.healthConnect` (boolean, default false, additive); `entry.health = { start, end, hrAvg?, hrMax?, kcal?, readAt }` — `start/end` ISO, written at finish only when a session existed (`end = now`, `start = end − durationSeconds`); stats fields present only when Health Connect returned data (never zeros).
- `nativeHealthAfterFinish(entry): Promise<void>` — if enabled: `writeWorkout`, then `readStats` (immediately and once more on next app resume within 2 h), merges stats, `saveState()` (normal sync path).
- `nativeHealthRefresh(entryId): Promise<void>` — "Refresh heart rate" button in day detail for entries with `health` and no `hrAvg`, or `readAt` < 24 h after `end`.
- Undo / history delete of an entry with `health` → `deleteWorkout({id})`.
- Display: result modal and day detail show `♥ avg {avg} · max {max} bpm` and `{kcal} kcal` via `t('health.hr')` / `t('health.kcal')`; nothing on web.
- Community share card / posts / train-together payloads must not include `health` (strip in the share builders if they copy entries).

- [ ] **Step 1: Test** (fake GymHealth): disabled → no calls, no `health` field; enabled + samples → `writeWorkout` with entry id and window matching `durationSeconds`, `health.hrAvg/hrMax/kcal` stored and shown; no samples → `health` has window only, result shows nothing, day detail shows Refresh; refresh with samples later → filled; undo → `deleteWorkout(id)`; history delete → `deleteWorkout(id)`; permission denied → setting reverts to off, `health.denied` note; unavailable → setting row shows `health.unavailable`; share card JSON and Community post payload contain no `hrAvg`; state loads from an older backup without `health` fine; sync round-trip keeps `health` (run `node tests/sync/run.js "^smoke"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** JS + Kotlin. **Step 4: Run** → PASS; `./gradlew assembleDebug` succeeds.
- [ ] **Step 5: Commit** (approval).

---

### Task 11: Emulator smoke suite

**Files:** Create `tests/android/emulator-smoke.js`, `tests/android/README.md`

**Interfaces:** connects to the app WebView over CDP (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`), reusing `Browser`/page helpers from `tests/sync/lib.js` where they fit; debug build only (`WebView.setWebContentsDebuggingEnabled` true in debug, false in release).

- [ ] **Step 1: Write suite**: cold start ≤ 3 s to Today; all 5 tabs light/dark; airplane mode (`adb shell cmd connectivity airplane-mode enable`) → full workout logged, exercise video plays from bundle; real `adb shell input keyevent 4` back-button walk (sheet → tab → Home → exit); export opens share sheet (screenshot); photo pick via file chooser; local reminder fires (schedule one 1 min ahead in a test hook); Health Connect with test data inserted via `adb` (Health Connect toolbox or a debug-only seeding method in `GymHealth`); FCM alert between two local-stack accounts (one on emulator, sender via script) when `google-services.json` is present; app size from `adb shell pm path` + `du`.
- [ ] **Step 2: Run** `node tests/android/emulator-smoke.js` → all PASS; record results in `tests/android/README.md`.
- [ ] **Step 3:** Full web regression `bash claude-code/local-preview/regression.sh` (from the parent folder) → all green (web unchanged).
- [ ] **Step 4: Commit** (approval).

---

### Task 12: Release kit (signing, privacy page, store listing, owner checklist)

**Files:**
- Create: `privacy.html` (web page, all six languages or `en` + `sk` with language switch; covers on-device data, optional cloud account/sync, Community, push/FCM, Health Connect read/write and that health data is never shared or sold; account deletion steps), `docs/android/PLAY-RELEASE.md` (owner checklist), `docs/android/store-listing.md` (EN + SK short ≤ 80 chars and full ≤ 4000 chars descriptions, "what's new", guest-data note), `docs/android/data-safety.md` (answers per Play form), `docs/android/health-declaration.md` (Health Connect declaration answers: purpose per permission).
- Modify: `android/app/build.gradle` (`versionCode` from `tools/android/version.txt`, `versionName "1.0.0 (vNN)"` from `CACHE_VERSION`; release `signingConfig` read from `~/.gradle/gradle.properties` keys `GQ_UPLOAD_STORE_FILE|PASSWORD|KEY_ALIAS|KEY_PASSWORD`).
- Outside repo: upload keystore `claude-code/android-keys/gq-upload.jks` (`keytool -genkeypair -alias gq-upload -keyalg RSA -keysize 4096 -validity 10000`), password file next to it, backup instructions in `PLAY-RELEASE.md`.
- Test: `tests/android/release-check.js`

- [ ] **Step 1: Test**: `bundleRelease` produces `app-release.aab` ≤ 40 MB; `jarsigner -verify` OK with upload key; release manifest has `debuggable` false and WebView debugging off; versionName contains current `CACHE_VERSION`; `privacy.html` loads at `/privacy.html` locally with no console errors and contains the Health Connect section; no keystore/`google-services.json`/`www/` tracked by git (`git ls-files`).
- [ ] **Steps 2–4:** fail → implement → pass.
- [ ] **Step 5: Screenshots** for listing from the emulator (Today, Workout, Calendar, Progress, Messages; light + dark) into `docs/android/screenshots/` plus a 1024×500 feature graphic.
- [ ] **Step 6: Commit** (approval). `privacy.html` goes live only with a web deploy the owner approves (cache rules: not in `PRECACHE`, no version bump needed unless the app links to it).

---

### Task 13: Release (every step separately approved)

- [ ] **Step 1 (owner):** Play Console developer account; create app `GymQuest`, package `surotvsk.gymapp`; Firebase project → Android app `surotvsk.gymapp` → `google-services.json` to `android/app/` (local only), service-account JSON kept for Step 3.
- [ ] **Step 2:** Production 0015 (if still pending) then 0016 via protocol: pre-check (`community_social_version()`, table list), exact file sha256, impact/rollback (`0016_down.sql`), approval, apply with `supabase db query --linked -f`, post-check (version 9, grants, existing push_subscriptions count unchanged).
- [ ] **Step 3:** Owner sets secret `FCM_SERVICE_ACCOUNT`; deploy `push` (approval); post-check: web push still delivered between `gqsocial-a` → `gqsocial-b`; FCM to the emulator/phone with `gqsocial-b` signed in.
- [ ] **Step 4:** Rebuild `www/` from committed `main`, `bundleRelease`, run Task 11 + 12 checks on that exact build, upload AAB to **Closed testing**; owner fills listing, Data safety, content rating, Health Connect declaration, privacy URL, account-deletion URL (website).
- [ ] **Step 5 (owner):** 12+ testers opted in for 14 days; collect issues → fixes go through the normal tasks.
- [ ] **Step 6:** Apply for production access; promote to Production on approval.
