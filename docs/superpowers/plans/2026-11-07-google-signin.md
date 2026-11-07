# Phase 6b — native Google sign-in

Scope: Credential Manager sign-in and Settings → Connect Google, six languages, account/workspace safety.
Phase 6a is already pushed as v103. No web OAuth (optional in spec), migration, production setup, release or Play upload.
Owner instruction: finish implementation first; run focused tests together at the end.

## Decisions
- Existing `handle_new_user` requires explicit age metadata, which ID-token sign-in cannot supply.
  Preserve this server safeguard: new users register/verify email first. Google sign-in/linking serves existing accounts;
  failures explain the email-first flow. No silent duplicate creation or relaxing age consent.
- Vendored Supabase supports `linkIdentity({ provider, token, nonce })`. Use it for Settings linking,
  never signInWithIdToken for a signed-in account. Linking must retain the exact user ID/workspace.
- Native plugin generates a random nonce; Google receives its SHA-256 hex, Supabase receives the raw nonce.
  Tokens/nonces stay transient, never logged or persisted by app code.
- Credential chooser runs before sync quiescence; cancellation changes no app state. Auth mutations quiesce sync,
  recheck the session/workspace, and resume in finally. Sign-in uses existing wsBindSession(true).
- Public web client ID comes from community-config.js; empty by default. No secret or client ID invented.

## Implementation
1. GymGoogle Kotlin plugin, pinned Credential Manager/Google ID dependencies, explicit chooser and sanitized errors.
2. Native-only sign-in button and Settings linking UI; six-language messages; busy/error/cancel guards.
3. External Google Cloud/Supabase setup guide, rollback and local test instructions.
4. At end: targeted browser mocks + real local account/workspace tests, Kotlin build, native cancellation smoke where possible.

Live Google verification requires owner-configured OAuth clients and provider. Local mocks cannot prove Google or
production provider configuration. No production inspection/changes are authorized by this implementation task.

Implementation is ready for end-of-phase verification. New tests cover chooser cancellation,
nonce/token forwarding, competing auth operations, changed sessions, safe linking, error
sanitization, six languages, browser unchanged, and real local A/B workspace isolation.

## End-of-phase verification (2026-11-07)
- Native Google mock suite: 23 passed, 0 failed.
- Real local Supabase workspace suite: 9 passed, 0 failed (Google exchange mocked; synthetic accounts only).
- Native core regression: 14 passed, 0 failed.
- JavaScript syntax and git whitespace checks passed; Kotlin compilation and debug packaging passed.
- Live Google chooser/provider acceptance remains pending owner OAuth setup; no production changes, commit or push.
