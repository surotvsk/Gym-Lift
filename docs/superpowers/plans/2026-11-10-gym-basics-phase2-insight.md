# Gym-basics Phase 2 (clean-up + insight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workout screen calm again by moving the secondary exercise actions behind one "⋯" sheet. Then add per-exercise progress charts with estimated 1RM, sets and volume per muscle group, and a muscle recovery map, all without adding visible clutter.

**Architecture:** Client-only (`script.js` / `index.html` / `style.css`), with no server change.
- Insight is derived from history through one per-set helper and is never stored.
- The only new stored field is `endedAt` (ms) on new history entries, so recovery can use real time.
- New sheets reuse the existing sheet/modal pattern.
- Charts are small inline SVG drawn by one new generic helper; the existing body-chart code is not touched, to keep the merge with `main` small.
- Each feature lives in its own new `script.js` section.

**Tech Stack:** Vanilla JS (globals, Slovak comments), Bento tokens, headless Chrome test scripts (`tests/sync/lib.js`).

**Spec:** `docs/superpowers/specs/2026-11-10-gym-basics-design.md` (items 2, 6, 10), plus the owner's request of 2026-11-10: "the goal is also the app look clean and not cluttered".

## Global Constraints

- **Clean UI (owner, 2026-11-10):**
  - No new always-visible buttons on exercise tiles or plan-editor rows.
  - Secondary actions live in one "⋯" sheet per exercise.
  - Phase 2 adds exactly one new Stats tile ("Muscles") and no new Today tile.
  - Entry points to the progress sheet are taps on things that already exist (record rows, history exercise lines, the library detail), plus an item in the "⋯" sheet.
  - Every task's screenshots are compared with the "before" ones; default views must look the same or calmer.
- Work only in the worktree `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/gymquest/.claude/worktrees/gym-basics` (branch `gym-basics`). Never touch the main checkout, never `main`, never push. Commit per task on `gym-basics` only, ending the message with the attribution lines.
- Run app suites only via `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gym-basics/t.sh tests/app/<suite>.js`. The full regression is `claude-code/gym-basics/regression.sh`; stack suites in it run as `runhost`, which waits until port 8124 is free.
- No `CACHE_VERSION` / `?v=` bump.
- Code comments are in Slovak. README is in English.
- Every new string goes in `BASICS_I18N` in all six languages. List the new Arabic strings in the report.
- Bento tokens only, in a new CSS section `/* ===== Gym-basics: prehľad ===== */` at the end of `style.css`. Check light/dark, 390 px and RTL.
- Derived numbers never change XP, records (`personalRecords()`), achievements, streaks or the leaderboard.
- Assisted exercises never produce a 1RM or volume load.
- Warm-ups are never working sets. Imported entries (a future `source` field) count for charts, muscles and recovery.
- Estimates are labelled as estimates. No judgemental colours or wording: no red/green "good/bad".
- New sheets follow the Phase 1 fix standard:
  - `role="dialog" aria-modal="true" aria-labelledby`;
  - Escape closes them;
  - focus moves in on open and back to the opener on close;
  - they are listed in `isBusy()` and in `NATIVE_BACK_CLOSE`;
  - touch targets are ≥ 44 px.
- No existing element id is removed (`bento-parity.js`).

## Review Focus

1. **Exercises with history under several names, or a custom exercise renamed.** Grouping must use the identity (`exId` / `cx-…` / `exerciseIdentity`), never the display name; a library exercise shows one series across all plans and languages. Pinned in Task 2.
2. **A history entry with per-set weights, per-side values, drops, warm-ups and an assisted mark all at once.** Working sets must be exactly the done sets with the right weight and reps for each set and side. Drops are listed separately. Warm-ups and assisted load are excluded. Pinned in Task 2.
3. **Empty or one-point data.** A new user, an exercise with one session, or a muscle with no sets shows a calm empty state, never NaN, an empty SVG or a broken axis. Pinned in Tasks 3–5.
4. **Week and timezone boundaries.**
   - The muscle week uses the app's existing `weekKey` (same as the Stats "Week" tile).
   - Recovery age uses `endedAt` when present, else the entry date at 12:00 local, and never comes out negative.
   - Pinned in Tasks 4 and 5.
5. **Performance.** Opening Stats and the progress sheet with 1,000 history entries must stay fast: derived data is computed once per open, not per set or per tile. Pinned in Task 3 (a timing check with a 1,000-entry fixture).

---

**Before Task 1 (controller):** take "before" screenshots (light + dark, 390 px) of the workout screen with a barbell exercise, the plan editor with a superset, Stats, and Today. Save them to `claude-code/gym-basics/phase2/before/`.

### Task 1: One "⋯" action sheet per exercise (de-clutter)

**Files:**
- Modify `script.js`:
  - `buildExerciseBlock()` (the `.ex-mini` row);
  - `buildDropsBlock`, `buildWarmupButtons`, `buildPlatesButton`;
  - the swap button creation;
  - new section `/* ---------- Akcie cviku (⋯) ---------- */`;
  - `renderEditPanel()` rows.
- Modify `index.html`: new sheet `#modal-ex-actions`.
- Modify `style.css`.
- Tests: new `tests/app/ex-actions.js`. Adapt `drop-sets.js`, `warmups.js`, `plates.js`, `supersets.js` and any other suite that clicks `.btn-add-drop`, `.btn-add-warmup`, `.btn-warmup-ramp`, `.btn-plates`, the swap button, the editor ramp checkbox or "Link with next". Grep `tests/` for each selector.

**Interfaces:**
- Produces:
  - `openExerciseActions(ex, slotIndex)` / `closeExerciseActions()`.
  - The sheet lists, in order:
    1. `+ Warm-up` (`.btn-add-warmup`)
    2. `Warm-up ramp` (`.btn-warmup-ramp`, hidden when the ramp is empty)
    3. `+ Drop set` (`.btn-add-drop`)
    4. `Plates` (`.btn-plates`, only when `isBarbellExercise(ex)`)
    5. `Swap exercise` (the existing swap button class)
    6. a `Progress` item (`.btn-ex-progress`), wired in Task 3, hidden until then
  - Each item runs the same function as today's button, then closes the sheet.
- Decisions:
  - **Exercise tile:**
    - In a session, the existing set-count row (`+ Add set` / `Remove last set`, from `buildSetCountRow`) also gets exactly one round `⋯` button at its end (`.btn-ex-more`, aria-label "More actions for {name}").
    - Outside a session, `⋯` stands alone where the row would be.
    - `.ex-mini` keeps only content rows (drop rows) and is not rendered when empty.
    - Existing warm-up rows, drop rows, the effort chip and the superset bracket keep rendering where they are when they exist.
    - A read-only (replaced) segment has no `⋯`.
    - Outside a running session the tile shows `⋯` only if at least one item applies (Plates applies before a session).
  - **Plan-editor row:**
    - The Phase 1 additions (the "Add the warm-up ramp automatically" checkbox and "Link with next" / "Unlink") move into a per-row disclosure `More options` (`<details class="edit-more">`), closed by default.
    - The superset bracket and its single label stay visible.
    - Existing pre-Phase-1 controls (sets to failure, train both sides) stay where they are.

- [ ] **Step 1: Write the failing test `tests/app/ex-actions.js`.**
  - Each exercise tile in a session has exactly one `.btn-ex-more`.
  - The tile itself has no `.btn-add-drop`, `.btn-add-warmup`, `.btn-warmup-ramp`, `.btn-plates` or swap button.
  - Opening `⋯` on the bench tile shows the five items in order; the Plates item is absent for an assisted row and for a library exercise without a barbell.
  - Each item does what the old button did:
    - a warm-up row appears;
    - a drop row appears;
    - `#modal-plates` opens prefilled;
    - the swap picker opens;
    - and the sheet closes.
  - Escape closes the sheet and focus returns to `.btn-ex-more`. The sheet is in `isBusy()` and `NATIVE_BACK_CLOSE`.
  - Editor rows have a closed `details.edit-more` containing the ramp checkbox and the link button. The superset label is still visible with the details closed.
  - Tile calm check: at 390 px, in a session, a barbell tile shows its controls in one row: the set-count row contains exactly 3 buttons (`+ Add set`, `Remove last set`, `⋯`), has height ≤ 56 px, and no other button row follows it while there are no drops.
  - All 6 languages, RTL, light and dark, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement. Adapt the old suites' selectors** so they open `⋯` first. Their assertions on behaviour stay identical.
- [ ] **Step 4: Run** `ex-actions`, `drop-sets`, `warmups`, `plates`, `supersets`, `effort`, `auto-rest`, `bento-parity`, `bento-theme`, `quick-workout` and `plan-manage` (plus any suite found by the grep) through `t.sh`. Expected: all PASS. Take "after" screenshots into `phase2/after/task1/`.

### Task 2: Per-set history helper, estimated 1RM, exercise series

**Files:**
- Modify `script.js`: new section `/* ---------- Prehľad: série z histórie ---------- */`.
- Modify `confirmFinish()` (new history entries get `endedAt: Date.now()`).
- Test: new `tests/app/insight-data.js` (pure functions in-page).

**Interfaces:**
- Produces:
  - `historyWorkingSets(entry) -> Array<{ set: number, side: 'left'|'right'|null, weight: number, reps: number, rpe: number|null, failure: boolean }>`
    - Only done working sets.
    - Per-set `setWeights`/`setReps`/`sideWeights`/`sideReps`/`sidesDone` are used when present; otherwise `weight × reps` for `setsDone` sets.
    - Returns `[]` for invalid input; never throws.
  - `historyDropSets(entry) -> Array<{ weight, reps }>`: uses the existing `cleanHistoryDrops`.
  - `e1rm(weight: number, reps: number) -> number|null`:
    - Epley `w × (1 + reps/30)`, rounded to 0.5;
    - `reps === 1` → `w`;
    - `null` when `reps < 1`, `reps > 12` or `w <= 0`.
  - `entryIdentity(entry) -> string`: `entry.exId` if built in, else `exerciseIdentity({ name: entry.name })` (the same identity Phase 3 uses).
  - `exerciseSeries(identity) -> Array<{ date, workoutId, e1rm: number|null, topWeight: number|null, volume: number|null, bestSet: { weight, reps }|null, sets: number, assisted: boolean }>`:
    - sorted by date ascending;
    - entries of all plans and all workouts;
    - several entries with the same identity in one workout merge into one point;
    - `volume` = Σ weight × reps of working sets + drops (null when assisted);
    - `e1rm` = best over working sets (null when assisted).
  - `exerciseSummary(identity) -> { bestE1rm, heaviest, bestSet, bestVolume, sessions }`.
  - History entry `endedAt` (number, ms): set only by new finishes. Validated as a finite positive number on read; never required.
- [ ] **Step 1: Write the failing test `tests/app/insight-data.js`.** Use fixtures built in-page (no UI):
  - Plain: 3 sets × 8 @ 100, `setsDone` 3 → 3 sets, `e1rm(100,8)` = 126.5 (100 × 1.2667 = 126.67 → 126.5), volume 2400.
  - Per-set weights `[100,105,110]` and reps `[8,6,4]` with sets 1 and 3 done → sets `[{set:1,w:100,r:8},{set:3,w:110,r:4}]`.
  - Unilateral with `sidesDone {left:[1,2], right:[1]}` and `sideWeights` → 3 sets with sides.
  - Drops listed separately and counted in volume; warm-ups never counted.
  - Assisted entry → `e1rm` and `volume` null; `topWeight` is the least help (same rule as `historyApplySetWeights`).
  - `e1rm(100, 13) === null`, `e1rm(0, 5) === null`, `e1rm(80, 1) === 80`.
  - Identity: the library exercise `bench-press` logged in two plans and in `sk` and `en` names gives one series. A custom "Môj zdvih" and "  môj   ZDVIH " give one series.
  - Junk entries (null, missing arrays, strings in numbers) → `[]`, no throw.
  - `personalRecords()` is unchanged before/after loading the helpers.
  - A finished workout gets a finite `endedAt` within 5 s of now. An old entry without `endedAt` still loads and renders.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `insight-data`, `xp-engine`, `finish-discard`, `drop-sets`, `warmups` and `effort`. Expected: PASS.

### Task 3: Exercise progress sheet

**Files:**
- Modify `script.js`: new section `/* ---------- Prehľad: progres cviku ---------- */`; entry points in the records list rows (`#records-list` render), the history/Calendar exercise lines, the library exercise detail (`renderExerciseSheet`), and the `.btn-ex-progress` item of Task 1's sheet.
- Modify `index.html`: `#modal-ex-progress`.
- Modify `style.css`.
- Test: new `tests/app/ex-progress.js`.

**Interfaces:**
- Consumes: `exerciseSeries`, `exerciseSummary`, `entryIdentity` (Task 2); `openExerciseActions` (Task 1).
- Produces:
  - `openExerciseProgress(identity: string, displayName: string)`.
  - `lineChartSvg(points: Array<{ x: number (ms), y: number }>, opts: { label: string, unit: string }) -> string`.
    - Inline SVG, `viewBox` 0 0 320 140, a single polyline plus dots.
    - Min/max y labels, first/last date labels, Bento token colours via `currentColor`/CSS classes.
    - Returns the empty-state markup when there are fewer than 2 points.
- Decisions:
  - The sheet shows:
    - a summary row of 4 small stats (Best est. 1RM, Heaviest, Best set, Sessions);
    - one chart at a time, switched by 3 pressed-state chips (Est. 1RM / Heaviest / Volume; the chip style from the Phase 1 fix);
    - range chips 3 M / 1 Y / All (default All);
    - the list of past sessions (date, plan name, sets as `100×8 · 105×6`), newest first, at most 20 with "Show more".
  - Assisted exercise: chart chips are Heaviest only (labelled "Help"), with no 1RM or volume.
  - Taps that open the sheet: a record row in `#records-list`, an exercise line in a history entry or Calendar day, a new "Progress" link row in the library detail sheet (inside the existing detail content, not a floating button), and the Task 1 `⋯` item. **No new visible button on exercise tiles.**
- [ ] **Step 1: Write the failing test `tests/app/ex-progress.js`.**
  - With a fixture of 6 bench workouts over 10 weeks:
    - tapping the bench row in Records opens `#modal-ex-progress` with the title "Bench press";
    - the 4 stats are correct (computed with the Task 2 helpers in-page);
    - the chart polyline has 6 points;
    - switching to Volume changes the points;
    - 3 M hides the older points.
  - With 1 session: the empty-state text shows and there's no polyline, NaN or "undefined".
  - Assisted: only the Help chip.
  - Opening from a history line, from the library detail and from `⋯` → the same sheet and identity.
  - Escape and focus return; `isBusy`; `NATIVE_BACK_CLOSE`.
  - Performance: a fixture of 1,000 history entries (5 exercises each) opens the sheet in < 300 ms (`performance.now()` around `openExerciseProgress`), and opening Stats stays < 300 ms.
  - 6 languages, RTL (chart mirrored labels OK, no overflow), light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `ex-progress`, `ex-actions`, `bento-theme`, `bento-parity` and `bento-home`. Expected: PASS.

### Task 4: Sets and volume per muscle group ("Muscles" sheet + one Stats tile)

**Files:**
- Modify `script.js`: new section `/* ---------- Prehľad: svaly ---------- */`; `renderStatsGrid()` (one new tile, `data-go="muscles"`, handled in `bentoGo`).
- Modify `index.html`: `#modal-muscles`.
- Modify `style.css`.
- Test: new `tests/app/muscles.js`.

**Interfaces:**
- Consumes: `historyWorkingSets`, `historyDropSets`, `entryIdentity` (Task 2).
- Produces:
  - `MUSCLE_KEYS = MUSCLE_CODES.concat(['other'])`.
  - `muscleShare(entry) -> { [muscle]: weight }`: library primary 1, each secondary 0.5; custom or unknown → `{ other: 1 }`.
  - `muscleWeek(weekKeyStr) -> { sets: { [muscle]: number }, volume: { [muscle]: number } }`:
    - working sets + drops × share;
    - volume = weight × reps × share;
    - assisted adds sets but no volume;
    - warm-ups never.
  - `muscleTrend(weeks = 8) -> Array<{ week, sets: {...} }>`, oldest first, ending with the current week.
- Decisions:
  - **The Stats tile `Muscles`** (w2, neutral surface, no colour judgement) shows the muscle with the most sets this week as one line (`Chest · 12 sets`), or "No sets this week". It is placed after the Records/Achievements row. Recovery (Task 5) adds a tiny body silhouette to the same tile; no second tile.
  - **The sheet has:**
    - week navigation (‹ This week ›, with no future weeks);
    - horizontal bars per muscle (sets, one decimal), sorted by sets, hiding muscles with 0 except when all are 0;
    - per muscle, an 8-week mini trend (tiny sparkline via `lineChartSvg` in a compact mode, or 8 small bars);
    - total volume (kg) for the week;
    - a short neutral note: counting rule (main muscle 1 set, helper muscles ½) and "Common guidance is about 10–20 sets per muscle per week." No targets, no colours for good or bad.
- [ ] **Step 1: Write the failing test `tests/app/muscles.js`.**
  - Fixture this week: bench 3 sets (chest 1, arms 0.5, shoulders 0.5) and a custom curl 2 sets → chest 3, arms 1.5, shoulders 1.5, other 2.
  - The previous week's workout appears only after "‹".
  - Warm-ups are not counted; drops are counted.
  - Assisted pull-ups add sets to back but 0 volume.
  - The Stats tile reads `Chest · 3 sets`. Exactly one new `.bt` tile was added: the tile count is +1 versus `f9590a9`, asserted by counting.
  - Empty user → "No sets this week", no NaN.
  - The week boundary uses `weekKey` (a Sunday 23:00 workout belongs to the same week as the Stats Week tile counts it).
  - Sheet standard (dialog role, Escape, focus, `isBusy`, back).
  - 6 languages, RTL, light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `muscles`, `bento-home`, `bento-theme` and `bento-parity`. Expected: PASS. `bento-home` may need its tile list extended for the one new tile; that is the only allowed change there.

### Task 5: Muscle recovery map

**Files:**
- Modify `script.js`:
  - new section `/* ---------- Prehľad: zotavenie ---------- */`;
  - the Muscles tile and sheet (map at the top);
  - the Today recommendation area (one-line hint).
- Modify `style.css`.
- Test: new `tests/app/recovery.js`.

**Interfaces:**
- Consumes: `historyWorkingSets`, `muscleShare` (Tasks 2 and 4); `recommendedPlan()`.
- Produces:
  - `entryTime(entry) -> number (ms)`: `endedAt` if valid, else the entry date at 12:00 local; never later than now.
  - `muscleRecovery(now = Date.now()) -> { [muscle in MUSCLE_CODES]: 0..100 }`.
  - `bodyMapSvg(recovery, opts: { size: 'mini'|'full' }) -> string`:
    - an original GymQuest drawing, front and back silhouettes side by side, made of simple rounded shapes, with 7 regions (`data-muscle`);
    - the fill is a token-based scale from `--surface-2` (fresh) to `--accent` (worked) via 4 CSS classes `rec-0..rec-3`;
    - no copied artwork.
  - `recoveryHint() -> string|null`.
- Algorithm (spec + Phase 1 ruling):

```
for each working set (and drop) in entries with entryTime within the last 96 h:
  age = (now - entryTime) / 3.6e6 hours; window = (muscle in ['core','arms']) ? 48 : 72
  if age >= window: skip
  load = share[muscle] * (rpe >= 9 ? 1.25 : 1) * (1 - age / window)
fatigue[muscle] = min(100, Σload * 10)      // 10 weighted sets = 100 %
recovery[muscle] = round(100 - fatigue[muscle])
class: rec-0 ≥ 85 · rec-1 60–84 · rec-2 35–59 · rec-3 < 35
'other' is never in the map
```

- Today hint:
  - The hint is a single muted line under the recommended workout: "Legs still recovering — consider Push" (`{muscle} … {plan}`).
  - It shows only when ≥ 2 of the recommended plan's primary muscles (library rows only) are < 50 %, and some other plan exists whose primary muscles are all ≥ 50 %.
  - It shows at most once per local day; the shown day is stored device-only in localStorage key `gymquest_recovery_hint_day`, not in `state`.
  - It is never shown during a session. The rotation itself is not changed.
- [ ] **Step 1: Write the failing test `tests/app/recovery.js`.**
  - With `now` fixed (pass `now` to `muscleRecovery`):
    - 10 chest sets 1 h ago → chest ≈ 1 (100 − 10 × (1 − 1/72) × 10 → clamped to 0..100; compute in the test from the formula);
    - the same sets 80 h ago → chest 100;
    - arms from those sets (0.5 share, 48 h window) at 47 h → nearly fresh;
    - RPE 9.5 sets weigh 1.25×.
  - An entry without `endedAt`, dated today, at 08:00 local → age 0 (never negative).
  - `bodyMapSvg` has 7 `[data-muscle]` regions with the right `rec-*` classes, and no `other`.
  - The tile shows the mini map; the sheet shows the full map above the bars.
  - Hint:
    - with legs < 50 % and Push fresh, Today shows it once;
    - after a reload the same day it doesn't show again;
    - with the day key cleared it shows again;
    - never during a session;
    - no hint for a new user.
  - `gymquest_recovery_hint_day` is not in the synced payload (the content hash is unchanged).
  - "Estimate" wording is present. 6 languages, RTL (the map isn't mirrored in a way that swaps left/right body sides wrongly: the regions are symmetric), light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `recovery`, `muscles`, `bento-home`, `bento-theme`, `bento-parity` and `tutorial` (the Today area). Expected: PASS.

### Task 6: README, full regression, screenshots, phase commit

**Files:**
- Modify: `README.md`, Features. Add bullets for:
  - the "⋯" exercise actions;
  - the exercise progress sheet and estimated 1RM;
  - the Muscles tile/sheet;
  - the recovery map and hint.

  Update the Phase 1 bullets that mention where buttons are.
- Modify: `claude-code/gym-basics/regression.sh`, adding `run` lines for `ex-actions`, `insight-data`, `ex-progress`, `muscles` and `recovery`.

- [ ] **Step 1: Run the full regression** and compare with `claude-code/gym-basics/baseline/summary.txt` and the Phase 1 results. Expected: nothing worse. Report flakes with both runs.
- [ ] **Step 2: Round trip.**
  - Run `tests/sync/gym-basics-roundtrip.js` on the host (it waits for port 8124).
  - Extend it with one check: a new entry's `endedAt` survives the old builds (v106, v95) unchanged.
  - Expected: PASS.
- [ ] **Step 3: Take "after" screenshots** (light + dark, 390 px, plus one `ar`) into `phase2/after/`. Use the same views as `before/` plus the progress sheet, the Muscles sheet and the Today hint.
  - Look at them side by side with `before/`.
  - The workout tile must look calmer, and Stats must have exactly one new tile.
- [ ] **Step 4: Commit on `gym-basics`.**
