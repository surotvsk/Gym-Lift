# Phase 1 — Bug fixes & polish (v91) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the low-risk fixes of the approved project as web release v91: forward-compatible loader, no new
week excuses, clearer default plan names, correct chat read state and navigation, Sign out in Settings with an
unsynced-changes check, and the spacing/Stats fixes.

**Architecture:** Vanilla JS single file `script.js` (Slovak comments), `style.css` token layer (Bento),
`index.html`; tests are Node scripts driving headless Chrome (`tests/sync/lib.js`), app suites run without a
backend, social/sync suites against the local Supabase stack.

**Tech Stack:** vanilla JS/CSS/HTML, service worker `sw.js`, Node test scripts, local Supabase stack.

**Spec:** `docs/superpowers/specs/2026-10-30-gym-lift-improvements-design.md` (§0, §1.3–1.6, §2 Phase 1, D5, D8)

## Global Constraints

- Never overwrite populated records with defaults; additive changes only; no real user data.
- Every user-visible string in all 6 languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar` RTL); `en` is reference.
- Light / Dark / System themes; tokens, not literal colours; ≥ 44 px touch targets; text fields ≥ 16 px.
- No v77 element id may disappear without updating `tests/app/bento-parity.js` with a reason.
- Release = bump `CACHE_VERSION` to `v91` and all `?v=` to `97` (index.html + sw.js PRECACHE). Local only;
  commit/push only after the owner approves.
- iOS Safari must show a notification for every Web Push — client-side suppression must never skip it there.

## Review Focus

- A state saved by v91 with an unknown top-level field, opened by v90/v86 and re-saved, must not lose any
  **known** data (and v91 must not lose the unknown field). → Task 1 test `forward-compat`.
- A user who excused weeks before v91 keeps the same streak after the update. → Task 2 test.
- A built-in plan whose exercises were edited keeps its old name; a renamed plan keeps the user's name. → Task 3.
- A message arriving while the app is in the background must not be marked seen until the chat is visible. → Task 4.
- Sign out with unsynced changes must never claim they are backed up; choosing "sign out anyway" keeps them on
  the device and uploads them on the next sign-in. → Task 5.

---

### Task 1: Loader keeps unknown top-level fields

**Files:** Modify `script.js` (`migrateV2toV3`, ~line 9765) · Create `tests/app/forward-compat.js`

**Interfaces:** Produces: saved state round-trips unknown top-level keys (later phases may add fields).

- [ ] **Step 1: Write the failing test** `tests/app/forward-compat.js` (pattern of `tests/app/sw-pages.js`):
  set `localStorage[STORAGE_KEY]` to a v3 state with `futureField: { a: 1 }` and a history entry, reload,
  `saveState()`, read back. Assertions: `'futureField kept' === JSON.parse(ls).futureField.a === 1`;
  history/plans/achievements byte-identical; `syncContentHash` equal before/after a second load (no false
  dirty); legacy keys `name`, `legacyGoal` behaviour unchanged.
- [ ] **Step 2: Run** `GQ_TEST_PORT=8174 node tests/app/forward-compat.js` → FAIL (`futureField` missing).
- [ ] **Step 3: Implement** in `migrateV2toV3`: after building `out`, copy every key of `base` that is not a
  key of `out` and not in `const LEGACY_STATE_KEYS = ['media', '_applyId']` (media/applyId keep their existing
  handling). Comment in Slovak why (older versions drop unknown fields).
- [ ] **Step 4: Run** the test → PASS; run `tests/sync/run.js "smoke|D3|no false conflict"` (local stack) → PASS.
- [ ] **Step 5: Commit** `git add script.js tests/app/forward-compat.js` — "Keep unknown saved fields (forward compatibility)".

### Task 2: Remove the week-excuse option (D8)

**Files:** Modify `index.html` (excuse tile/sheet markup), `script.js` (`openExcuseSheet`, `renderBento`
excuse tile, `on('btn-excuse')` handlers, i18n keys stay), `style.css` (unused excuse styles may stay);
tests `tests/app/bento-home.js`, `tests/app/bento-parity.js`, `tests/app/bento-theme.js`,
`tests/app/bento-update.js`, `tests/social/ui-you.js`, `tests/sync/bento-upgrade.js`.

**Interfaces:** `state.excusedWeeks` stays read-only input to `computeStreak()`; nothing writes to it anymore.

- [ ] **Step 1: Write the failing test** `tests/app/no-excuse.js`: fresh app → no visible element matching
  `#btn-excuse, [data-go="excuse"], #modal-excuse:not([hidden])` on Today; state with history in weeks W1, W3
  and `excusedWeeks: [W2]` → `computeStreak()` equals the v90 value (3 weeks) and the Streak tile shows it.
- [ ] **Step 2: Run** → FAIL (tile present).
- [ ] **Step 3: Implement**: remove the Today excuse tile and every entry point to the excuse sheet; delete
  the sheet markup; keep `computeStreak()` honouring existing `excusedWeeks`; the Today grid reflows without a
  gap. Update the six suites: drop excuse expectations; in `bento-parity.js` move `btn-excuse`/`modal-excuse`
  to an explicit "removed by owner decision D8 (2026-10-30)" list.
- [ ] **Step 4: Run** `no-excuse.js`, `bento-home.js`, `bento-parity.js`, `bento-theme.js`, `bento-update.js`
  → PASS; `ui-you.js`, `bento-upgrade.js` on the local stack → PASS.
- [ ] **Step 5: Commit** — "Remove week excuses; earlier excused weeks still count (D8)".

### Task 3: Clearer names for untouched built-in plans (D5)

**Files:** Modify `script.js` (`planDisplayName` ~line 1384, i18n blocks of all 6 languages,
`isBuiltinPlanLabel`) · Create `tests/app/plan-names.js`

**Interfaces:** Produces `builtinPlanUntouched(plan) -> boolean` (true when `plan.builtin`, no `customName`,
and the exercise id list equals `DEFAULT_PLANS[plan.id].exercises` ids in order; sets/reps/weights ignored).

- [ ] **Step 1: Write the failing test** `tests/app/plan-names.js`: fresh state → Workout tiles show
  "Chest, Shoulders & Triceps", "Back & Biceps", "Legs" (en) and the sk/es/pt-BR/fr/ar names below; a `push`
  plan with one exercise added → still "Push"; a `pull` plan with `customName: 'My pull'` → "My pull";
  history entries keep their recorded `planName`; `isBuiltinPlanLabel('push', 'Push')` and
  `isBuiltinPlanLabel('push', 'Chest, Shoulders & Triceps')` both true.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: new keys `plan.pushMuscles`, `plan.pullMuscles` with exact copy —
  en "Chest, Shoulders & Triceps" / "Back & Biceps"; sk "Hrudník, ramená a triceps" / "Chrbát a biceps";
  es "Pecho, hombros y tríceps" / "Espalda y bíceps"; pt-BR "Peito, ombros e tríceps" / "Costas e bíceps";
  fr "Pectoraux, épaules et triceps" / "Dos et biceps"; ar "الصدر والكتفان والترايسبس" / "الظهر والبايسبس".
  `planDisplayName` uses them only when `builtinPlanUntouched(plan)`; Legs/Home/Outdoor unchanged.
- [ ] **Step 4: Run** `plan-names.js`, `bento-home.js`, `bento-theme.js` (long names must not overflow tiles at
  360/393 px, 130 % text) → PASS.
- [ ] **Step 5: Commit** — "Built-in Push/Pull plans show their muscle groups when unchanged (D5)".

### Task 4: Chat — seen only when visible, back keeps position, avatar opens profile, foreground push

**Files:** Modify `script.js` (`communityAfterChatRender`, `communityMarkChatRead` ~15995, chat header
markup ~15947, `communityGoBack`, visibilitychange listener), `sw.js` (`push` handler) · Test: new
`tests/social/ui-chat-read.js` (local stack, two users like `ui-chat-scroll.js`).

**Interfaces:** Produces `communityChatVisible() -> boolean` (tab `komunita`, view `chat`, chat id set,
`document.visibilityState === 'visible'`); URL hash `#chat=<conversation id>` set with
`history.replaceState` while a chat is visible, removed when leaving it.

- [ ] **Step 1: Write the failing tests** in `ui-chat-read.js`: (a) B has A's chat open, page hidden
  (`Emulation.setPageVisibility`/`document.hidden` override), A sends → no `chat_reads` update for B;
  after B becomes visible → marked read within 3 s; (b) B scrolled up 600 px in a long chat, taps the header
  name → profile → Back → same chat, scroll offset within 40 px of before; (c) tapping the header avatar opens
  the profile; (d) service worker push for conversation X while a focused, visible client has `#chat=X` and
  the UA is not iOS → no notification shown; other conversation → shown; iOS UA → always shown.
- [ ] **Step 2: Run** `node tests/social/ui-chat-read.js` (local stack env from `claude-code/local-preview/test-env.sh`) → FAIL.
- [ ] **Step 3: Implement**: `communityMarkChatRead` returns early unless `communityChatVisible()`; a
  `visibilitychange` → visible with an open chat reloads new messages and marks read; save
  `{ chatId, scrollY }` before `communityGo` leaves the chat and restore it instead of scrolling to the end
  when returning; avatar becomes part of the existing `open-user` button; set/clear the `#chat=` hash; in
  `sw.js` skip `showNotification` only when a matching focused visible client exists and the UA is not
  iOS/iPadOS (comment the platform rule).
- [ ] **Step 4: Run** `ui-chat-read.js`, `ui-chat-scroll.js`, `push.js`, `ui-push.js`, `phase2.js` → PASS.
- [ ] **Step 5: Commit** — "Chat: seen only when visible, Back keeps your place, no alert for the chat you're reading".

### Task 5: Sign out in Settings with an unsynced-changes check

**Files:** Modify `index.html` (Settings → Backup & sync section), `script.js` (`communitySignOut`, new
`requestSignOut`, i18n), `style.css` · Test: new scenario in `tests/sync/run.js`
"sign out: unsynced changes are never lost or misreported".

**Interfaces:** Produces `requestSignOut()`: if `syncIsDirty(syncMetaRead())`, a conflict, or failed media →
sheet with "Sync and sign out" (runs `syncNow`-equivalent; on failure stays signed in and shows the error),
"Sign out — keep changes on this device" (they upload after the next sign-in), "Cancel"; otherwise a normal
confirm. Calls existing `communitySignOut()`.

- [ ] **Step 1: Write the failing test** (scenario in `run.js`): A signed in, `__gq.addWorkout('w-p')` without
  sync → Settings shows a visible "Sign out" button (`#btn-settings-signout`); clicking it shows the
  unsynced sheet; choose "keep on device" → guest workspace, cloud revision unchanged, sign in again → `w-p`
  present and uploaded; second run choosing "Sync and sign out" → cloud contains `w-p` before the switch;
  copy never says "backed up" while dirty.
- [ ] **Step 2: Run** `node tests/sync/run.js "sign out: unsynced"` → FAIL.
- [ ] **Step 3: Implement** the button (only when signed in), the sheet (6 languages; all three buttons
  neutral styling, "Sync and sign out" primary, Cancel gets default focus), wire to `requestSignOut`.
- [ ] **Step 4: Run** the scenario + `run.js "D5|session expiry|two tabs: sign-out"` → PASS.
- [ ] **Step 5: Commit** — "Sign out in Settings, with a clear choice for unsynced changes".

### Task 6: Settings spacing, top spacing, Stats month

**Files:** Modify `style.css` (Bento section at the end), `script.js` only if markup grouping is needed ·
Test: extend `tests/app/bento-theme.js` with layout checks.

- [ ] **Step 1: Capture** the matrix (Today, Workout, Stats, Stats month/History, Calendar, Settings incl.
  More options) for en/sk/ar × 360/393 px × light/dark × 100/130 % text into
  `claude-code/improve-2026-10-30/phase1/before/`; list concrete defects (clipping, touching rows, top gap).
  If the Stats month defect the owner reported is not visible, ask the owner for a screenshot before changing it.
- [ ] **Step 2: Write the failing checks** in `bento-theme.js`: for every main screen the first heading's top
  ≤ `env(safe-area-inset-top) + 24 px`; in Settings every `.set-group` has ≥ 12 px gap to the next and no two
  text/control boxes overlap; month/stat tiles: `scrollWidth <= clientWidth` for every text node container;
  Stats month count equals `state.history` entries whose local date is in the current month (boundary dates
  1st 00:00 and last day 23:59 local).
- [ ] **Step 3: Run** → FAIL on the defects found.
- [ ] **Step 4: Implement** CSS fixes (padding tokens, gaps, `min-width: 0`, wrapping) — no negative margins;
  safe areas preserved.
- [ ] **Step 5: Run** `bento-theme.js`, `bento-home.js`, `ios-zoom.js` → PASS; capture the "after" matrix.
- [ ] **Step 6: Commit** — "Settings, headers and Stats month: spacing and alignment".

### Task 7: Android splash/notification colours follow the new logo

**Files:** Modify `capacitor.config.json` (`SplashScreen.backgroundColor` → `#D6F35A`,
`LocalNotifications.iconColor` → `#121212`) · Test: `tests/android/release-check.js` add a check that both
colours match `android/app/src/main/res/values/ic_launcher_background.xml` / ink.

- [ ] **Step 1: Add the check** → run `GQ_SKIP_BUILD=1 node tests/android/release-check.js` → FAIL.
- [ ] **Step 2: Change the config** → run → PASS (ships with the next AAB, no web effect).
- [ ] **Step 3: Commit** — "Android: splash and notification colours match the Gym-Lift logo".

### Task 8: v91 release preparation (no push)

- [ ] Bump `CACHE_VERSION` `v91`, `?v=97`; README (excuse removal, plan names, Sign out, chat behaviour).
- [ ] Run `claude-code/local-preview/regression.sh` + `tests/sync/run.js` (full, `GQ_OLD_ROOT` = v42 export)
  + `bento-upgrade.js` with `GQ_OLD_REF=HEAD` (v90 → v91) → all PASS except the two known harness items.
- [ ] Report to the owner with before/after screenshots; wait for release approval.
