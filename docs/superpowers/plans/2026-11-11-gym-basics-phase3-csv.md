# Gym-basics Phase 3 (CSV export + Strong/Hevy import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can export their workouts as a CSV that other apps read, and import their history from Strong or Hevy. Imported workouts appear in history, the Calendar, exercise charts, Muscles and recovery, but never give XP, levels, streak or weekly-goal credit, achievements, personal records or leaderboard score.

**Architecture:**
- **Storage.** Imported workouts live in a separate top-level array `state.importedHistory`, not in `state.history`. Every existing derived calculation (XP, streak, goal, achievements, `personalRecords()`, leaderboard payload, Stats counters, last-time comparison, rotation, weight memory) reads `state.history`, so they stay untouched by construction.
- **Readers.** Only the insight readers (Phase 2) and the history/Calendar views are taught to read both arrays, through one helper.
- **Entry shape.** Imported entries use the same workout and exercise entry shape as real history, so `historyWorkingSets` and the rest work unchanged.
- **CSV module.** CSV parsing and writing are pure functions in their own `script.js` sections.
- **Settings.** One "CSV (Strong / Hevy)" entry in Settings → Data opens a sheet with Export and Import, which keeps the UI clean.

**Tech Stack:** Vanilla JS (globals, Slovak comments), Bento tokens, headless Chrome tests (`tests/sync/lib.js`), with CSV fixtures in `tests/fixtures/csv/`.

**Spec:** `docs/superpowers/specs/2026-11-10-gym-basics-design.md` (item 7). Owner decision 2026-11-10: imported = history + charts only. Owner rule 2026-11-10: clean, uncluttered UI.

## Global Constraints

- **Imported workouts never count** for XP, level, streak or weekly-goal credit, achievements, `personalRecords()`, the leaderboard payload, the Stats Week/Month/All counters, the Today "This week" tile, the last-time comparison, the plan rotation or exercise weight memory. Prove it by test with a large imported set present.
- **Imported workouts do count** for exercise charts/e1RM, Muscles and recovery, and they show in the history list and the Calendar, marked "Imported · Strong/Hevy". The Calendar does not colour imported days as workout days; they get a neutral marker.
- **Clean UI:**
  - Settings → Data gets one new button, "CSV (Strong / Hevy)". No other new always-visible controls.
  - History rows of imported workouts carry one small muted tag.
- **Spec deviation (controller ruling C1):**
  - The spec put imported entries in history with a `source` field. This plan stores them in `state.importedHistory` instead, while still keeping `source` and `importKey` on each entry.
  - Reason: excluding them from ~15 existing calculations one by one is fragile. A separate array excludes them by construction.
  - Old app versions keep unknown top-level fields (`tests/app/forward-compat.js`). They simply don't show imports, which is acceptable.
- Work only in the worktree `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/gymquest/.claude/worktrees/gym-basics` (branch `gym-basics`):
  - never touch the main checkout, never `main`, never push;
  - commit per task on `gym-basics`, ending with the attribution lines;
  - no `CACHE_VERSION` / `?v=` bump.
- **Tests:**
  - App suites run only via `/home/Surotvsk/Documents/gymquest-backup-2026-10-10/claude-code/gym-basics/t.sh tests/app/<suite>.js`.
  - Suites that need the local Supabase stack run on the host after `source …/claude-code/local-preview/test-env.sh`, once port 8124 is free.
  - Full regression: `claude-code/gym-basics/regression.sh`.
- Slovak code comments. Every string goes in `BASICS_I18N` in all six languages. Bento tokens only, in a new CSS section `/* ===== Gym-basics: CSV ===== */`.
- New sheets follow the Phase 1/2 standard: dialog role, Escape chain, focus in and restore (`restoreSheetFocus`), `isBusy()`, `NATIVE_BACK_CLOSE`, 44 px targets, and pressed chips via `aria-pressed`.
- **Files:**
  - Reading uses a file input (the existing hidden `#file-import` pattern).
  - Writing uses the existing download path: `nativeSaveAndShare` on Android, a Blob link in the browser, as in `exportData()`.
  - Never upload a file anywhere; parsing is local.
- **Safety:** a CSV can contain anything.
  - Parsed text is only ever inserted through `textContent` / `esc()`.
  - Hard limits: 20 MB file size, 200,000 rows and 5,000 workouts. Above that, refuse with a clear message.
  - The parser never throws to the UI; a malformed file gives a readable error.
- **Sync:** `importedHistory` is part of the synced state (it is the user's data). An old version must keep it untouched; this is proven by the round trip in Task 6.

## Review Focus

1. **Real-world CSV quirks.**
   - BOM, CRLF, quoted fields with commas, quotes and newlines.
   - A `;` delimiter with decimal commas (Strong in EU locales).
   - Empty trailing lines, and extra or missing optional columns.
   - Expected: parsed correctly, or a clear error naming the line.
   - Pinned in Task 3.
2. **Units.**
   - A Strong export in lb, or with no unit column at all.
   - Expected: lb detected or chosen in the preview, values converted to kg (× 0.45359237, rounded to 0.25 kg), and the preview shows the chosen unit.
   - Pinned in Tasks 3 and 4.
3. **Re-import of the same file, or of an overlapping newer export.**
   - Expected: existing `importKey`s are skipped and only new workouts are added. The preview counts "N new · M already imported".
   - Pinned in Task 4.
4. **Huge history** (e.g. 3,000 workouts).
   - Expected: import finishes without freezing the UI for more than about a second per chunk, with one `saveState()` at the end and a storage-size warning if near the limit. Charts and Stats stay fast.
   - Pinned in Task 4 (timing) and Task 1 (derived readers are O(n)).
5. **XP and records isolation under every view.**
   - Expected: identical XP, level, streak, records, achievements, Stats counters and leaderboard payload with and without 500 imported workouts.
   - Pinned in Task 1.

---

### Task 1: `importedHistory` storage + derived isolation + insight readers

**Files:**
- Modify `script.js`:
  - state load/normalisation (`backfillState` / `migrateV2toV3` / the import normaliser, wherever top-level fields are cleaned);
  - the Phase 2 insight section (`exerciseSeries`, `muscleBuckets`, `muscleRecovery` and their history loops);
  - a new section `/* ---------- Importované tréningy ---------- */`.
- Test: new `tests/app/import-isolation.js`.

**Interfaces:**
- Produces:
  - `state.importedHistory: Array<ImportedWorkout>`, defaulting to `[]`.
  - `ImportedWorkout = { id: string, date: 'YYYY-MM-DD', planName: string, source: 'strong'|'hevy'|'csv', importKey: string, durationSeconds?: number, endedAt?: number, note?: string, exercises: HistoryExerciseEntry[] }`.
    - `endedAt` is only set when the file has a real end time; it must satisfy the Phase 2 rule that its local date equals `date`.
    - `exercises` use exactly the history exercise entry fields: `name`, `exId?`, `sets`, `reps`, `weight`, `setsDone`, `doneSets?`, `setWeights?`, `setReps?`, `setRpe?`, `warmups?`, `drops?`, `actualFailureSets?`, `assisted?`.
  - `cleanImportedHistory(raw) -> ImportedWorkout[]`: drops invalid entries, never throws, keeps valid entries byte-identical.
  - `insightHistory() -> array`: `state.history.concat(state.importedHistory)`. Memoise it on both array identities and lengths, like `xpMaps`.
  - `isImportedWorkout(w) -> boolean`.
- Decisions:
  - `exerciseSeries`, `muscleBuckets`, `muscleRecovery` and `exerciseSessionList` read `insightHistory()`.
  - Nothing else changes. Grep every `state.history` reader and leave all non-insight ones as they are.

- [ ] **Step 1: Write the failing test `tests/app/import-isolation.js`.**
  - Fixture: 20 real workouts plus 500 imported workouts (built in-page with the entry shape above, dates spread over 3 years, including this week).
  - Assert equality with and without the imported set:
    - `totalXP()`, the level, `computeStreak()` and the week-goal progress;
    - `personalRecords()` and the unlocked achievements after `evaluateAchievements()`;
    - `leaderboardPayload()` (deep-equal), the Stats Week/Month/All tile texts and the Today "This week" tile;
    - `recommendedPlan()`, and the comparison hint text on an exercise tile.
  - Assert that the insight readers include imports:
    - `exerciseSeries('bench-press')` has 500+ points;
    - `muscleWeek(currentWeekKey())` includes this week's imported sets;
    - `muscleRecovery` reflects an imported workout from yesterday.
  - Assert that loading a state with junk in `importedHistory` (`null`, strings, entries missing `exercises`) keeps only the valid entries, never throws, and leaves the valid ones byte-identical.
  - Assert that `forward-compat` still passes and that `importedHistory` is part of the sync content hash: adding an import changes it, and the device-only keys don't.
  - Performance: opening Stats and the progress sheet with 3,000 imported workouts each takes < 300 ms.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `import-isolation`, `insight-data`, `ex-progress`, `muscles`, `recovery`, `xp-engine`, `xp-recalc`, `achievements-v2`, `bento-home`, `forward-compat`. Expected: PASS.

### Task 2: Imported workouts in History and Calendar (view, delete)

**Files:**
- Modify `script.js`: the history list and Calendar day renderers (grep `renderHistory`, `openCalendarPage` and the day sheet). Delete actions go in a new section.
- Modify `style.css`.
- Test: new `tests/app/import-history-view.js`.

**Interfaces:**
- Consumes: `state.importedHistory`, `isImportedWorkout` (Task 1).
- Produces:
  - `deleteImportedWorkout(id)`.
  - `deleteImportedSource(source) -> number` (count removed).
  - Both go through the existing confirm-dialog pattern in the current language, and each calls `saveState()` once.
- Decisions:
  - The history list merges real and imported workouts by date (newest first). Imported rows show a small muted tag `Imported · Strong` (or Hevy / CSV).
  - Imported entries can be opened and deleted, not edited: the edit button is hidden for them.
  - Calendar:
    - imported-only days get a neutral dot (`--text-dim` ring), not the green workout fill;
    - a day with both real and imported workouts stays green;
    - the day sheet lists both, each imported one with its tag.
  - The Phase 2 exercise-name links in history lines work for imported entries.
  - "Remove all imported from Strong/Hevy" lives in the Task 5 CSV sheet, not in History.
- [ ] **Step 1: Write the failing test.**
  - With 3 imported workouts (one today):
    - they appear in History with the tag;
    - they have no edit button;
    - delete asks for confirmation, removes the workout, and the change survives a reload.
  - The Calendar shows a neutral marker on an imported-only day and green on a mixed day; the day sheet lists both.
  - The exercise-name link opens the progress sheet with the imported points.
  - XP and streak are unchanged after viewing and deleting.
  - 6 languages, RTL, light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `import-history-view`, `import-isolation`, `ex-progress`, `bento-theme` and `bento-parity`. Take screenshots (light, dark, ar) into `claude-code/gym-basics/phase3/after/task2/`.

### Task 3: CSV parser, format detection and mapping (pure)

**Files:**
- Modify `script.js`, new section `/* ---------- CSV: čítanie a zápis ---------- */`.
- Create `tests/fixtures/csv/`:
  - `strong-kg-comma.csv`
  - `strong-lb-semicolon-decimal-comma.csv`
  - `strong-no-unit.csv`
  - `hevy.csv`
  - `hevy-supersets-rpe-warmup-drop.csv`
  - `gymquest-export.csv`
  - `broken-quotes.csv`
  - `bom-crlf.csv`
- Test: new `tests/app/csv-parse.js` (in-page pure functions, with fixtures read via `fs` and passed in).

**Interfaces:**
- Produces:
  - `parseCsv(text: string) -> { rows: string[][], delimiter: ',' | ';' }`.
    - Follows RFC 4180: quotes, escaped quotes, embedded newlines, BOM and CRLF.
    - The delimiter is detected from the header line.
    - Throws `CsvError { line: number, code }` only on unterminated quotes. Callers catch it.
  - `detectCsvFormat(header: string[]) -> 'strong'|'hevy'|'gymquest'|null`.
    - The GymQuest export uses the Hevy layout plus a first header comment row or a distinguishing column. Choose one and document it; Task 5 writes it.
  - `csvToWorkouts(rows, format, opts: { unit: 'kg'|'lb'|null }) -> { workouts: ImportedWorkout[], unitDetected: 'kg'|'lb'|null, unmatched: string[], skippedRows: number }`.
    - Groups rows into workouts by start time + title.
    - Within a workout, groups by exercise in file order.
    - Maps set types: warm-up → `warmups`; drop → `drops`; failure → `actualFailureSets`; normal → working sets with `setWeights`/`setReps`/`doneSets`.
    - Keeps a superset id as `group` on consecutive exercises.
    - RPE goes to `setRpe`. A duration becomes `durationSeconds`.
    - `importKey = source + '|' + rawStart + '|' + title`.
    - Converts lb → kg as × 0.45359237, rounded to 0.25.
    - Treats a decimal comma as a decimal point when the delimiter is `;`.
  - `matchExercise(name: string) -> { exId: string|null, name: string }`.
    - First tries an exact case- and space-insensitive match against library names in all six languages.
    - Then uses `CSV_EXERCISE_ALIASES`, a static map of common Strong/Hevy names to library ids (e.g. "Bench Press (Barbell)" → `bench-press`, "Squat (Barbell)" → `squats`, "Deadlift (Barbell)" → …). It covers every library exercise that has an obvious Strong/Hevy name.
    - Otherwise returns `exId` null and the original name (a custom identity).
- **Format research (required before writing fixtures):**
  - Verify the current Strong and Hevy CSV export columns and date formats from their official help pages or other public documentation (WebSearch/WebFetch).
  - Write the exact header lines and one sample row of each into the report, with the source URLs.
  - Build the fixtures to match. Where documentation is ambiguous (e.g. Strong `Weight Unit` column present or not; Hevy date format `"15 Nov 2024, 18:02"`), support both variants and say so.
- [ ] **Step 1: Write the failing test `tests/app/csv-parse.js`.**
  - **parseCsv:** quoted comma, `""` escape, embedded newline, BOM, CRLF and the `;` delimiter.
  - **Broken file:** `broken-quotes.csv` throws `CsvError` with the right line number.
  - **Detection:** each fixture is detected correctly; an unknown header gives null.
  - **Strong in kg:** 2 workouts, the right sets per exercise, weights, reps, duration and date.
  - **Strong in lb with a decimal comma:** 225 lb → 102 kg (225 × 0.45359237 = 102.06 → 102), and 135,5 lb is parsed as 135.5.
  - **Strong with no unit column:** `unitDetected` is null; with `opts.unit 'lb'` the values are converted.
  - **Hevy with warm-up, drop and failure set types:** they map to `warmups`, `drops` and `actualFailureSets`. RPE goes to `setRpe`, and the superset id gives a shared `group`.
  - **Exercise matching:**
    - "Bench Press (Barbell)" → `bench-press`.
    - The Slovak library name → its id.
    - "Zercher Squat" is listed in `unmatched` and becomes a custom identity.
  - **Imported workout validity:** every produced workout passes `cleanImportedHistory`, and `historyWorkingSets` on its exercises returns the expected sets.
  - **Garbage input:** random binary text or an empty file gives a clean `{ workouts: [] }` or a `CsvError`, never an uncaught exception.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

### Task 4: Import flow (preview → confirm → dedupe → save)

**Files:**
- Modify `script.js`, new section `/* ---------- CSV: import ---------- */`.
- Modify `index.html`, adding the sheet `#modal-csv-import`.
- Test: new `tests/app/csv-import.js`.

**Interfaces:**
- Consumes: `parseCsv`, `detectCsvFormat`, `csvToWorkouts` (Task 3); `cleanImportedHistory` (Task 1).
- Produces:
  - `openCsvImport(file: File)`: reads the file, parses it in chunks (yield every ~2,000 rows via `setTimeout(0)` or `requestIdleCallback`), then shows the preview.
  - `confirmCsvImport()`: appends only workouts whose `importKey` is not already present, calls `saveState()` once, closes the sheet, and shows a short toast "Imported N workouts".
- Decisions:
  - The preview shows:
    - the detected format;
    - "N new · M already imported" workouts;
    - the date range;
    - the number of exercises matched to the library and the number of new custom exercises, with the unmatched names listed when expanded via a `<details>`;
    - when the unit is unknown, kg/lb pressed-chips (none preselected; Confirm is disabled until one is chosen);
    - a one-line note: "Imported workouts appear in history and charts. They don't give XP, streaks or records."
  - Before writing, a recovery copy of `state.importedHistory` is kept in memory, and an "Undo import" action appears in the toast for 10 s. It restores the previous array.
  - Limits (see Global Constraints) give a clear message.
  - Near the storage limit: reuse the app's storage-size warning (grep "Veľkosť uložených dát").
  - Errors (`CsvError`, unknown format) show a calm message in the sheet with the line number. Nothing is written.
- [ ] **Step 1: Write the failing test `tests/app/csv-import.js`.** Use the fixtures through a synthetic `File` passed to `openCsvImport`.
  - **Preview:** it shows the right counts and unit chips. Confirm stays disabled until a unit is chosen for `strong-no-unit`.
  - **Confirm:** it adds the workouts to `importedHistory` (and never to `state.history`), and the result survives a reload.
  - **Re-import:** the same file shows "0 new · N already imported" and adds nothing. An overlapping file adds only the new workouts.
  - **Undo:** within 10 s it restores the previous array.
  - **Broken files:** a broken file shows an error with its line number, and `state` is unchanged (deep-equal).
  - **Timing:** a generated 3,000-workout Hevy CSV (~45,000 rows) completes, and no single main-thread task is longer than 1,000 ms (measure gaps between `setTimeout` ticks).
  - XP is unchanged after the import.
  - The sheet standard holds.
  - 6 languages, RTL, light and dark at 390 px, no console errors.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `csv-import`, `csv-parse`, `import-isolation` and `bento-parity`.

### Task 5: CSV sheet in Settings + export

**Files:**
- Modify `index.html`: Settings → Data gets one new button, `#btn-csv` ("CSV (Strong / Hevy)"), next to the existing export and import buttons. Add the sheet `#modal-csv`.
- Modify `script.js`, new section `/* ---------- CSV: export ---------- */`.
- Test: new `tests/app/csv-export.js`.

**Interfaces:**
- Consumes: `openCsvImport` (Task 4); `deleteImportedSource` (Task 2); `historyWorkingSets` and `historyDropSets` (Phase 2).
- Produces:
  - `buildCsvExport({ includeImported: boolean }) -> string`.
    - Uses the Hevy column layout (the exact header verified in Task 3), with the GymQuest marker chosen in Task 3.
    - Writes one row per set: warm-ups as `warmup`, working sets as `normal` (or `failure` when marked), drops as `dropset`, plus RPE, a `superset_id` from `group`, and the duration.
    - Uses the history date at 00:00 local as `start_time`, and `end_time` = start + duration, or blank (spec).
    - Escapes values per RFC 4180 and adds a UTF-8 BOM for Excel.
  - `exportCsv()`: saves `gymlift-workouts-YYYY-MM-DD.csv` through the same save path as `exportData()`.
- The `#modal-csv` sheet contains:
  - "Export CSV", with a pressed-chip toggle "Include imported workouts", off by default;
  - "Import from Strong or Hevy…", which opens the file picker and leads into Task 4;
  - when imports exist, a "Manage imported" list of sources with counts, each with "Remove all", confirmed via `deleteImportedSource`;
  - a short help line on where to find the export in Strong and in Hevy (wording based on the Task 3 research).
- [ ] **Step 1: Write the failing test `tests/app/csv-export.js`.**
  - **Export:**
    - `buildCsvExport` on a fixture with plain, per-set, unilateral, warm-up, drop, failure, RPE and superset workouts produces the expected rows: line count, set types and values.
    - Unilateral sides become two rows per set; document the convention.
  - **Round trip:** re-parsing the export with `parseCsv` + `detectCsvFormat` gives `'gymquest'`, and `csvToWorkouts` reproduces equal working sets per exercise (compare via `historyWorkingSets`).
  - **Escaping:** a name containing a comma, a quote or a newline is escaped correctly.
  - **Imports in export:** with "include imported" off, imported workouts are not exported; with it on, they are.
  - **Settings UI:**
    - Settings has exactly one new button.
    - The sheet standard holds.
    - "Remove all" from Strong removes only Strong imports, after confirmation.
  - **Download (browser path):** a Blob link with the right filename and `text/csv` type is created. Intercept `URL.createObjectURL`.
  - 6 languages, RTL, light and dark at 390 px.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `csv-export`, `csv-import`, `csv-parse`, `import-history-view` and `bento-theme`. Take screenshots into `phase3/after/task5/`.

### Task 6: Round trip, README, regression, screenshots, commit

- [ ] **Step 1: Extend `tests/sync/gym-basics-roundtrip.js`.**
  - The new device has 50 imported workouts.
  - The old builds (v106, v95) load, edit an unrelated plan and a real history entry, and sync.
  - Assert that `importedHistory` is byte-identical afterwards on the cloud and on the new device, and that old-build XP equals new-device XP (v106 exact; v95 with the strip-control: also strip `importedHistory`).
  - Run it on the host (wait until port 8124 is free).
- [ ] **Step 2: Update the README.**
  - Features: CSV export (Hevy layout) and import from Strong/Hevy, with exactly what imports count for and what they don't.
  - Data/backup section: JSON stays the full-fidelity backup.
- [ ] **Step 3: Run the full regression** vs `claude-code/gym-basics/baseline/summary.txt`. Expected: nothing worse.
- [ ] **Step 4: Screenshots** (light, dark, ar, 390 px) into `claude-code/gym-basics/phase3/after/final/`:
  - Settings → Data, the CSV sheet, the import preview, History with an imported row, and the Calendar with the neutral marker.
  - Check them for calm.
- [ ] **Step 5: Commit on `gym-basics`.**
