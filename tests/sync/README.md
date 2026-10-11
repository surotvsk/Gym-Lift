# Offline-first account sync — verification suite

Real Chrome processes with disposable profiles, driven over the DevTools protocol, against a local
copy of the app and the live Supabase project. Uses **only** the two disposable test accounts; every
scenario wipes their synthetic backup data first and the suite wipes it again at the end.

## Permanent production test accounts — NEVER DELETE

`gqsync-c`, `gqsocial-a` and `gqsocial-b` are permanent production test accounts for ongoing GymQuest
development. **Never delete them** and never use them for full account deletion ("Delete my account",
`delete-account` mode `full`) or for injected-failure tests. Full deletion and failure-injection tests
run only with disposable **local** accounts on the local Supabase stack (`tests/social/delete-account.js`).
Do not create another production account without separate approval. Their credentials live outside
the repository.

## Run

```powershell
$env:GQ_CREDS_DIR = 'C:\path\outside\the\repo\creds'   # cred-a.json, cred-b.json: { email, password, id }
$env:GQ_TEST_IDS  = '<uuid-a>,<uuid-b>'                # the ONLY account ids the harness may touch
$env:GQ_PROTECTED_IDS = '<uuid>,...'                   # accounts that must never be used (refused even if listed above)
$env:GQ_OLD_ROOT  = 'C:\path\to\export-of-previous-release'   # e.g. git archive 962ae02, for migration tests
$env:GQ_WORK      = "$env:TEMP\gqw"                    # SHORT path: Chrome's Cache Storage breaks past MAX_PATH
node tests/sync/run.js                                 # or a regex filter: node tests/sync/run.js "crash|D2"
$env:GQ_BASE = 'https://<deployed-site>/'              # optional: run against a deployed frontend
```

With `GQ_BASE` set, the scenarios run against that site; migration and update-path scenarios
(which swap builds on the local server) are skipped.

Credentials are never stored in this folder, in git or in the output. The cloud observer signs in
with the test accounts' own credentials (RLS-scoped) — no service key is used. The harness refuses any
account id that is not one of the two disposable test accounts.

## How determinism is achieved

- `window.__GQ_TEST__` (installed before any app script) turns the app's `gqHook(name)` calls into
  **barriers**: a test arms a hook, waits until the app reaches it, acts (sign out, edit, kill the
  browser), then releases it. Barriers and failures can be armed for the next page load, so they
  survive the app's own workspace-switch reloads.
- Failures are injected the same way (`fail(hook)`), and `localStorage` quota errors are simulated per
  key. No test depends on a sleep for ordering; the only fixed wait is in the crash test, where the
  barrier holds the restore while Chrome commits earlier `localStorage` writes to disk.
- **Full restarts** are real: the browser process is closed (graceful) or killed (`taskkill /F`) and
  relaunched with the same profile.

## Coverage (see `run.js`)

| Scenario | What it proves |
|---|---|
| smoke | clean start, no exceptions, no missing translations, separate local/cloud status lines |
| D1 + auto-load | a device that completed setup and reloaded still loads every section + media automatically; restart afterwards neither rolls back nor re-downloads |
| D2 | a failed media upload stays unsynced across a full restart, is never replaced by newer account data, and the published backup never references a missing object |
| D3 | pending edits survive a restart and upload automatically without a false conflict; an unchanged restart downloads nothing |
| offline | reopen offline after online preparation, save a workout, survive a restart, reconnect and sync |
| D4 | conflict dismissal persists (also across restart) and blocks uploads and pulls; both sides are kept as recovery copies; a copy can be restored |
| D5 | sign-out shows a guest workspace; account B never sees or uploads A's data; A's pending edit survives switching |
| safety #2a | sign-out while an upload is in flight (before the RPC and during a media upload) waits, then publishes nothing |
| safety #2b | sign-out during an in-flight restore (download, after the media commit) leaves the guest and B workspaces clean and A consistent — progress photos and personal media |
| edits during sync | edits made during an upload stay pending; edits during a download abort and roll back the download, then become an explicit conflict |
| crash | process kill after the media commit → rollback; kill right after the state write → fully applied or fully rolled back |
| no false conflict | device-only saves (running workout) do not block pulling account changes |
| D10 | a burst of focus/online/visibility events during the first load runs exactly one load |
| empty-data guard | Reset data re-loads the account; emptying the device asks instead of uploading |
| local storage failure | a failed local save is shown; after restart the stale copy is refreshed from the account |
| two tabs ×3 | a second tab is blocked and never starts; "Use here" waits for the active tab's in-flight upload / restore, then hands over without losing or overwriting pending edits; sign-out in the active tab while syncing never writes across accounts |
| session expiry ×2 | with an invalid/expired session local saving continues, pending edits survive a restart and upload after re-authentication; signing in as another account never receives them |
| delete cloud backup | removes row, versions and media; device data kept; sync turned off |
| RLS/privacy | account B cannot read A's backup row or media |
| release update path | an installed v42 app updates through its service worker and keeps all data |
| migration M1–M4 | validated owner links automatically; unknown owner asks (keep separate / link); storage failures during migration leave the original data intact; the v42 restore snapshot moves to IndexedDB only after a verified copy |
