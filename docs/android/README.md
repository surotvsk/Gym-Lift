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
