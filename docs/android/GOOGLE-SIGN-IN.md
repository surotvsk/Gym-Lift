# Google sign-in — Phase 6b

Android uses Credential Manager with an explicit Google account chooser. The app sends the
Google ID token and raw nonce to Supabase. Google receives the SHA-256 hash of that nonce.
There is no automatic sign-in, no token logging and no additional token storage in app code.
The existing Supabase session store and per-account workspaces remain authoritative.

Settings → Account sync → Connect Google links the identity to the currently signed-in user
using `auth.linkIdentity({ provider: 'google', token, nonce })`. It never calls sign-in to link.
The account ID and workspace must remain unchanged. Cancellation does not alter workout data,
session, or workspace. Pending sync finishes before any auth mutation. Sign-out clears the
Credential Manager session state without revoking the user's Google account.

## Existing account and age confirmation

Migration 0005 requires `age_16_confirmed` during account creation, and a Google ID token cannot
carry it. Since v109 + migration 0020 a NEW user can create the account directly with Google:
the sign-in card has the same "I am 16 or older" checkbox as e-mail sign-up. When it is ticked,
the app reads the e-mail from the ID token payload, calls `age_ticket_create(p_email)` (anon;
stores only `sha256(lower(trim(email)))`, valid 10 minutes, global cap 30 per minute) and then
`signInWithIdToken`. `handle_new_user()` accepts a Google sign-up only when it finds and deletes
(single use) that ticket; the consent row gets source `google_signup`. Without a ticket the
server still raises `age_confirmation_required`, so an unticked new user sees "To create an
account with Google, first tick I am 16 or older." Existing users sign in with Google without
the tick. The app uses the ticket only when `community_social_version()` is 12 or more; on an
older server it keeps the previous behaviour (register by e-mail, then Connect Google in Settings).
Settings → Connect Google (linking) is unchanged. Existing accounts with the same verified email
use Supabase's identity-linking rules; for a different email, sign in with the existing password
and use Connect Google. The app never merges workout records. Optional web OAuth is not
implemented; web users retain the existing email/password flow.

## Owner setup (outside this code change)

1. In Google Cloud project `gymquest-5bf0a`, configure an External consent screen for Gym-Lift,
   with owner support/contact email, the Gym-Lift home/privacy URLs and only `openid`, `email`,
   `profile`. Configure test users/publishing as appropriate for your consent-screen status.
2. Create a Web OAuth client with authorized redirect URI
   `https://mbjbtprkwvoqgqphgudq.supabase.co/auth/v1/callback`.
3. Register Android OAuth clients for package `surotvsk.gymapp`, covering the Play app-signing,
   upload, and debug certificate SHA-1 values. Obtain the actual hashes from Play/your keys;
   do not paste private keys or signing passwords into chat or git.
4. Configure Supabase Auth → Google with the Web client ID and secret, and enable manual
   identity linking for Settings → Connect Google. Keep nonce validation enabled.
5. Put only the PUBLIC Web client ID in `community-config.js` as `googleWebClientId`.
   Never place its secret, an ID token, or a refresh token in the file. Blank configuration
   leaves the Android controls disabled with an email/password alternative.
6. Before releasing changed frontend configuration, bump both service-worker cache version
   and matching asset query versions, and rebuild Android assets/APK/AAB as appropriate.

Supabase/Google settings are production changes: record the current settings, exact proposed
changes and their impact/rollback, obtain owner approval, let the owner apply them, then verify
with designated test accounts. No production settings were inspected or changed by this task.
Rollback: disable the Google provider/manual linking as needed and clear the public client ID;
retain password sign-in and all existing account/workout data. Do not delete identities or users.

## Verification and limits

At the end of implementation, run `tests/android/native-google.js`, `tests/android/google-age.js`, `tests/social/google-age.js` (the local GoTrue has Google disabled, so it tests the trigger through direct `auth.users` inserts with `provider: google`), the local workspace check
`tests/android/google-workspace.js` with the existing synthetic local credentials, and the
Android Kotlin/debug build. Mocks verify app boundaries, not Google provider correctness.
Live Google acceptance still requires the owner's client/provider setup and a test Google account:
existing verified account, alternate-email linking, already-owned identity refusal, chooser
cancel, offline/error recovery, logout/relogin, and unchanged workspace/history.

References:
- https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/reference/javascript/auth-linkidentity
