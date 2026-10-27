# GymQuest on Google Play — release checklist

Steps marked **(you)** need the owner's Google login or decision. Everything else is prepared in this
repo. Each production change (database, Edge Function, website) still needs a separate approval.

## 0. Before anything: back up the upload key

The upload key signs every Android release. It lives **outside the repo**:

```
~/Documents/gymquest-backup-2026-10-10/claude-code/android-keys/gq-upload.jks
~/Documents/gymquest-backup-2026-10-10/claude-code/android-keys/signing.properties   (passwords)
```

- **(you)** Copy both files to a safe second place (password manager attachment or an encrypted USB
  stick). Never commit them, never send them by e-mail or chat.
- With Play App Signing (the default) Google keeps the real app signing key. If this upload key is
  lost, Google can reset it, but that takes days. With a backup nothing is lost.

## 1. Accounts (you)

1. **Google Play Console**: <https://play.google.com/console> → create a developer account
   (personal), pay the one-time US$25 fee, finish identity verification. Your developer name and
   a contact e-mail are shown publicly on the store listing.
2. **Firebase** (free): <https://console.firebase.google.com> → *Add project* (e.g. "GymQuest") →
   *Add app* → Android → package name **`surotvsk.gymapp`** → download **`google-services.json`**.
   - Put it at `android/app/google-services.json` (it is git-ignored). Without it the app builds,
     but message alerts are off.
   - Project settings → Service accounts → *Generate new private key* → keep that JSON file next to
     the upload key (`claude-code/android-keys/`), never in the repo. It becomes the Supabase
     function secret `FCM_SERVICE_ACCOUNT` in step 3.
3. **Contact e-mail**: martinsuriak2005@gmail.com (owner's choice, 2026-10-27). It is in `privacy.html`
   (both languages); use the same address in the Play Console.

## 2. Website (needs approval)

`privacy.html` must be live before the store listing can point to it:
<https://surotvsk.github.io/Gymquest/privacy.html>. It is a separate page, not part of the app
cache, so no `CACHE_VERSION` bump is needed for it alone.

## 3. Production backend (needs approval, production write protocol)

Order: 0015 (if still pending) → 0016 → secret → `push` deploy. For each: pre-check → exact
change → impact / rollback → approval → post-check (see `supabase/README.md`, section 0016).

1. `supabase/migrations/0016_push_fcm.sql` (rollback: `supabase/rollback/0016_down.sql`).
2. `supabase secrets set FCM_SERVICE_ACCOUNT="$(cat <service-account>.json)"`.
3. `supabase functions deploy push` (code: `supabase/functions/push/index.ts` + `fcm.ts`).
4. Post-check: web push still reaches `gqsocial-b` from `gqsocial-a`; an Android phone signed in as
   `gqsocial-b` with notifications on gets the alert.

## 4. Build the release

```bash
npm install
npm run android:sync                       # www/ from the committed web app + cap sync
cd android && JAVA_HOME=~/.local/share/jdk/jdk-21.0.13+9 ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
GQ_SKIP_BUILD=1 node tests/android/release-check.js
```

- Before every upload, raise `tools/android/version.txt` by 1 (Play refuses a repeated versionCode).
- `versionName` is generated as `1.0.0 (vNN)` from `CACHE_VERSION` in `sw.js`, so you can always
  see which web version the store build contains.
- Build only from committed `main` (web and Android release independently).

## 5. Play Console: create the app (you)

1. *Create app* → name **GymQuest**, default language English (en-US), App, Free.
2. **Store listing**: texts from `docs/android/store-listing.md` (English + Slovak), icon 512×512
   (`icon-512.png`), feature graphic 1024×500 and phone screenshots (from `docs/android/screenshots/`
   once taken on a phone or emulator).
3. **App content**:
   - Privacy policy URL: `https://surotvsk.github.io/Gymquest/privacy.html`
   - Ads: **No ads**
   - App access: all features work without an account; Community needs a free account (give
     reviewers a test account if asked — do NOT use the permanent test accounts' passwords in public
     fields; create a separate review account only with approval).
   - Content rating questionnaire: fitness app; user-generated content and chat (moderated, 16+);
     no violence, no gambling.
   - Target audience: 16+ (Community is 16+).
   - **Data safety**: answers in `docs/android/data-safety.md`.
   - **Health apps declaration** + **Health Connect permissions**: answers in
     `docs/android/health-declaration.md`.
   - Account deletion: URL `https://surotvsk.github.io/Gymquest/privacy.html#delete` → points to
     the deletion steps; in-app path Settings → Community → Delete my community account.
4. **Testing → Closed testing**: create a track, upload `app-release.aab`, add at least
   **12 testers** (their Google account e-mails or a Google Group). New personal developer accounts
   must run this closed test with ≥ 12 opted-in testers for **14 days** before applying for production.
5. After 14 days: *Apply for production access* → answer the questions → when approved, promote the
   build to **Production**.

## 6. Every later update

1. Web changes are released to the website as usual.
2. When you want the Android app to catch up: commit, `version.txt` +1, build, release check,
   upload to Closed testing (or Production), roll out.
