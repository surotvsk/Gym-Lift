# Gym-basics Phase 4 (coaching: suggestions + programs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GymQuest suggests the next weight and reps for each exercise from your last session, using simple rules it explains. It also offers ready-made multi-week programs with deload weeks that run on ordinary plans.

**Architecture:**
- **Suggestions** come from one pure function. It reads the last session of the same plan (via `historyWorkingSets`, Phase 2) and the effort ratings (Phase 1). The workout shows it only as a small chip inside the existing comparison line of each exercise tile. Tapping the chip opens a tiny sheet with the reason and a "Use" button.
- **Programs** are static data. Starting one creates ordinary custom plans whose rows carry a `progRow` tag, and stores `state.program`.
  - Each week's prescription (sets, reps and, for the strength wave, %TM weights) is applied to the session snapshot when a workout of a program plan starts. Plans are never rewritten.
  - The Today and Workout screens show "Week n of N" by appending to an existing meta line. No new tiles except one "Programs" action tile in the Workout plan picker.

**Tech Stack:** Vanilla JS (globals, Slovak comments), Bento tokens, headless Chrome test scripts.

**Spec:** `docs/superpowers/specs/2026-11-10-gym-basics-design.md` (items 8 and 9). Owner rules: clean, uncluttered UI; all six languages.

## Global Constraints

- **Never automatic.** A suggestion changes nothing until the user taps "Use". Program prescriptions change only the session (snapshot), never the plan rows. The user can still edit any set.
- **XP, records and streak.** Program workouts are normal workouts: they get normal XP, records and streak credit. Suggestions never change XP rules.
- **Clean UI (owner):**
  - **Suggestions:** at most one small chip per exercise tile, inside the existing `.compare-hint` line. No new rows.
  - **Programs:** one new "Programs" action tile in the Workout plan picker, and nothing new on Today. "Week n of N" (or "Deload week") is appended to existing text.
  - **Sheets:** new sheets follow the Phase 1–3 sheet standard (dialog role, Escape chain, focus in/restore, `isBusy`, `NATIVE_BACK_CLOSE`, 44 px targets, aria-pressed chips).
- **Device setting** "Show suggestions" (`settings.showSuggestions`, default on). Add it to `DEVICE_SETTING_KEYS`. It is one switch card in Settings.
- **Synced data:**
  - `state.program` (top-level, additive) is synced.
  - The plan-row field `progRow` (string) is additive.
  - Old versions keep `state.program`, but they may drop `progRow` when they edit a row. A row without `progRow` is simply not prescribed.
  - The session snapshot entry may gain `sets`/`reps` (the session is device-only).
- **Content:** programs use library exercises only (the existing 50). Programs are named generically, never after a person or brand. The builder drafts the content in the plan's shape, and the owner reviews it via screenshots before the merge.
- **Repo and git:**
  - Work only in the worktree `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/gymquest/.claude/worktrees/gym-basics` (branch `gym-basics`). Never touch `main`, never push.
  - Commit per task on `gym-basics`, ending with the attribution lines. Never `git add -f` anything under `.superpowers`.
  - No `CACHE_VERSION` / `?v=` bump.
- **Tests:**
  - Run app suites only via `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gym-basics/t.sh tests/app/<suite>.js`.
  - The round trip runs on the host (`source …/local-preview/test-env.sh`, then wait until port 8124 is free).
  - Full regression: `claude-code/gym-basics/regression.sh`.
- **Style:** Slovak code comments. Strings go in `BASICS_I18N` in all six languages, with `tPlural` for counts. CSS goes in a new section `/* ===== Gym-basics: koučing ===== */`, using Bento tokens only.

## Review Focus

1. **No usable last session:**
   - an exercise new to this plan;
   - only warm-ups were done;
   - an assisted exercise;
   - a custom exercise without library data;
   - an imported workout (imports are excluded from suggestions, since suggestions read the same plan's real history).

   Expected: no chip, or a correct "less help" chip for assisted. Never NaN or a 0 kg suggestion. Pinned in Task 1.
2. **Unilateral and per-set weights in the last session:** expected to compare per side, with the step based on the working weight, i.e. the top set's weight. Pinned in Task 1.
3. **Program week maths across the calendar:**
   - starting mid-week;
   - DST;
   - "Repeat this week" / "Skip ahead";
   - after the last week, with a calm "Program finished" state;
   - deleting a program plan.

   Expected: never crashes, and the week is clamped to 1..N. Pinned in Task 3.
4. **A program workout started, then the plan edited mid-session, or a row without `progRow`:** expected: the session keeps its snapshot, and unprescribed rows behave as today. Pinned in Task 5.
5. **Strength-wave weights:** training max missing or 0, rounding to the plate set, and assisted or dumbbell lifts in the wave. Expected: a TM is asked for at start (prefilled 1.1 × the plan weight), weights are rounded via `roundToPlates` (barbell) or 2.5 kg steps, and there is never a weight below the bar. Pinned in Tasks 3 and 5.

---

### Task 1: Suggestion engine (pure)

**Files:**
- Modify `script.js`: new section `/* ---------- Koučing: návrh váhy ---------- */`.
- Test: new `tests/app/suggest.js`.

**Interfaces:**
- Consumes:
  - `previousWorkoutFor(ex, beforeDate, planId)` (existing, same plan);
  - `historyWorkingSets(entry)`, `historyEntryAssisted(e)`, `isAssisted(ex)`, `libraryEntry`, `builtinExerciseId`;
  - `isBarbellExercise`, `plateSettings`, `roundToPlates` (Phase 1).
- Produces:
  - `suggestStep(ex) -> number`: 5 when the library `primary` is `legs` or `glutes`; 2 for library equipment `dumbbells`; otherwise 2.5. Custom exercises get 2.5.
  - `suggestNext(ex, planId, today = todayISO()) -> null | { kind: 'up'|'up2'|'keep'|'reset'|'lessHelp'|'keepHelp'|'moreHelp', weight: number, reps: number, reasonKey: string, vars: object }`.
- Rules (spec item 8):
  1. Let `last` be `previousWorkoutFor(ex, today, planId)`. If it is missing or has no working sets, return null.
  2. `planned` = `ex.reps`. `sets` = the working sets of `last`. `top` = the maximum working weight in `last` (the minimum for assisted).
  3. `hit` = the number of planned sets done, with every done set's reps ≥ `planned`.
  4. `rpeAvg` = the average of the rated sets, or null.
  5. Not assisted, evaluated in this order (first match wins):
     1. If the last two sessions of this plan were both short of reps (not `hit`), suggest `reset`: `top × 0.9`, rounded down to the step.
     2. If not `hit`, or `rpeAvg` ≥ 9.5, suggest `keep`: `top`.
     3. If `rpeAvg` is not null and ≤ 7, suggest `up2`: `top + 2·step`.
     4. Otherwise suggest `up`: `top + step`.
  6. Assisted: the same conditions, but the help moves down (`lessHelp`: `top − step`, never below 0), stays (`keepHelp`), or moves up on a reset (`moreHelp`, help × 1.1 rounded up).
  7. Rounding: barbell → `roundToPlates` (never below the bar); otherwise round to the step. The result is never NaN and is ≥ 0.
  8. `reps` = `planned`.
- [ ] **Step 1: Write the failing test `tests/app/suggest.js`.** Build fixtures in-page through real finishes or direct history entries with `planId`.
  - **Barbell bench:** last session 3×5 at 100, all reps hit, no RPE → `up` to 102.5. With RPE 7 → `up2` to 105.
  - **Short of reps:** 5,5,4 → `keep` 100. Two short sessions in a row → `reset` to 90.
  - **Step sizes:** legs (squats) step 5; a dumbbell exercise step 2; a custom exercise step 2.5.
  - **Assisted pull-ups at help 30, hit:** `lessHelp` to 27.5.
  - **Unilateral:** both sides must hit.
  - **Per-set weights** `[100,105,110]`: `top` is 110.
  - **Warm-ups** are ignored.
  - **Returns null when:** the exercise is new to the plan; the only workout is imported (imports are not in `state.history`); the entry is junk. Never throws.
  - Plates rounding: a 15 kg bar with an odd target rounds down to buildable. The result is never below the bar.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `suggest`, `insight-data` and `xp-engine`. Expected: PASS.

### Task 2: Suggestion chip + "why" sheet + setting

**Files:**
- Modify `script.js`: the `buildExerciseBlock` compare-hint line; a new section for the sheet; settings wiring.
- Modify `index.html`: `#modal-suggest`; a Settings switch card under the effort card.
- Modify `style.css`.
- Test: new `tests/app/suggest-ui.js`.

**Interfaces:**
- Consumes: `suggestNext` (Task 1); `setSetWeight(ex, index, kg, side)` and `setSetReps` (existing); `effectiveSetWeight`; `cleanSetWeightValue`.
- Produces:
  - `suggestionsOn()`. It is device-only and defaults to on.
  - `applySuggestion(ex, s)`: sets the weight of every NOT-done working set of that exercise in the session, from the first not-done set onward and per side for unilateral. Done sets are untouched. Plan rows are untouched, and weight memory follows existing behaviour for set-weight edits.
  - `openSuggestSheet(ex, s, opener)`.
- Decisions:
  - The chip sits inside `.compare-hint` (`.sugg-chip`). It reads `Try 102.5 kg` / `Keep 100 kg` / `Reset 90 kg` / `Less help 27.5 kg`, has a 44 px tap area, and is muted.
  - The chip shows only in a running session and when the suggestion differs from the current working weight of the first not-done set. It is hidden once all sets are done.
  - The sheet shows one plain sentence (e.g. "Last time you did all 3×5 at 100 kg. Next step: +2.5 kg."), a "Use 102.5 kg" button and a close button.
  - With a program active, Task 5 changes the chip text. This task's chip code must accept a `program` reason.
- [ ] **Step 1: Write the failing test `tests/app/suggest-ui.js`.**
  - The chip appears for the bench fixture and is absent for a new exercise.
  - Tapping it opens the sheet with the reason. "Use" sets the not-done sets to 102.5 and leaves done sets unchanged. The plan row weight is unchanged.
  - With the setting off, there is no chip.
  - The setting is device-only: the sync content hash is unchanged when it is toggled.
  - The chip is hidden after all sets are done.
  - Sheet standard. 6 languages, RTL, light and dark at 390 px, no console errors.
  - **Clean-UI check:** the tile height is unchanged with versus without the chip.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `suggest-ui`, `suggest`, `ex-actions`, `set-weights`, `bento-parity`, `bento-theme`. Take screenshots into `claude-code/gym-basics/phase4/after/task2/`.

### Task 3: Program data + week engine (pure)

**Files:**
- Modify `script.js`: new section `/* ---------- Koučing: programy (dáta a týždne) ---------- */`.
- Test: new `tests/app/program-engine.js`.

**Interfaces:**
- Produces:
  - `PROGRAMS`: an array of program objects. Names and descriptions are i18n keys, and the day plans use library exercise ids.

```
{ id, nameKey, descKey, level: 'beginner'|'intermediate', daysPerWeek, weeks, variants?: [{ id, daysPerWeek }],
  deloadWeeks: number[], kind: 'linear'|'wave',
  days: [{ id, nameKey, rows: [{ exId, sets, reps, progRow }] }]   // per variant if variants
}
```

  - Content: the builder drafts it, following spec item 9.
    - **Beginner full body:** 3 days a week for 8 weeks, alternating days A and B, with no deload.
    - **Push / Pull / Legs:** two variants. The 3-day variant does each day once a week; the 6-day variant does each twice. 8 weeks, deload in week 8.
    - **Upper / Lower:** 4 days a week for 8 weeks, deload in week 8.
    - **Strength wave (5s / 3s / 1s):** 4 days a week, 4-week waves (8 weeks = 2 waves). Each day has 1 main lift (squat, bench, deadlift, overhead press) and 2–3 assistance exercises.
  - `programWeek(prog: state.program, today = todayISO()) -> { week: 1..N, total: N, deload: boolean, finished: boolean }`.
    - The week is counted by local calendar weeks (`weekKey`) since `prog.startedAt`, plus `prog.weekShift` (repeat → −1, skip → +1). It is clamped to 1..N.
    - `finished` is true when the raw week is greater than N.
  - `programPrescription(prog, planId, row) -> null | { sets, reps, weight?: number, deload: boolean, pctLabel?: string }`.
    - The row is matched by `row.progRow`.
    - Linear programs: sets and reps from the day template. In a deload week: sets = max(1, ceil(sets × 0.6)) and weight × 0.6 of the current plan weight, rounded down to the step or plates.
    - Wave, main lift: from `prog.tm[exId]` with the spec percentages:
      - week 1: 3×5 at 65/75/85 %;
      - week 2: 3×3 at 70/80/90 %;
      - week 3: 5/3/1 at 75/85/95 %;
      - week 4: deload at 40/50/60 %.
      - Per-set weights are returned as `setWeights: number[]` and `setReps: number[]`, rounded via `roundToPlates` (barbell), never below the bar.
    - Wave, assistance rows: as linear.
  - `startProgramState(programId, variantId, tm, planIdsByDay) -> state.program` object:

    ```
    { id, variant, startedAt: 'YYYY-MM-DD', weekShift: 0, plans: { [dayId]: planId }, tm?: { [exId]: kg }, endedAt?: null }
    ```

  - `cleanProgramState(raw) -> object|null`: never throws.
- [ ] **Step 1: Write the failing test `tests/app/program-engine.js`.**
  - **Content validity.**
    - Every program's rows reference existing library ids, and every `progRow` is unique within its program.
    - `daysPerWeek` matches the number of days (per variant).
    - Every `nameKey` exists in all 6 languages.
  - **Week maths.**
    - Start on a Wednesday: the same week is week 1, the next Monday is week 2.
    - A DST weekend doesn't change the count.
    - repeat/skip shift the week.
    - Week 9 of 8 is `finished`, and the week is clamped to 8.
  - **Prescriptions.**
    - Linear deload week 8 for PPL: 3 sets becomes 2 sets, and 100 kg becomes 60 kg.
    - Wave week 3 main lift, TM 100: setWeights [75, 85, 95] and setReps [5, 3, 1], rounded to plates.
    - TM missing → null weight (the caller asks for a TM).
    - Assistance rows in the wave are linear.
  - **Robustness:** junk `state.program` → `cleanProgramState` returns null, and `programWeek` / `programPrescription` never throw.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. In the report, list the full drafted program content as a readable table for the owner's review.

### Task 4: Programs UI (browse, start, manage, finish)

**Files:**
- Modify `script.js`: new section `/* ---------- Koučing: programy (UI) ---------- */`; the Workout plan picker action tiles; the Today next-up meta line and the Workout session label (append "Week n of N" / "Deload week"); state normalisation (`cleanProgramState` on load).
- Modify `index.html`: `#modal-programs` (list → detail → start steps inside one sheet).
- Modify `style.css`.
- Test: new `tests/app/programs-ui.js`.

**Interfaces:**
- Consumes: Task 3. Existing plan creation helpers (grep how the Full Body builder creates a custom plan: `state.plans[id] = …`, `state.planOrder`). Weekly goal setter (grep `setWeeklyGoal` / the settings goal chips; `GOAL_MIN`/`GOAL_MAX`).
- Produces:
  - `openPrograms(opener)`, `startProgram(programId, variantId, tm)`, `repeatProgramWeek()`, `skipProgramWeek()`, `endProgram()`.
  - `startProgram`:
    - Creates one custom plan per day, named e.g. "PPL · Push". User-entered names are never rewritten later.
    - Rows are library exercises with sets, reps and `progRow`. The weight is taken from `settings.exerciseMemory` if known, else 0.
    - Adds the plans to `planOrder` in day order and sets `state.program`.
    - If the weekly goal differs from `daysPerWeek`, a confirmation in the current language offers to change it. Changing it affects the streak target from now on, so confirmation is required.
    - Wave programs ask for the 4 training maxes. Each is prefilled with 1.1 × the remembered weight of that lift, or empty. Start is disabled until all are > 0.
- Decisions:
  - The "Programs" tile goes in the Workout plan-picker tiles (`.tr-tiles`), next to New plan / Exercise library / Full Body builder. One tile.
  - The sheet has three views:
    - **List:** program cards with level, days/week and length.
    - **Detail:** one-line description, week-by-week outline (e.g. "Weeks 1–7: build · Week 8: deload"), the day plans and their exercises, and a Start button (with a variant chip for PPL).
    - **Active-program view:** shown instead of the list when `state.program` is active. It has "Week 3 of 8", "Repeat this week", "Skip ahead" and "End program" (with confirmation). Ending never deletes plans or history.
  - Today next-up and the Workout session label append " · Week 3/8" or " · Deload week" when the plan belongs to the active program. No new line.
  - When the program is finished, the active view says "Program finished 🎉" with "Start again" and "End".
  - Deleting a program plan: the program simply has no plan for that day, and the view shows the day as removed.
- [ ] **Step 1: Write the failing test `tests/app/programs-ui.js`.**
  - Exactly one new tile in the Workout picker.
  - Open → list of 4 programs → PPL detail with the 3/6 variant chips → Start 3-day:
    - 3 plans are created with `progRow` rows and in day order;
    - `state.program` is set;
    - the goal confirmation appears when the goal ≠ 3, and on OK the goal becomes 3;
    - the change survives a reload.
  - Today next-up shows " · Week 1/8".
  - Repeat / skip change the week label. End (confirmed) clears `state.program` and the plans remain.
  - Strength wave: Start is disabled until the TMs are entered, and they are prefilled from memory.
  - The finished state appears when the week is > N (simulate via `startedAt`).
  - XP and history are unchanged by starting or ending a program.
  - Sheet standard. 6 languages, RTL, light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `programs-ui`, `program-engine`, `plan-manage`, `plan-names`, `bento-home`, `bento-parity`, `bento-theme`, `tutorial`. Take screenshots into `phase4/after/task4/`.

### Task 5: Session integration (prescription in the workout)

**Files:**
- Modify `script.js`: `ensureSession` (snapshot gains `sets` / `reps` / `setWeights` / `setReps` for prescribed rows); `sessionSnapshotExercise` (applies them); `sessionSetCount` and the set value readers (prefer snapshot values); the suggestion chip (program reason); `historyExerciseEntry` (unchanged semantics — records what was done).
- Test: new `tests/app/program-session.js`.

**Interfaces:**
- Consumes: `programPrescription`, `programWeek` (Task 3); `suggestNext` and the chip (Tasks 1–2).
- Decisions:
  - The prescription is captured once, at session start, into the snapshot. Mid-session plan edits or week changes don't alter a running session.
  - Snapshot per-set weights apply only to sets the user hasn't edited (the user's edits win, as today).
  - Old sessions without the new snapshot fields behave as before.
  - With an active program row, the suggestion chip shows the program target ("Program: 3×5 @ 75 kg" or "Deload: 60 kg"). Its sheet explains the week ("Week 3 of the wave: 5/3/1 at 75/85/95 % of your 100 kg training max"). "Use" applies the program weights to the not-done sets, the same way `applySuggestion` does.
  - Linear programs, non-deload weeks: there is no program weight. The normal suggestion (Task 1) shows, and the chip may say "Program: 3×8 · Try 62.5 kg".
- [ ] **Step 1: Write the failing test `tests/app/program-session.js`.**
  - Start a PPL program; in week 1 start Push:
    - the session sets and reps equal the template;
    - the plan rows are unchanged.
  - Simulate week 8 (deload): sets reduced, weights 60 %, and the chip reads Deload.
  - Strength wave, week 3, TM 100:
    - the main lift shows 3 sets with weights 75/85/95 and reps 5/3/1;
    - finishing records exactly those values in history;
    - XP is computed normally (3 sets).
  - A plan edit mid-session doesn't change the running session.
  - A row without `progRow` behaves as before.
  - A user-edited set weight is kept when re-rendering.
  - The previous suggest-ui and set-weights suites still pass.
  - 6 languages, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `program-session`, `programs-ui`, `suggest-ui`, `set-weights`, `set-reps`, `add-set`, `warmups`, `supersets`, `finish-discard`, `xp-engine`. Take screenshots into `phase4/after/task5/`.

### Task 6: Round trip, README, regression, screenshots, commit

- [ ] **Step 1: Extend `tests/sync/gym-basics-roundtrip.js`.**
  - The new device starts a program, which adds `state.program` and plans with `progRow`.
  - The old builds (v106, v95) load it, edit an unrelated plan, and sync.
  - Assert that `state.program` is identical (canonical), that the program plans' `progRow` are intact (the old device didn't edit them), and that XP is equal (v106 exact; v95 strip-control also strips `program`/`progRow`).
  - Also assert that `showSuggestions` is not uploaded.
  - Run it on the host.
- [ ] **Step 2: Update the README.** Features: suggestions (rules in one sentence; never automatic; setting) and programs (the list, deload, week controls, "plans stay ordinary", goal confirmation).
- [ ] **Step 3: Run the full regression** and compare it with the baseline. Expected: nothing worse.
- [ ] **Step 4: Take screenshots** (light, dark and ar, 390 px) into `phase4/after/final/`:
  - a workout tile with the chip;
  - the suggestion sheet;
  - the Programs list, detail and active view;
  - Today with " · Week 1/8";
  - a deload session.

  Look at them for calm.
- [ ] **Step 5: Commit on `gym-basics`.**
