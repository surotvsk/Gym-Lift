# Gym-basics Phase 1 (logging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the plate calculator, warm-up sets with a warm-up ramp, an optional RPE/RIR effort rating, supersets/circuits, and an optional "start rest automatically" setting to the workout screen.

**Architecture:** Everything is client-only in `script.js` / `index.html` / `style.css` (no server, no native code). New per-workout data lives in `state.activeSession` next to the existing `drops`, and only completed values go into history entries as new optional fields. Plan rows gain optional `group` and `warmupRamp` fields. Each feature gets its own new section in `script.js` and `style.css` so the later merge with `main` stays small.

**Tech Stack:** Vanilla JS (globals, Slovak code comments), Bento CSS tokens, Node + headless Chrome test scripts (`tests/sync/lib.js`).

**Spec:** `docs/superpowers/specs/2026-11-10-gym-basics-design.md` (items 1, 3, 4, 5 + auto-rest).

## Global Constraints

- Work only in the worktree `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/gymquest/.claude/worktrees/gym-basics` (branch `gym-basics`). Never touch the main checkout `gymquest/` (another agent is working there), never `main`, never push.
- **Run tests only through the isolation helpers** (a private network namespace, so port 8124 can't clash with the other agent's tests):
  - one suite: `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gym-basics/t.sh tests/app/<suite>.js`
  - full regression: `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gym-basics/regression.sh`
  - Suites needing the local Supabase stack (`tests/sync|social|auth`) run as `runhost` on the host network and wait until port 8124 is free. The stack is Docker project `gqtest` (:54321); if it is down, run `docker start $(docker ps -a -q --filter name=_gqtest)`.
- Do **not** bump `CACHE_VERSION` in `sw.js` or the `?v=` strings.
- Code comments in Slovak, like the surrounding code. Public text (README) in English.
- Every new user-visible string in all six languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar`). Put them in one new dictionary `BASICS_I18N`, merged at startup like `SYNC_I18N`. `verifyI18n()` must report nothing missing. Arabic strings are listed in the phase report for a native check.
- New CSS uses only the Bento tokens (`--bg`, `--surface*`, `--text*`, `--accent`, `--lime`, `--tile-*`, `--ink`) in a new section `/* ===== Gym-basics: zapisovanie ===== */` at the end of `style.css`. Check light and dark mode, 390 px width and RTL.
- Additive data only:
  - New fields: plan rows `group` (string), `warmupRamp` (true or absent); session `warmups`, `warmupsInit`, `setRpe`; history entries `group`, `warmups`, `setRpe`, `sideRpe`; settings `plates`, `effort`; device settings `autoRest`, `lastRestPresetId`.
  - Absence of a field = today's behaviour.
- Warm-up sets and effort ratings never change sets done, XP, records, achievements, streak or the leaderboard.
- Nothing new appears for someone who doesn't use it:
  - Effort is `off` by default and auto-rest is off by default.
  - Warm-up and plate controls sit inside the existing small exercise action row (`.ex-mini`), next to "+ Drop set".
- No existing element id is removed (`tests/app/bento-parity.js`), and all existing suites stay green.
- A feature counts as done only when it works in a real browser: survives a reload, works in all 6 languages, and logs no console errors.

## Review Focus

1. **A superset whose members get reordered, deleted or swapped mid-workout.**
   - Expected: grouping is recomputed from adjacency and never errors.
   - A swapped exercise keeps its slot's group.
   - Pinned in Task 4 (`supersets.js`: reorder breaks adjacency → ungrouped; delete middle of a 3-circuit → the remaining two stay linked; swap keeps the bracket).
2. **Old versions meeting the new fields.**
   - An old version (v106 / Android v95) loads and edits a plan that has `group`/`warmupRamp`, and history that has `warmups`/`setRpe`.
   - Expected: no sync conflict, and XP is unchanged. Nested fields may be dropped only on rows the old version edited.
   - Pinned in Task 6 (`tests/sync/gym-basics-roundtrip.js`).
3. **A unilateral (per-side) exercise with warm-ups, RPE and plates.**
   - Expected: warm-ups are per exercise, not per side.
   - RPE is per side (`sideRpe`).
   - The plate calculator uses the set's weight.
   - Pinned in Tasks 2 and 3.
4. **Assisted exercises** (the number is help, not load).
   - Expected: no plate button and no warm-up ramp button. "+ Warm-up" still works.
   - Pinned in Tasks 1 and 2.
5. **History edit and Undo after finishing.**
   - Editing a past workout (`saveHistoryEdit`) or undoing a finish must keep `warmups`, `setRpe`, `sideRpe` and `group` untouched.
   - Pinned in Task 2 (warm-ups) and Task 3 (RPE).

---

**Before Task 1 (controller):** run `claude-code/gym-basics/regression.sh` once on the untouched branch (`acccd19` = v106 + spec) and keep the log as the baseline in `claude-code/gym-basics/baseline/`.

### Task 1: Plate calculator (+ synced plate settings)

**Files:**
- Modify: `script.js`: new section `/* ---------- Kalkulačka kotúčov ---------- */` after the drop-set section; settings normalisation next to `restPresets` normalisation (~line 10214).
- Modify: `index.html`: new sheet `#modal-plates` next to `#modal-rest`.
- Modify: `style.css`: Gym-basics section.
- Test: `tests/app/plates.js` (new); add `run plates node tests/app/plates.js` to `claude-code/gym-basics/regression.sh`.

**Interfaces:**
- Produces:
  - `PLATE_DEFAULT = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }`. Pairs are unlimited unless counts are set.
  - `plateSettings() -> { bar: number, plates: number[], pairs?: { [kg: string]: number } }`: always valid. Reads `state.settings.plates`, falls back to `PLATE_DEFAULT`.
  - `platePlan(target: number, cfg) -> { perSide: number[], total: number, exact: boolean }`.
    - Greedy, largest plate first, per side, honouring `pairs`.
    - `total` = bar + 2 × Σ perSide = the closest buildable weight ≤ target.
    - When target < bar: `perSide: []`, `total: bar`, `exact: false`.
  - `roundToPlates(weight: number, cfg) -> number` = `platePlan(weight, cfg).total`, but returns 0 when `weight < cfg.bar`.
  - `isBarbellExercise(ex) -> boolean`: library equipment includes `barbell`, or `ex` has no library entry (custom); always false when `isAssisted(ex)`.
  - `openPlateCalc(weight: number)`: opens `#modal-plates` with the target prefilled.

- [ ] **Step 1: Write the failing test `tests/app/plates.js`** (pattern: `tests/app/drop-sets.js`: empty community config, `setLang('en')`, own plan). Checks:
  - `platePlan(100, PLATE_DEFAULT)` → `perSide [25,15]`, `total 100`, `exact true`.
  - `platePlan(101, PLATE_DEFAULT)` → `total 100`, `exact false`.
  - `platePlan(61.25, …)` → `total 60`, `exact false` (0.625 kg plates don't exist).
  - `platePlan(15, …)` → `total 20`, `exact false`.
  - With `pairs: {'25':1,'20':0}`: `platePlan(140)` → `perSide [25,15,10,5,2.5,1.25]` → `total 137.5`.
  - The bench-press tile (library id `bench-press`) shows a `.btn-plates` button. A custom `Curl test` row shows it too. A row marked `assisted: true` does not.
  - Clicking `.btn-plates` on a set with weight 82.5 opens `#modal-plates`: the input value is `82.5` and the per-side text is `25 · 5 · 1.25`.
  - Changing the bar to 15 in the sheet updates the result live and persists to `state.settings.plates.bar === 15` after a reload.
  - `state.settings.plates` is not in `DEVICE_SETTING_KEYS`.
  - All 6 languages render the sheet title without a missing key, `ar` has `dir=rtl`, there's no horizontal overflow at 390 px in light or dark mode, and no console errors.
- [ ] **Step 2: Run it.** `…/t.sh tests/app/plates.js`. Expected: FAIL (`platePlan is not defined`).
- [ ] **Step 3: Implement.**
  - The functions above.
  - Normalisation in the state loader: invalid `plates` is deleted; it never throws.
  - The `.btn-plates` button (label `t('plates.button')`) sits in `.ex-mini` next to the drop-set block. It opens with the exercise's working weight (`effectiveSetWeight(ex, last set index)`).
  - The sheet has:
    - a target weight input,
    - bar chips 20 / 15 / 10 / custom input,
    - plate toggles (tap to include/exclude a plate size),
    - a per-side result and a simple drawing (inline SVG rectangles sized by kg),
    - "Closest possible: X kg" when not exact.
  - Saving changes writes `state.settings.plates` with `saveState()`.
- [ ] **Step 4: Run it.** Expected: PASS, then run `bento-parity.js` and `bento-theme.js` through `t.sh`: PASS.

### Task 2: Warm-up sets and warm-up ramp

**Files:**
- Modify: `script.js`:
  - new section `/* ---------- Rozcvičkové série ---------- */` after the plate section;
  - `historyExerciseEntry()` (call `historyApplyWarmups`);
  - the history/calendar line builders next to `historyDropsHtml` (append `historyWarmupsHtml`);
  - `buildExerciseBlock()` (render warm-ups before `.sets`);
  - the plan editor row (`renderEditPanel`, `.edit-row`): a "Warm-up ramp" toggle.
- Modify: `style.css`.
- Test: `tests/app/warmups.js` (new) + regression line.

**Interfaces:**
- Consumes: `isBarbellExercise(ex)`, `plateSettings()`, `roundToPlates(w, cfg)` (Task 1).
- Produces:
  - `WARMUP_MAX = 6`.
  - Session `sess.warmups[exerciseSessionKey(ex)] = [{ w: number, r: number, done: boolean }]`.
  - `sessionWarmups(ex) -> array`, `addWarmup(ex) -> boolean`, `updateWarmup(ex, i, patch) -> boolean`, `removeWarmup(ex, i)`.
  - `warmupRamp(ex, workingWeight: number) -> [{ w, r }]`.
  - `applyWarmupRamp(ex) -> boolean`: replaces only the not-done warm-ups.
  - `historyApplyWarmups(entry, ex)`: writes `entry.warmups = [{ weight, reps }]` for done warm-ups only; omitted when there are none.
  - `cleanHistoryWarmups(e) -> array|null`, `historyWarmupsText(e) -> string`, `historyWarmupsHtml(e, tag) -> string`.
- Ramp algorithm (spec):

```
barbell: cfg = plateSettings(); steps = [[cfg.bar,10],[0.4W,5],[0.6W,3],[0.8W,2]] → w = roundToPlates(x, cfg) (bar row = cfg.bar)
dumbbell (library equipment includes 'dumbbell'): w = floor(x/2)*2 ; other: w = floor(x)
drop rows with w <= 0, w >= W, or w < cfg.bar (barbell); drop a row whose w equals the previous row's w
assisted or W <= 0 → [] (the "Warm-up ramp" button is hidden; "+ Warm-up" stays)
```

- [ ] **Step 1: Write the failing test `tests/app/warmups.js`.** Checks:
  - `warmupRamp(bench row, 100)` → `[{w:20,r:10},{w:40,r:5},{w:60,r:3},{w:80,r:2}]`.
  - `warmupRamp(bench, 40)`: every `w` is `< 40` and `≥ 20`, the list is strictly increasing, every `w` is buildable (`platePlan(w).exact`), and the first row is `{w:20,r:10}`.
  - Dumbbell row at 30 → weights `[12, 18, 24]` (each a multiple of 2).
  - An assisted row → `[]`, and its tile has no `.btn-warmup-ramp`.
  - "+ Warm-up" adds a row labelled `W1` above the S1 pill. Its default weight is 50 % of the working weight, rounded like the ramp; its reps are 5.
  - Weight and reps are editable; it can be toggled done and removed; the 7th add is refused.
  - Warm-ups survive a reload.
  - After finishing with 2 done warm-ups and 1 not-done warm-up:
    - `entry.warmups` has length 2.
    - `historyDoneSets(entry)` equals the working sets only.
    - XP (`historyEntryXp`) equals the same workout without warm-ups.
    - `personalRecords()` is unchanged by a warm-up heavier than the working weight.
    - History and Calendar show `Warm-up: 20 kg × 10 · 40 kg × 5`.
  - Editing that history entry (`saveHistoryEdit`) keeps `warmups`.
  - Plan row toggle `warmupRamp` on: starting a new session fills the ramp automatically once (`sess.warmupsInit[key] === true`). Removing all warm-ups and re-rendering doesn't refill them.
  - A unilateral row has one warm-up list (not per side).
  - 6 languages, RTL, 390 px, light and dark, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Warm-up rows render as a `.warmups` block before `.sets`, styled lighter: `--text-2` and an outline square. They use the classes `.warmup-item`, `.warmup-label`, `.warmup-weight`, `.warmup-reps`, `.warmup-done` and `.warmup-remove`.
  - Add the buttons `.btn-add-warmup` and `.btn-warmup-ramp` to `.ex-mini`.
  - The ramp auto-fill runs in `buildExerciseBlock` when `ex.warmupRamp === true`, a session exists, and `!sess.warmupsInit[key]`.
  - Warm-ups of a swapped-out exercise stay with that exercise's key (same as drops).
- [ ] **Step 4: Run it, plus `drop-sets.js`, `set-weights.js`, `xp-engine.js`, `finish-discard.js`.** Expected: all PASS.

### Task 3: Effort rating (RPE / RIR)

**Files:**
- Modify: `script.js`:
  - new section `/* ---------- Námaha série (RPE / RIR) ---------- */`;
  - `historyExerciseEntry()`;
  - the history line builders;
  - `buildSetItem()` (effort chip on done sets).
- Modify: `index.html`: Settings sheet, a new card "Effort rating" with 3 chips (Off / RPE / RIR) after the rest-sound card; a picker sheet `#modal-effort`.
- Test: `tests/app/effort.js` (new) + regression line.

**Interfaces:**
- Produces:
  - `effortMode() -> 'off'|'rpe'|'rir'` (from `state.settings.effort`; anything invalid → `'off'`).
  - `setEffortMode(mode)`.
  - Session `sess.setRpe[setSessionKey(ex,i,side)] = number` (6–10, step 0.5).
  - `setSetRpe(ex, i, side, rpe|null)`, `getSetRpe(ex, i, side) -> number|null`.
  - `effortText(rpe) -> string`:
    - RPE mode → `'RPE 8.5'`, using the locale decimal separator via `toLocaleString(currentLang())`;
    - RIR mode → `'RIR ' + (10 - rpe)`, shown as `4+` when `10 - rpe >= 4`, and with `.5` kept.
  - History `entry.setRpe: (number|null)[]` (length = sets), or for unilateral `entry.sideRpe: { left: [], right: [] }`. Omitted when nothing was rated.
  - The picker values: RPE `[6,6.5,…,10]`; RIR `0,1,2,3,4+` → stored RPE `10,9,8,7,6`.

- [ ] **Step 1: Write the failing test `tests/app/effort.js`.** Checks:
  - By default there is no `.set-effort` anywhere and the setting reads Off.
  - Switching to RPE:
    - A done set shows a `.set-effort` chip with text `RPE`; a not-done set shows none.
    - Tapping the chip opens `#modal-effort` with 9 RPE options. Picking 8.5 makes the chip read `RPE 8.5`. In `fr` it reads `RPE 8,5`.
    - Switching to RIR, the same set reads `RIR 1.5` (`RIR 1,5` in `fr`).
    - The value survives a reload.
    - Un-marking the set keeps the rating hidden but stored. Re-marking shows it again.
  - Finish: `entry.setRpe` → `[8.5, null, null]` for a 3-set row with one rated set.
  - Unilateral: rating the left side of set 1 → `entry.sideRpe.left[0] === 9`, and `entry.setRpe` is absent.
  - XP and `historyDoneSets` are identical with and without ratings.
  - The history line shows `RPE 8.5` / `RIR 1.5` following the setting.
  - `saveHistoryEdit` keeps `setRpe`.
  - `state.settings.effort` syncs (it is not in `DEVICE_SETTING_KEYS`).
  - 6 languages, RTL, 390 px, light and dark, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Normalise `state.settings.effort` in the loader.
- [ ] **Step 4: Run it, plus `set-reps.js` and `confirm-labels.js`.** Expected: all PASS.

### Task 4: Supersets and circuits

**Files:**
- Modify: `script.js`:
  - new section `/* ---------- Supersérie a okruhy ---------- */`;
  - the plan editor rows (`renderEditPanel`): a "Link with next" / "Unlink" button per row;
  - the plan-save path: normalise groups;
  - `renderTrening()`: wrap the blocks of a group;
  - `historyExerciseEntry()`: copy `group`;
  - the history renderers: bracket/label;
  - the set-done click handler: focus the next member.
- Modify: `style.css`.
- Test: `tests/app/supersets.js` (new) + regression line.

**Interfaces:**
- Produces:
  - Plan row `group: string` (e.g. `'g' + Date.now().toString(36)`).
  - `normalizeGroups(exercises: array) -> boolean (changed)`: removes `group` from rows that don't sit in an adjacent run of ≥ 2 rows with the same group; mutates in place.
  - `supersetInfo(plan) -> Map<rowIndex, { label: 'A'|'B'|…, pos: number, size: number, kind: 'superset'|'circuit' }>`. Labels go in order of appearance; `kind` = `circuit` when `size >= 3`.
  - `linkWithNext(planDraftRows, i)`, `unlinkRow(planDraftRows, i)`.
  - `nextInGroup(plan, rowIndex) -> rowIndex|null` and `isLastInGroup(plan, rowIndex) -> boolean` (true for ungrouped rows).
  - History entries keep `group` (string) for display. A history group renders only for adjacent entries.

- [ ] **Step 1: Write the failing test `tests/app/supersets.js`.** Checks:
  - In the plan editor, linking row 0 with row 1 → both rows have the same `group`, and the editor shows a bracket labelled `Superset A`. Linking row 1 with row 2 → all three share the group, and the label reads `Circuit A`.
  - Unlinking a row clears it (`normalizeGroups` removes a left-over single member).
  - Dragging row 2 away so the run breaks → ungrouped where not adjacent.
  - Deleting the middle row of a 3-circuit → the remaining 2 rows are still linked (they become adjacent).
  - In a workout, a `.superset` wrapper contains exactly the grouped `.exercise` blocks with the label.
  - Completing set 1 of member 1 scrolls/focuses set 1 of member 2: `document.activeElement` is inside member 2's first `.set-btn`.
  - Swapping member 1 mid-workout keeps the replacement inside the wrapper.
  - Finish → history entries carry `group`. History and Calendar show the bracket.
  - XP, sets done and records are unchanged versus the same workout without groups.
  - A plan with no groups renders exactly as before (no `.superset` in the DOM).
  - 6 languages, RTL bracket on the correct side, 390 px, light and dark, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.** Call `normalizeGroups` on every plan save and on state load (it only removes invalid groups).
- [ ] **Step 4: Run it, plus `plan-manage.js`, `bento-parity.js`, `quick-workout.js` and `rest-timer.js`.** Expected: all PASS.

### Task 5: "Start rest automatically" (device setting)

**Files:**
- Modify: `script.js`:
  - `DEVICE_SETTING_KEYS`: add `autoRest` and `lastRestPresetId`;
  - `startTimer()`: remember `presetId` in `state.settings.lastRestPresetId` when given;
  - the set-done handler;
  - Settings wiring.
- Modify: `index.html`: Settings, a switch card under the rest-sound card.
- Test: `tests/app/auto-rest.js` (new) + regression line.

**Interfaces:**
- Consumes: `isLastInGroup(plan, rowIndex)` (Task 4), `startTimer(seconds, presetId)`, `restPresets()`.
- Produces: `maybeAutoRest(plan, rowIndex)`. It starts the timer only when:
  - `state.settings.autoRest === true`,
  - a session is running,
  - the row is last in its group (or ungrouped),
  - and the timer isn't already running.

  The preset is the one with `id === lastRestPresetId`, else the first preset.

- [ ] **Step 1: Write the failing test `tests/app/auto-rest.js`.** Checks:
  - Default off: marking a set done starts no timer (`#timer-bar` stays hidden).
  - On: marking a set of an ungrouped row starts the first preset (60 s by default).
  - After the user starts the 90 s preset once, the next auto start uses 90 s.
  - In a superset, marking member 1 starts nothing; marking member 2 (the last) starts the timer.
  - Un-marking a set never starts the timer.
  - A running timer isn't restarted.
  - `autoRest` and `lastRestPresetId` are not in the uploaded payload: the sync content hash is unchanged after toggling.
  - 6 languages.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, plus `rest-timer.js`.** Expected: PASS.

### Task 6: Old-version round trip, docs, full regression, phase commit

**Files:**
- Create: `tests/sync/gym-basics-roundtrip.js`, modelled on `tests/sync/old-version-roundtrip.js` (same structure; default `GQ_OLD_REFS='f9590a9,821a538'` = v106 and the Android Play build v95).
- Modify: `README.md`: Features list (plate calculator, warm-up sets, effort rating, supersets/circuits, auto rest). Keep the style of the existing bullets.
- Modify: `claude-code/gym-basics/regression.sh`: add `runhost gym-basics-roundtrip node tests/sync/gym-basics-roundtrip.js`.

- [ ] **Step 1: Write the round-trip test.** The new device writes:
  - a plan with a 2-row superset and `warmupRamp: true`,
  - a finished workout with `warmups`, `setRpe`, a unilateral row with `sideRpe`, and `group`,
  - `settings.plates` (`bar: 15`) and `settings.effort: 'rir'`.

  Then it syncs. The old device loads the account, renames a different plan, adds a plain workout, and syncs. The new device re-syncs (including after a restart). Asserts:
  - No conflict.
  - History entries with the new fields are byte-identical.
  - `settings.plates` and `settings.effort` are intact.
  - The superset plan's `group`/`warmupRamp` are intact (the old device didn't edit that plan).
  - Total XP is equal on both devices.
  - The old device's change is present.
- [ ] **Step 2: Run it.** `…/regression.sh` runs it via `runhost` (needs the `gqtest` stack and `GQ_CREDS_DIR` from `test-env.sh`; disposable local account only). Expected: PASS. If an old build drops a field, report exactly which one and stop. That's an owner decision, not a silent fix.
- [ ] **Step 3: Full regression.** `…/claude-code/gym-basics/regression.sh`. Expected: every suite reports 0 failed. Compare against the baseline run on `f9590a9` before Task 1; a suite failing on both is pre-existing and is reported, not fixed here.
- [ ] **Step 4: Screenshots.**
  - Take light and dark shots at 390 px of: the plate sheet, a warm-up block, an effort chip and picker, a superset in the workout and in the editor, and the auto-rest setting.
  - Save them to `claude-code/gym-basics/phase1/` (outside the repo).
- [ ] **Step 5: Commit on `gym-basics` only.**

```bash
git -C /home/Surotvsk/Documents/gymquest-backup-2026-10-10/gymquest/.claude/worktrees/gym-basics add -A script.js index.html style.css README.md tests/app/plates.js tests/app/warmups.js tests/app/effort.js tests/app/supersets.js tests/app/auto-rest.js tests/sync/gym-basics-roundtrip.js docs/superpowers/plans/2026-11-10-gym-basics-phase1-logging.md
git -C …/gym-basics commit -m "Gym-basics phase 1: plate calculator, warm-up sets, RPE/RIR, supersets, auto rest"   # + attribution lines
```
