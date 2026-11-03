# Phase 2 — Workout screen and rest timer (v97) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active workout obvious and safe: labelled set rows, + Add set / remove last set, a big Finish
with confirmation and a hidden two-step Discard, a large rest-timer card with pause/+15 s/restart/stop, and
starting a workout straight from an exercise.

**Architecture:** Vanilla JS `script.js` (Slovak comments, globals), Bento CSS at the end of `style.css`,
`index.html`. The active session lives in `state.activeSession` (device-only key, never synced, see
`DEVICE_STATE_KEYS`); every new session field goes inside it. History entries are written only by
`finishWorkout()`. Tests are Node scripts driving headless Chrome (`tests/sync/lib.js`).

**Tech Stack:** vanilla JS/CSS/HTML, service worker, Node test scripts.

**Spec:** `docs/superpowers/specs/2026-10-30-gym-lift-improvements-design.md` §0, §1.3, §5, §11.

## Global Constraints

- Never overwrite populated records with defaults; additive changes only; a discarded or unfinished session
  never writes history, records, XP or plan data.
- New session data lives only inside `state.activeSession` (device-only). No new top-level state keys.
- Every user-visible string in all 6 languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar` RTL); `en` is reference.
- Light/Dark themes via tokens (no literal colours), ≥ 44 px touch targets, number inputs ≥ 16 px with
  `inputmode="decimal"` (weight) / `"numeric"` (reps).
- Keep element ids `btn-finish-workout`, `btn-reset-session`, `btn-open-rest`, `timer-bar`, `timer-time`,
  `timer-stop`, `modal-rest`, `.set-btn.sq`, `.set-weight`, `.set-reps`, `.set-fail` (tests + parity);
  `tests/app/bento-parity.js` must stay green.
- iPhone header rule stays (`html.ios .app-main` 34 px); nothing sticky may cover a focused input.
- Release: `CACHE_VERSION` `v97`, every `?v=` → `103` (index.html + sw.js PRECACHE). Commit/push only with
  the owner's approval.

## Review Focus

- A workout running when the new version loads (old `activeSession` without the new fields) must keep all
  marks and overrides and finish normally. → Task 1 test "old session shape".
- A rest timer saved by v96 (`gymquest_resttimer` = plain number) must still restore after the update.
  → Task 4 test "legacy timer key".
- Double tap / repeated Enter on Finish must save exactly one history entry. → Task 3 test.
- Removing a set that is completed or edited must ask first and must clear that set's marks and
  overrides only. → Task 1 test.
- Starting from an exercise while a workout runs must never discard or replace it. → Task 5 test.

---

### Task 1: Session set count — + Add set and remove last set

**Files:** Modify `script.js` (session helpers ~11481–11720, set loops at ~11440, ~11534, ~11601, ~11702,
~12094, `finishWorkout` ~20493/20515, summary/`updateSummary`), `index.html` none, `style.css` (button style) ·
Create `tests/app/add-set.js`.

**Interfaces:** Produces `sessionSetCount(ex) -> number` = planned sets + `activeSession.setDelta[exerciseSessionKey(ex)]`
(integer, may be negative, result clamped to ≥ 1; missing field = 0); `addSessionSet(ex)`;
`removeLastSessionSet(ex)` (async-confirm UI wrapper `requestRemoveLastSet(ex)`). Every loop that walks the
sets of an exercise **in a running session or when finishing** uses `sessionSetCount(ex)` instead of `ex.sets`;
plan editor / plan preview keep `ex.sets`.

- [ ] **Step 1: Failing test** `tests/app/add-set.js` (no backend, pattern of `tests/app/set-weights.js`):
  start a Push session; on bench press tap "+ Add set" → 4 set rows (plan has 3); the new set's weight and
  reps equal set 3's effective values (also when set 3 had per-set overrides); other sets unchanged; mark set 4
  done, Finish → history entry has 4 sets for bench press and the plan still has `sets: 3`; reload mid-session
  keeps 4 rows; "Remove last set" on an untouched extra set removes it without a dialog; on a completed set
  shows a confirm, Cancel keeps it, Confirm removes it and clears its done/failure marks and weight/reps
  overrides only; can't go below 1 set; unilateral exercise adds one set per side pair; **old session shape**:
  an `activeSession` without `setDelta` (as saved by v96) renders the planned count, keeps marks, finishes.
- [ ] **Step 2: Run** `GQ_TEST_PORT=8190 node tests/app/add-set.js` → FAIL.
- [ ] **Step 3: Implement** the helpers and the two buttons under each exercise in the session (labels
  `session.addSet` "+ Add set", `session.removeSet` "Remove last set", confirm `session.removeSetConfirm`
  "Remove set {n}? Its weight, reps and ✓ are cleared." — 6 languages). New set copies the last set's
  effective weight/reps into the session overrides for the new index.
- [ ] **Step 4: Run** `add-set.js`, `set-weights.js`, `set-reps.js`, `drop-sets.js`, `bento-home.js` → PASS.
- [ ] **Step 5: Stop and report** (controller snapshots; no git commands).

### Task 2: Labelled set rows with inline inputs

**Files:** Modify `script.js` (`buildSetItem` ~12156, the set editors `openSetWeightEditor`/`openSetRepsEditor`
stay for drops only if still used), `style.css` (Bento section) · Tests: update `tests/app/set-weights.js`,
`tests/app/set-reps.js`, `tests/app/drop-sets.js`; extend `tests/app/bento-theme.js`.

**Interfaces:** Consumes `sessionSetCount(ex)` (Task 1). The row becomes: label "Set 1" (unilateral: "Set 1 ·
Left"), **Weight** input (`.set-weight`, `inputmode="decimal"`, unit "kg", empty = bodyweight shown as
placeholder `t('bento.bw')`), **Reps** input (`.set-reps`, `inputmode="numeric"`, unit "×"), 🔥 failure toggle
(`.set-fail`), ✓ done button (`.set-btn.sq`). Inputs write through the same session-override setters the old
editors used (on `change`, invalid → revert to the previous value), each input has a visible label or
`aria-label` "Weight, set 1" / "Reps, set 1".

- [ ] **Step 1: Failing checks**: in `bento-theme.js` (both themes, 360/393, en/ar/fr, 130 %): every session
  set row shows the words for weight and reps (i18n `session.weight` "Weight", `session.reps` "Reps"),
  inputs ≥ 16 px font and ≥ 44 px tall, ✓ ≥ 44 px, no row overflows; update `set-weights.js`/`set-reps.js` to
  type into the inputs (values persist after reload, finish records them exactly as before: `setWeights`,
  `sideWeights`, reps overrides).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the row; done state = whole row tinted with the accent token + ✓ filled; focused
  input scrolls into view above any sticky bar (Tasks 3/4 add bars — use `scroll-margin-bottom` equal to their
  combined height via a CSS custom property `--sticky-bottom`).
- [ ] **Step 4: Run** `set-weights.js`, `set-reps.js`, `drop-sets.js`, `bento-theme.js`, `bento-parity.js`,
  `ios-zoom.js` → PASS.
- [ ] **Step 5: Stop and report.**

### Task 3: Finish with confirmation, Discard moved to ⋯ with two steps

**Files:** Modify `index.html` (session tile), `script.js` (`finishWorkout` ~20461 wrapper, discard handler
~24279, `updateSummary`), `style.css` · Create `tests/app/finish-discard.js`; update `tests/app/confirm-labels.js`.

**Interfaces:** Produces `requestFinishWorkout()` (opens sheet "Save workout?" with buttons `Save workout`
(primary, calls existing `finishWorkout()`), `Keep training`), a guard flag so a second call while the sheet is
open or saving is ignored; sticky bar `#finish-bar` above the tab bar containing `#btn-finish-workout`
(disabled until ≥ 1 completed set, shows the existing XP text `#tr-finish-xp`); a second Finish button
`#btn-finish-workout-end` after the last exercise; session tile ⋯ menu `#btn-session-more` with `Discard
workout` (`#btn-reset-session` keeps its id) → step 1 sheet "Discard this workout?" → step 2 "Discard for
good" (destructive) — nothing saved. Sets `--sticky-bottom` (Task 2) to the bar height while visible.

- [ ] **Step 1: Failing test** `finish-discard.js`: both Finish buttons open the sheet; Keep training closes
  it with no history change; Save adds exactly one history entry even with 3 rapid clicks/Enter presses;
  Discard is not visible until ⋯ is opened; Discard needs two confirmations, Cancel at either step keeps the
  session; after confirmed discard no history/XP change; the sticky bar never overlaps the focused weight
  input of the last set (bounding boxes, 393×700 viewport); Esc closes the sheet.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (6 languages; copy: `finish.title` "Save
  workout?", `finish.save` "Save workout", `finish.keep` "Keep training", `discard.title` "Discard this
  workout?", `discard.body` "Sets you marked won't be saved.", `discard.confirm` "Discard", `discard.final`
  "Discard for good").
- [ ] **Step 4: Run** `finish-discard.js`, `confirm-labels.js`, `bento-home.js`, `bento-parity.js` → PASS.
- [ ] **Step 5: Stop and report.**

### Task 4: Rest-timer card (pause, +15 s, restart, stop, replace)

**Files:** Modify `script.js` (rest timer section ~21580–21720, `startPreset`, `startCustomOnce`),
`index.html` (`#timer-bar` → card markup, keep ids), `style.css` · Create `tests/app/rest-timer.js`.

**Interfaces:** Stored value under `gymquest_resttimer` becomes JSON
`{ v: 2, endAt, pausedLeftMs|null, totalMs, presetId|null }`; `restoreRestTimerEnd()` still accepts the legacy
plain number (= `{endAt: n, pausedLeftMs: null, totalMs: null, presetId: null}`). Produces
`pauseRestTimer()`, `resumeRestTimer()`, `addRestTime(sec)`, `restartRestTimer()`; `startTimer(seconds,
presetId)` shows the toast "Replaced {old} with {new}" (`rest.replaced`) when another timer was running.
Remaining time is always `endAt - Date.now()` (or `pausedLeftMs` while paused). The card is sticky above
`#finish-bar`/tab bar, shows label, big mm:ss (≥ 40 px), progress, the preset name; the running preset chip in
`#modal-rest` is marked `aria-pressed="true"`; card buttons ≥ 44 px; adds its height to `--sticky-bottom`.
The completion gong logic (`finishRestTimer`, `completionWasLive`) is unchanged; a paused timer never finishes.

- [ ] **Step 1: Failing test** `rest-timer.js` (fake time via `Date.now` override hook in page or real waits ≤ 3 s
  with 3–5 s timers): start 90 → card visible, 90 chip pressed; start 120 while running → toast text and chip
  moves; pause → time frozen across 2 s and across reload; resume continues; +15 s adds 15; restart = full
  preset again; stop hides card and clears storage; **legacy timer key**: `localStorage.gymquest_resttimer =
  String(Date.now()+60000)` then reload → card shows ~1:00; the card never covers a focused set input.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (6 languages: `rest.pause` "Pause", `rest.resume`
  "Resume", `rest.plus15` "+15 s", `rest.restart` "Restart", `rest.stop` "Stop", `rest.replaced`
  "Replaced {old} with {new}", `rest.paused` "Paused").
- [ ] **Step 4: Run** `rest-timer.js`, `bento-home.js` (Today Rest tile still shows the countdown),
  `bento-theme.js` → PASS.
- [ ] **Step 5: Stop and report.**

### Task 5: Start a workout from an exercise

**Files:** Modify `script.js` (`openExerciseSheet` ~13642 browse context, `ensureSession`, `getPlan` ~1375,
`recordedPlanName`, `renderTrening`), `style.css` · Create `tests/app/quick-workout.js`.

**Interfaces:** Quick workout = `activeSession.quick = { exercises: [<plan-exercise copy>] }` with
`activeSession.planId = 'quick'`; `getPlan('quick')` returns a synthetic plan `{ id: 'quick', name:
t('quick.name'), exercises: activeSession.quick.exercises, builtin: false, quick: true }` only while such a
session exists (never stored in `state.plans`). `startQuickWorkout(exerciseId)`; `addExerciseToSession(exId)`
appends to `activeSession.quick.exercises` for a quick workout, otherwise to `activeSession.extraExercises`
(new array; `sessionExercises(plan)` = plan exercises + extras is what the session render and
`finishWorkout()` iterate — the plan itself is never modified).
History entry `planName` = "Quick workout" in the current language (`quick.name`), `planId: 'quick'`.
The exercise copy uses the library defaults (sets 3, reps from the library entry or 10, weight 0) and gets a
fresh `sessionKey`.

- [ ] **Step 1: Failing test** `quick-workout.js`: Exercises → bench press sheet shows "Start workout with this
  exercise" (`quick.start`); tap → Workout tab with a session of 1 exercise, title "Quick workout"; + Add exercise
  from the library adds more; Finish → one history entry `planName` "Quick workout", `state.plans` unchanged;
  with a running Push session the sheet shows instead "Add to current workout" (`quick.addToCurrent`) and
  "Go to current workout" (`quick.goToCurrent`); Add appends the exercise to the running session without
  changing its marks; nothing ever discards the running session; reload during a quick workout restores it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (6 languages).
- [ ] **Step 4: Run** `quick-workout.js`, `bento-home.js`, `bento-parity.js`, `add-set.js` → PASS; local
  stack: `tests/sync/run.js "smoke|D3"` (session is device-only, history syncs).
- [ ] **Step 5: Stop and report.**

### Task 6: v97 release preparation (no push)

- [ ] Bump `CACHE_VERSION` `v97`, `?v=103`; README (Workout screen section: set rows, Add set, Finish/Discard,
  rest timer card, Quick workout); add the 5 new suites to `../claude-code/local-preview/regression.sh`.
- [ ] Run `regression.sh`, `tests/sync/run.js` (full), `bento-update.js` with `GQ_OLD_REF=HEAD`,
  `tests/sync/bento-upgrade.js` (v96 → v97 with a running session + running timer) → all green except the
  two known harness items; capture before/after screenshots (Workout running, rest card, finish sheet,
  discard menu; en/sk/ar; light/dark; 393 px) into `claude-code/improve-2026-10-30/phase2/`.
- [ ] Report to the owner; wait for release approval.
