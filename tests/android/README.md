# GymQuest Android tests

| Test | Needs | Covers |
|---|---|---|
| `bash tests/android/run-all.sh` | Chrome only | everything below marked "headless" |
| `build-www.js` | — | what goes into the app (`www/`): app files, MP4 + images, no WebM / service worker / tests; < 40 MB; web files untouched |
| `native-core.js` (headless) | Chrome | native mode on/off, no service worker or update UI in the app, MP4-only video, splash hidden |
| `native-back.js` (headless) | Chrome | hardware Back for every sheet (table complete), stacked sheets, sub-views, tabs, Today → background, running workout kept |
| `native-theme.js` (headless) | Chrome | status bar follows light / dark / system, live system switch |
| `native-share.js` (headless) | Chrome | export, auto backup and progress photo go through Filesystem + share sheet |
| `native-reminders.js` (headless) | Chrome | on-phone reminder schedule (water / meals / workout days), apply / cancel / permission |
| `native-push.js` (headless) | Chrome | FCM registration, token refresh, sign-out, tap → chat, server without 0016 |
| `native-health.js` (headless) | Chrome | Health Connect switch, write + read on finish, refresh, retry, undo / delete, never in Community |
| `release-check.js` | JDK 21, SDK, upload key | signed release AAB ≤ 40 MB, not debuggable, version, privacy page, nothing secret in git |
| `emulator-smoke.js` | one phone / emulator in `adb devices` + debug APK | real start-up, tabs, airplane-mode workout + video, real Back key, share sheet, a reminder firing, Health Connect, size, screenshots |
| `../social/push-fcm.js` | local Supabase stack | migration 0016 (FCM tokens), rollback, leaves the stack as found |
| `../social/push-fcm-ef.js` | — | FCM sender of the `push` function against a mock Google server |

The "headless" tests run the real app in headless Chrome with a fake `window.Capacitor`
(`lib-native.js`): every plugin call is recorded, return values are set per test, and native events
(Back button, FCM token, notification tap, resume) are fired by the test.

## Results

- 2026-10-25, branch `worktree-android-app` (after the final-review fixes): run-all 8 suites green
  (build-www 29, back 47, core 14, health 32, push 26, reminders 23, share 17, theme 9); release-check 18/18 (AAB 37.8 MB);
  push-fcm 34/34; push-fcm-ef 25/25; web push 52/52 and reminders 41/41 with 0016 applied.
- `emulator-smoke.js` on a real phone, Samsung Galaxy A21s (SM-A217F, Android 12), debug build:
  **15/15, twice in a row**. Cold start 2.9 s (Android to first frame) + 0.6 s (page) on this low-end
  phone; installed APK 40.5 MB (debug); offline workout + bundled video OK; real Back key OK;
  share sheet OK; a reminder fires; Health Connect not installed on that phone (reported correctly).
  Found and fixed on the device: reminders scheduled as "exact" made the reminders plugin open
  Settings → Alarms & reminders on Android 12+ every time it scheduled them (now `isExactNotification: false`).
  The emulator still crashes on this laptop (headless qemu segfaults), so use a phone over USB debugging.
- Still to check on a phone: Health Connect with a watch (install Health Connect first); a chat
  alert while the app is open; status bar on Android 15+ (A21s is Android 12: bars correct in both themes);
  system navigation bar stays black in light mode (cosmetic).

## Device checklist (with emulator-smoke.js, from the final review)

- Status bar: app theme dark on a phone in light mode (and the reverse) — icons readable? On Android 15+ `StatusBar.setBackgroundColor` has no effect (edge-to-edge); if unreadable, set the window background per theme.
- A chat message arriving while the app is open on Today: does a system notification appear? If not, set `PushNotifications.presentationOptions` in `capacitor.config.json`.
- Health Connect on a real phone: permission screen, heart rate after a workout with a watch, the GymQuest session visible in Health Connect, undo removes it.
- Reminders: one fires at its time with the phone locked (inexact alarm, may be a few minutes late).
