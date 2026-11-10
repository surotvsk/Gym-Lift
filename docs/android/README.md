# GymQuest Android app (Capacitor)

The Android app is the same web app, copied into `www/` and wrapped by Capacitor in `android/`.
The website (GitHub Pages) does not use any of this and has no build step.

## Toolchain on this PC

- Android Studio: Flatpak `com.google.AndroidStudio` (`flatpak run com.google.AndroidStudio`, or `npm run android:open`).
- Android SDK: `~/Android/Sdk` (platform android-37, build-tools 36, Play system image API 37).
  `android/local.properties` (not committed) contains `sdk.dir=/home/Surotvsk/Android/Sdk`.
- JDK for Gradle: **JDK 21**, at `~/.local/share/jdk/jdk-21.0.13+9` (Eclipse Temurin).
  Android Studio's bundled JBR is JDK 25, which Gradle 8.14 cannot run on. In Android Studio set
  *Settings → Build → Gradle → Gradle JDK* to that folder.
- Emulator: AVD `Medium_Phone_API_37.0`. On this laptop the headless emulator binary
  (`-no-window`) crashes. Use `-qt-hide-window`, or start it from Android Studio's Device Manager.

## Build

```bash
npm install                      # once
npm run android:sync             # build www/ (tools/android/build-www.sh) + npx cap sync android
cd android && JAVA_HOME=~/.local/share/jdk/jdk-21.0.13+9 ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`www/` contains only what the phone needs: page, script, styles, vendor, fonts, icons, the MP4 demos
and images (no WebM, no service worker, no tests or tools), about 34 MB. `node tests/android/build-www.js`
checks it.

Icons and splash are generated from `icon-512.png` with `python3 tools/android/make-icons.py`
(Pillow). Re-run it after changing the icon.

## Never commit

`www/`, `android/app/google-services.json`, keystores (`*.jks`), `android/local.properties`, build outputs.
The upload keystore lives outside the repo in `claude-code/android-keys/`.

### Native rest timer (local implementation, release pending)

`GymRest` owns Android rest alerts independently of the WebView. Start, pause, resume,
+15 seconds, restart and Stop update the native alarm. Short rests (up to 170 seconds)
show a foreground countdown; longer rests use an alarm and a regular countdown notification.
The app explains Android's Alarms & reminders access once. Without it, long background
alerts may be delayed. Notification permission and channel settings must also allow alerts.
With the Rest sound switch on, the chime plays on the **media volume** (`USAGE_MEDIA`, like music and
Bluetooth audio): through connected wired/Bluetooth headphones, otherwise the speaker; the volume
buttons control it; it plays on vibrate/silent, and in Do Not Disturb it follows Android's "Media"
exception. Music playing at the same time ducks briefly (transient audio focus) instead of stopping. The notification channel `rest-alarm` only vibrates, so the
sound never plays twice. A sound timer counts as native even without notification permission,
which keeps the web gong silent. With the switch off, the `rest-silent` channel shows the alert
without sound or vibration. The web sound-length preference applies only to the browser gong.
Owner device check 2026-11-10 (Samsung A21s, v105): the old notification-volume chime was silent
in vibrate mode and too quiet. That is why Android versionCode 5 has the alarm stream and a louder chime (≈ −11 dBFS RMS, was −23).
Second owner check (vc6): the alarm stream played on the speaker even with headphones and could not be
turned down, so versionCode 7 uses the media stream.

Before a Play release, review the exact-alarm and foreground-service declarations for
this user-started workout rest timer. Device checks must cover screen off, battery saver,
permission denial, replacement/pause, and wired/Bluetooth sound routing.

Targeted checks: `GQ_TEST_PORT=8191 node tests/android/native-rest.js` and
`node tests/android/emulator-rest.js`. The latter **clears only emulator-5554's app data**,
refuses a physical device, and requires a debug APK whose bundled Community config has
empty URL/key values. Never run it against a personal phone. On 2026-11-07 the emulator
suite passed 14/14 on both Android 15 (API 35) and API 37, covering screen off, battery
saver, pause/replacement, and denied alarm/notification permissions. On 2026-11-10 it passed
17/17 on API 37, adding the alarm-stream chime and no-double-sound checks. Physical
wired/Bluetooth sound routing remains a manual check.

On this machine SwiftShader crashes during boot. Use an ephemeral AVD with
`-read-only -no-window -no-audio -no-snapshot -gpu lavapipe -camera-back none -camera-front none -port 5554`.
Both `GymQuest_Android15` and `Medium_Phone_API_37.0` boot successfully with these flags.

### Google sign-in (Phase 6b)

Android can sign into an existing account with Google and connect Google from Settings without
moving workout data between accounts. New accounts still use email registration to preserve the
server's age-confirmation rule. The controls stay unavailable until the owner configures the
public Web OAuth client ID and Supabase provider. See [Google setup and verification](GOOGLE-SIGN-IN.md).
