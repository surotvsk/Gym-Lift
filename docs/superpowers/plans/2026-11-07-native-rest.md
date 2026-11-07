# Android rest-timer implementation (Phase 6a)

Scope: approved improvement spec §6 only. No Google sign-in, feed, release or production changes.

- GymRest plugin: schedule absolute deadline, cancel, open exact-alarm settings. Persist device-only token and monotonic deadline; stale/duplicate callbacks cannot alert.
- AlarmManager exact/idle when permitted, inexact fallback otherwise. Show permission explanation once on explicit start and a late-alert warning if denied.
- Short countdown service limited to 170 seconds (margin under Android's three-minute limit), bounded wake lock. Longer timers use an alarm and countdown notification.
- Dedicated sound/silent channels; obey app sound setting and Android notification/DND settings. Custom local chime; notification sound duration is controlled by Android, not the web sound-length preference.
- Web bridge serializes start/pause/resume/add/restart/stop and restores native state after reload. Native completion owns the alert; browser completion does not cancel it or ring twice.
- Verification: native-rest.js (bridge, denied permission, async cancellation, browser fallback), existing rest-timer.js, Kotlin/debug APK build, emulator-rest.js (emulator-only; offline backend; synthetic state).

Release gate: exact alarms are requested with SCHEDULE_EXACT_ALARM, not USE_EXACT_ALARM. Before publishing, owner must review Play permission/foreground-service declarations and describe the user-started workout rest timer. No AAB/version bump or Play change in this task.

References: https://developer.android.com/develop/background-work/services/alarms and https://developer.android.com/develop/background-work/services/fgs/service-types#short-service

Implementation notes: explicit completion requests native delivery without cancelling the alarm;
only literal `true` preserves the alarm in stopTimer (DOM click events must cancel).
Long countdowns use a separate notification ID so destruction of an old short service cannot remove them.

## Verification — 2026-11-07

Read-only review identified notification denial suppressing the foreground gong. Fixed with
RED→GREEN coverage, including permission granted after scheduling. Native bridge 17/17;
browser rest-timer 66/66. Real emulator tests exposed Long timestamp parsing incompatibility
with Capacitor getDouble; corrected Number parsing. Emulator suite now 14/14 on both
API 35 and API 37. Debug APK compilation passed. No user data or production access.
Lavapipe resolves the host's SwiftShader crash; see docs/android/README.md for boot flags.
Physical wired/Bluetooth audio and phone DND behavior remain manual release checks.
