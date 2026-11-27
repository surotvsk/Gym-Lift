# Wear OS companion: Play release log

## 2026-11-27: first Wear OS upload

- Bundle: `GymLift-WearOS-1.0.0-v124-vc1000022.aab` (package `surotvsk.gymapp`, versionName `1.0.0 (v124)`, versionCode `1000022`, minSdk 30).
- Wear OS bundles use `versionCode = 1000000 + tools/android/version.txt` (see `android/wear/build.gradle`), so they never collide with the phone bundle's code (22 for v124).
- Uploaded through Play Console with the form-factor switch set to **Wear OS only**. Wear has its own tracks, separate from the phone tracks.

### Tracks

| Track | State |
| --- | --- |
| Wear OS internal testing | Release `1000022 (1.0.0 (v124))` published, "Available to internal testers". No testers assigned yet. |
| Wear OS closed testing "Alpha" | Created. 178 countries (same as phone Alpha). Testers: Google Groups `gymquest-testers@googlegroups.com` and `gymlift-closed-testers@googlegroups.com` (same as phone Alpha). Feedback address: owner email. Release `1000022` saved but still waiting to be sent for review (shown as "not available in Google Play"). |
| Production | Not used. |

### Gotchas

- Re-uploading the same `.aab` to a second Wear track fails with "version code 1000022 already used". Use **Add from library** instead.
- Play warns that no deobfuscation (mapping) file is attached. This is non-blocking.
- The phone Alpha release (versionCode 22, v124) was already in review when the Wear Alpha release was saved. Check Publishing overview for the Wear change.

### How to try it

The watch app is the companion of the phone app and is installed from Google Play on a Wear OS watch (or the Wear OS emulator), by an account that is a tester on the track. Open the track's opt-in link on the phone, accept, then install Gym-Lift on the watch from Play on the watch or from the phone's Play listing ("Install on more devices").
