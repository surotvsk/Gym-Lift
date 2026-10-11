# Sync verification results

Release candidate: working tree on top of `962ae02`, `CACHE_VERSION v43`, assets `?v=47` (not committed or deployed at the time of the run).
Environment: Windows 11, Google Chrome 154.0.8037.95 (headless, disposable profiles), live Supabase project, disposable test accounts only.
Run: 2026-10-10T00:16:15.924Z — **137 passed, 0 failed, 0 scenario errors**.

## smoke: new build loads cleanly in a fresh profile

- PASS — guest slot active on fresh profile
- PASS — registry created
- PASS — no page exceptions
- PASS — no missing-translation warnings
- PASS — local-save line visible and separate from cloud line
- PASS — sync chip hidden while signed out

## D1+auto-load: fresh device with setup+reload before sign-in loads every section and media automatically

- PASS — device 1 uploaded (rev >= 1, 2 workouts, 2 media)
- PASS — every manifest reference exists in storage
- PASS — device 1 status synced; local and cloud lines differ
- PASS — fresh device now has a goal snapshot (the D1 trigger)
- PASS — no link prompt / no conflict for an untouched device
- PASS — account workspace created and active
- PASS — calendar/workouts loaded
- PASS — custom plan + exercise loaded
- PASS — motivation (achievements) of device 1 all present
- PASS — measurements loaded
- PASS — progress + personal media loaded byte-identical
- PASS — device 2 status synced, not dirty
- PASS — loading did not upload (cloud revision unchanged)
- PASS — D8: no full-state copies in localStorage
- PASS — no page exceptions
- PASS — restart after a load: journal settled, nothing rolled back or re-downloaded

## D2: failed media upload stays protected (restart, newer cloud) and never publishes a dangling reference

- PASS — failed item recorded as unsynced (dirty)
- PASS — status not "synced"
- PASS — published row does not reference the failed item
- PASS — all published references exist
- PASS — another device can still load the account
- PASS — after full restart: still unsynced + media intact
- PASS — device 2 published a newer revision
- PASS — newer cloud did NOT overwrite unsynced media: conflict instead
- PASS — cloud untouched while conflicted
- PASS — keep-device uploaded p2 and cleared conflict
- PASS — cloud-side copy saved before overwriting
- PASS — all references exist after recovery

## D3: restart with pending edits auto-syncs; unchanged restart downloads nothing

- PASS — offline edit saved locally and pending
- PASS — pending edit survived full restart
- PASS — reconnect uploaded automatically without a conflict
- PASS — exactly one new revision
- PASS — unchanged restart: no download/apply
- PASS — unchanged restart: no upload

## offline: reopen offline after online preparation, save a workout, survive restart, reconnect

- PASS — service worker installed and controlling
- PASS — app opened offline from cache with account data
- PASS — workout saved locally while offline; local line says saved
- PASS — cloud line reports offline pending (not synced)
- PASS — survived full restart offline
- PASS — reconnected and synced

## D4: conflict dismissal persists and blocks uploads/pulls; both sides recoverable

- PASS — divergent edits produce a conflict dialog
- PASS — after dismissal: no upload
- PASS — after dismissal: no pull, local edits kept
- PASS — conflict persists across full restart
- PASS — cloud still untouched after restart
- PASS — keep-account applied account data
- PASS — copies of BOTH sides saved
- PASS — device copy restored and synced to account

## D5: account isolation on sign-out/switch; pending edits kept per account

- PASS — A has a pending (unsynced) edit
- PASS — after sign-out: guest workspace, none of A data visible
- PASS — B workspace is empty (A data never shown as B)
- PASS — B cloud untouched (no upload of empty/A data)
- PASS — B cloud contains only B data
- PASS — A workspace restored with its pending edit
- PASS — A pending edit synced after switching back
- PASS — B cloud still has no A data

## safety #2a: account switch while an upload is in flight (before RPC, during media upload)

- PASS — upload:beforeRpc: sign-out waits for the in-flight task (session unchanged, queue stopping)
- PASS — upload:beforeRpc: now in guest workspace without A data
- PASS — upload:beforeRpc: aborted upload published nothing
- PASS — upload:beforeRpc: B cloud untouched
- PASS — upload:beforeRpc: A pending edit preserved in A workspace
- PASS — upload:object: sign-out waits for the in-flight task (session unchanged, queue stopping)
- PASS — upload:object: now in guest workspace without A data
- PASS — upload:object: aborted upload published nothing
- PASS — upload:object: no media object uploaded after stop
- PASS — upload:object: B cloud untouched
- PASS — upload:object: A pending edit preserved in A workspace
- PASS — both pending edits synced later to A only

## safety #2b: account switch during an in-flight restore (download / after media commit), progress + personal media

- PASS — apply:download: sign-out waits for the in-flight restore
- PASS — apply:download: guest workspace has no A data/media
- PASS — apply:download: B workspace has no A data/media (no contamination)
- PASS — apply:download: B cloud untouched
- PASS — apply:download: A workspace consistent (complete load, journals settled)
- PASS — apply:download: A cloud unchanged by the interrupted restore
- PASS — apply:mediaCommitted: sign-out waits for the in-flight restore
- PASS — apply:mediaCommitted: guest workspace has no A data/media
- PASS — apply:mediaCommitted: B workspace has no A data/media (no contamination)
- PASS — apply:mediaCommitted: B cloud untouched
- PASS — apply:mediaCommitted: A workspace consistent (complete load, journals settled)
- PASS — apply:mediaCommitted: A cloud unchanged by the interrupted restore

## edits during in-flight sync are never lost (upload and download)

- PASS — edit made during upload stays pending (marker not cleared)
- PASS — both edits reach the account
- PASS — edit during download kept (workout + photo)
- PASS — interrupted apply rolled back (no half-applied cloud media/state)
- PASS — then an explicit conflict, not a silent overwrite

## crash during restore: journal recovery after process kill (two crash points)

- PASS — crash point 1: still in the account workspace after the crash
- PASS — crash point 1: rolled back to the previous consistent state
- PASS — crash point 1: next sync completes the load
- PASS — crash point 2: still in the account workspace after the crash
- PASS — crash point 2: consistent (fully applied or fully rolled back), journal resolved
- PASS — crash point 2: if applied, revision was recorded (no false pending)

## no false conflict: device-only saves (running workout) do not block pulling account changes

- PASS — running workout marked the device dirty (device-only data)
- PASS — account change pulled without a conflict
- PASS — running workout kept (device-only)

## D10: focus/online storm during first load does not restart or duplicate it

- PASS — exactly one apply ran
- PASS — load completed

## empty-data guard: device reset re-loads the account; deleting everything locally asks first

- PASS — after reset the account data loads again
- PASS — reset never uploaded empty data
- PASS — emptying the device triggers an explicit choice, not an upload
- PASS — populated account untouched

## local storage failure: shown to the user, account never treated as in sync with a stale copy

- PASS — failed local save is visible
- PASS — in-memory change still reached the account
- PASS — after restart the stale local copy is refreshed from the account

## RLS/privacy: B cannot read A backup row or media

- PASS — B sees no rows for A
- PASS — B lists no A objects

## migration M1: v42 data with a validated owner is linked automatically without data change

- PASS — old build backed up to A (owner hint set)
- PASS — legacy workspace linked to A automatically (validated owner)
- PASS — legacy data unchanged (history + media bytes)
- PASS — no conflict, no spurious upload
- PASS — a separate empty guest workspace was created
- PASS — v42 snapshot moved out of localStorage into a recovery copy
- PASS — signed out: guest workspace does not show A data
- PASS — signing in again returns to the linked legacy workspace

## migration M2/M3: unknown owner is never linked silently; keep-separate and link both preserve data

- PASS — asks before linking unknown legacy data
- PASS — nothing uploaded while undecided
- PASS — still undecided after a full restart (asked again)
- PASS — keep separate: new A workspace auto-loaded the account
- PASS — legacy data preserved as the guest workspace
- PASS — link: legacy workspace now owned by A
- PASS — link with divergent cloud: explicit conflict, nothing uploaded
- PASS — keep-device: account now has legacy data; cloud copy kept
- PASS — all references exist

## release update path: installed v42 app updates through its service worker and keeps all data

- PASS — v42 app installed and controlling, cache v42
- PASS — new build running from the new cache (v43), old cache removed
- PASS — data intact after the update; registry created; still guest/legacy
- PASS — no page exceptions after update

## migration M4: storage failures during migration leave the original data intact

- PASS — registry write failure: app still runs on the original data
- PASS — next start creates the registry; data intact
- PASS — link write failure: legacy stays unowned, data intact, error shown
- PASS — snapshot copy failure: snapshot stays in localStorage
- PASS — next start: snapshot moved after verified copy

## Separate run (scenario added after the full run)

```
== delete cloud backup: removes row, versions and media; device data kept; sync turned off
  PASS precondition: account has data and media objects
  PASS row, versions and all media objects removed
  PASS device data untouched
  PASS sync turned off so the backup is not silently re-created
  PASS later local edits stay local while sync is off

==== checks: 5 passed, 0 failed; scenario errors: 0 ====
```

## Targeted follow-up runs (after adding single-tab coordination)

Two tabs on one account and session expiry — **27 passed, 0 failed**:

```
== two tabs: second tab is blocked; takeover waits for the in-flight upload and keeps the pending edit
  PASS second tab is blocked and never started the app (no state, no writes)
  PASS takeover waits while the first tab finishes its in-flight upload
  PASS first tab handed over and is now blocked
  PASS new active tab has the pending edit (not lost, not overwritten)
  PASS aborted upload in the first tab published nothing
  PASS new tab uploads the handed-over edit on start
  PASS both edits reach the account, one revision each
  PASS taking the app back keeps everything (round trip)
== two tabs: restore in the active tab while the other tab asks to take over
  PASS takeover does not interrupt the restore write (other tab still waiting)
  PASS new tab sees the completed restore (state + progress + personal media)
  PASS edit in the new tab after the handover syncs
  PASS old tab stays blocked (cannot write stale state)
== two tabs: sign-out in the active tab while it is syncing; the other tab never writes across accounts
  PASS active tab signed out into the guest workspace; aborted upload published nothing
  PASS other tab stayed blocked throughout
  PASS taking over after sign-out opens the guest workspace (no A data)
  PASS B workspace empty; B cloud untouched
  PASS A pending edit preserved and synced only to A
== session expiry: local work continues, survives restart, resumes after re-authentication
  PASS expired session: still in A workspace with A data
  PASS session is gone (refresh rejected)
  PASS editing and saving continue locally; status says signed out with changes saved
  PASS nothing uploaded while signed out
  PASS pending edit survives a full restart
  PASS re-authentication in the same workspace resumes sync and uploads the pending edit
== session expiry: re-authenticating as a different account never uploads the pending edit there
  PASS A pending edit saved locally while expired
  PASS signing in as B opens B workspace without A data
  PASS B cloud never receives A data
  PASS A pending edit preserved and synced to A after signing back in
==== checks: 27 passed, 0 failed; scenario errors: 0 ====
```

Startup-sensitive regression subset after the startup restructure — **47 passed, 0 failed**:

```
== D1+auto-load: fresh device with setup+reload before sign-in loads every section and media automatically
  PASS device 1 uploaded (rev >= 1, 2 workouts, 2 media)
  PASS every manifest reference exists in storage
  PASS device 1 status synced; local and cloud lines differ
  PASS fresh device now has a goal snapshot (the D1 trigger)
  PASS no link prompt / no conflict for an untouched device
  PASS account workspace created and active
  PASS calendar/workouts loaded
  PASS custom plan + exercise loaded
  PASS motivation (achievements) of device 1 all present
  PASS measurements loaded
  PASS progress + personal media loaded byte-identical
  PASS device 2 status synced, not dirty
  PASS loading did not upload (cloud revision unchanged)
  PASS D8: no full-state copies in localStorage
  PASS no page exceptions
  PASS restart after a load: journal settled, nothing rolled back or re-downloaded
== safety #2b: account switch during an in-flight restore (download / after media commit), progress + personal media
  PASS apply:download: sign-out waits for the in-flight restore
  PASS apply:download: guest workspace has no A data/media
  PASS apply:download: B workspace has no A data/media (no contamination)
  PASS apply:download: B cloud untouched
  PASS apply:download: A workspace consistent (complete load, journals settled)
  PASS apply:download: A cloud unchanged by the interrupted restore
  PASS apply:mediaCommitted: sign-out waits for the in-flight restore
  PASS apply:mediaCommitted: guest workspace has no A data/media
  PASS apply:mediaCommitted: B workspace has no A data/media (no contamination)
  PASS apply:mediaCommitted: B cloud untouched
  PASS apply:mediaCommitted: A workspace consistent (complete load, journals settled)
  PASS apply:mediaCommitted: A cloud unchanged by the interrupted restore
== crash during restore: journal recovery after process kill (two crash points)
  PASS crash point 1: still in the account workspace after the crash
  PASS crash point 1: rolled back to the previous consistent state
  PASS crash point 1: next sync completes the load
  PASS crash point 2: still in the account workspace after the crash
  PASS crash point 2: consistent (fully applied or fully rolled back), journal resolved
  PASS crash point 2: if applied, revision was recorded (no false pending)
== migration M2/M3: unknown owner is never linked silently; keep-separate and link both preserve data
  PASS asks before linking unknown legacy data
  PASS nothing uploaded while undecided
  PASS still undecided after a full restart (asked again)
  PASS keep separate: new A workspace auto-loaded the account
  PASS legacy data preserved as the guest workspace
  PASS link: legacy workspace now owned by A
  PASS link with divergent cloud: explicit conflict, nothing uploaded
  PASS keep-device: account now has legacy data; cloud copy kept
  PASS all references exist
== release update path: installed v42 app updates through its service worker and keeps all data
  PASS v42 app installed and controlling, cache v42
  PASS new build running from the new cache (v43), old cache removed
  PASS data intact after the update; registry created; still guest/legacy
  PASS no page exceptions after update
==== checks: 47 passed, 0 failed; scenario errors: 0 ====
```

## UI-driven live verification (`live-verify.js`)

Build: `f213cd0` (v49), `CACHE_VERSION v49`, assets `?v=53`, served locally. `live-verify.js` includes the
end-of-run reset of the test account.
Environment: Fedora 44, Google Chrome 154.0.8037.92 (headless, disposable profiles), live Supabase project,
permanent test account `gqsync-c` only.
Run: 2026-10-11T23:24:21.692Z — **38 passed, 0 failed**. The final reset left no backup row, versions or
Storage objects on the account (`Observer.reset()` verifies that nothing is left).

```
== 1. plan/exercise change: saved locally, synced automatically while online
  PASS signed in: account workspace active, sync on by default (not "off")
  PASS empty account + fresh device: nothing uploaded
  PASS saved on this device immediately (localStorage has the edit and the new plan order)
  PASS "Saved on this device" and the account line are separate
  PASS synced to Supabase automatically (no Sync now): weight, sets and plan order
    (cloud updated ~5 s after Save)
  PASS UI then reports "synced"
== 2. completed workout + measurement + photo + personal media: saved locally, synced automatically
  PASS workout saved on the device (history entry, sets done, no running session)
  PASS cloud has the completed workout automatically, identical to the device record (date/calendar, plan, sets done, sets, reps, weight)
  PASS cloud has achievements/motivation, goal and the measurement
  PASS photo and personal media objects exist in Storage for every manifest reference
  PASS cloud payload never contains a running workout/activity
== 3. offline edits survive a full browser restart
  PASS offline: saved on device, account line says offline/pending (not synced)
  PASS after full restart (offline): both edits still there and still pending
  PASS cloud untouched while offline
== 4. reconnect: pending offline changes sync automatically
  PASS after reconnect the offline workout and plan edit reached the account (browser online event)
  PASS no conflict, status synced
== 5. fresh second device loads everything automatically after online sign-in
  PASS device 2: plans (exercise settings + order) loaded
  PASS device 2: workouts/calendar, measurement, achievements loaded
  PASS device 2: progress photo and personal media byte-identical
  PASS device 2: synced, no conflict, loading did not upload
== 6. empty/default state never overwrites populated cloud data
  PASS "Reset data" on device 2 did not upload an empty state (revision and history unchanged)
  PASS device 2 re-loaded the account instead
== 7. pending local changes are not silently overwritten by a cloud pull
  PASS device 2 workout synced automatically (cloud newer)
  PASS device 1 keeps its pending edit (weight 70) and gets an explicit choice, not a silent pull
  PASS cloud not overwritten by device 1 either
  PASS after choosing "Keep account": device 1 has the account data and a recovery copy of its own version
== 8. a running workout is not interrupted by a cross-device pull; synced after completion
  PASS workout running on device 1 (1 set ticked)
  PASS device 2 edited the plan that is running on device 1
  PASS device 2 change synced
  PASS device 1 pulled device 2's change automatically (on returning to the app)
  PASS running workout untouched: same session, start time, ticked set, still on screen, no reload/dialog
  PASS the running workout was not uploaded to the account
  PASS after Finish the workout synced automatically, identical to the device record (2 sets done, the plan now has 5 sets)
  PASS device 2 received device 1's finished workout automatically
== 9. sync switched off: shown clearly, local saving continues
  PASS Settings shows sync off (switch, state text, account line) and the separate local line
  PASS with sync off: change saved on the device, nothing uploaded
  PASS switching sync back on uploads the pending change automatically
  PASS no page exceptions on either device
==== checks: 38 passed, 0 failed ====
```
