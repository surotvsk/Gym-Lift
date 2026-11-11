# Task 3 report: CSV parser, detection, mapping

Status: DONE. Tests: csv-parse 67/67; import-history-view 44/44 and import-isolation 36/36 still pass. `node --check` ok. No CACHE_VERSION bump.

## Format research (2026-11-11)
Sources: https://github.com/smyrick/sugarwod-to-hevy/blob/main/docs/STRONG_FORMAT.md , https://thetaperapp.com/articles/how-to-export-strong-data/ , https://aebel-shajan.github.io/notes/projects/gym-data-analysis/ , https://github.com/njpastrone/training-tracker/pull/49 , https://kinoku.app/import-format , https://trackreps.com/transfer-workout-history/ , https://github.com/matanabudy/workout-data-sync/blob/main/examples/hevy_export_sample.csv , https://thetaperapp.com/articles/how-to-export-hevy-data/ , https://griptapp.com/help/export-workouts-from-hevy , https://github.com/brunocpf/local-first-workout-tracker-pwa/issues/4 . (No official Strong/Hevy help page documents the columns; all from public importers/guides.)

### Strong
Current (comma, no unit column; weights are in the app's unit):
`Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE`
Sample: `2020-12-30 18:51:52,Evening Workout,2h 38m,Snatch (Barbell),1,40.0,3,0,0,,,`
Older export (semicolon, with unit columns):
`Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration`
Sample: `2023-07-30 16:49:28;"Arms";"Bench Press (Dumbbell)";1;14;kg;8;;;;0;"";"";44m`
Date `YYYY-MM-DD HH:MM:SS` (24h). Duration `1h 9m` / `44m` / `3h`. Set Order: 1-based number, `W` warm-up, `D` drop, `F` failure, `Rest Timer` (pause row). No superset data. Disagreements: one source (trackreps) lists a `Workout #` column; others do not; Kinoku shows a different column order (Workout Duration last). Parser is header-name based (order independent), `Workout #` ignored, both `Duration` and `Workout Duration` read. Assumption: the comma + `Weight Unit` fixture (strong-kg-comma.csv) is a hybrid of the two variants (no source shows exactly it), kept to cover "comma + unit column".
### Hevy
`title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe`
Sample (from the GitHub fixture): "Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37",...,"Pull Up (Assisted)",,,0,normal,21,10,,,8.5
Weight/distance columns follow the account's units: `weight_kg`/`weight_lbs`, `distance_km`/`distance_miles` (both seen). Dates disagree: `22 Dec 2025, 08:00`, `15 Nov 2024, 18:02`, `Oct 13, 2026, 9:50 PM`; all three (plus ISO and `dd.mm.yyyy`) are parsed, no timezone. set_type: normal, warmup, dropset, failure. Empty weight/reps with duration_seconds for timed sets. English only (apps must export in English).

## GymQuest export marker (Task 5 writes this)
Hevy layout plus ONE trailing column. Header, exactly:
`title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe,gymlift_version`
Every data row ends with `gymlift_version` = `1`. `detectCsvFormat` returns `'gymquest'` when `exercise_title`, `start_time`, `weight_kg|weight_lbs` AND `gymlift_version` are present. Dates: `D Mon YYYY, HH:MM` (e.g. "15 Nov 2024, 12:00"); weights always kg; set_type normal/warmup/dropset/failure; superset_id empty or a group id; rpe empty or 6-10 half steps. Imported workouts from it get `source: 'csv'` (importKey `csv|<start_time>|<title>`). Note for Task 4/5: importing your own export back into the same device would duplicate real workouts (they are stored separately in importedHistory); Task 4 may want to warn.

## API (all in script.js, section "CSV: čítanie a zápis", before "Prehľad: progres cviku")
- `parseCsv(text)` -> `{rows, delimiter}`; RFC 4180, BOM, CRLF/LF/CR, `sep=;` first line, empty lines skipped, lenient stray quotes. Throws `CsvError{name,code,line}`: `unterminated-quote` (line of the opening quote), `too-many-rows` (>200,000 rows incl. header), `too-many-columns` (>500), `too-large` (>25M chars). Linear; guarded (tests: 8 MB quoted field, 10 MB commas, 5M newlines, 200,001 rows).
- `detectCsvFormat(header)`, `csvToWorkouts(rows, format, {unit, delimiter?})` (optional `delimiter` from parseCsv forces comma-as-decimal; without it the decimal comma is recognised by shape), `matchExercise(name)`.
- Mapping decisions: warm-up -> `warmups [{weight,reps}]` (reps>=1); drop -> `drops` (max DROP_MAX=5, extras and drop-only exercises become working sets); failure -> working set + `actualFailureSets`; RPE -> `setRpe` (6..10 half steps, else null); exercise seconds -> entry `durationSeconds` (sum), workout `durationSeconds` from Strong Duration or Hevy end-start; Hevy `superset_id` on >=2 consecutive exercises -> shared `group` ('ss1', ...); same exercise repeated in a workout merges into one entry; exercise with only warm-ups is dropped (counted in skippedRows); assisted library exercises get `assisted: true` and the minimum weight. Entries have name (English library name for matched, else the CSV name), `exId` only when matched, sets/reps/weight/setsDone/doneSets/setWeights/setReps. Workouts are returned in file order (not sorted). Ids `imp-<stableHash(importKey)>` (collision suffix). Skipped (counted in skippedRows): Rest Timer rows, unparsable date, no exercise name, non-numeric/negative values, all-zero rows. Negative Strong weights (if assisted exports use them) are skipped, not abs()'d (open question).
- Units: Weight Unit column / weight_kg / weight_lbs win; else opts.unit; else kg (unitDetected null). lb -> kg x 0.45359237 rounded to 0.25; kg kept (3 decimals).
- Limit 5,000 workouts / 20 MB is NOT enforced here (Task 4 checks `workouts.length` and file size).

## CSV_EXERCISE_ALIASES (alias -> library id), plus exact names in all six languages
- bench-press: Bench Press (Barbell); Bench Press; Barbell Bench Press; Flat Bench Press (Barbell)
- overhead-press: Overhead Press (Barbell); Overhead Press; Standing Military Press (Barbell); Military Press; Overhead Press (Dumbbell); Shoulder Press (Barbell)
- dips: Dips; Dip; Triceps Dip; Chest Dip
- lateral-raises: Lateral Raise (Dumbbell); Lateral Raise (Cable); Lateral Raise; Side Lateral Raise (Dumbbell)
- pull-ups: Pull Up; Pull-Up; Pull Ups; Chin Up
- bent-over-rows: Bent Over Row (Barbell); Barbell Row; Bent Over Row
- cable-rows: Seated Cable Row; Seated Row (Cable); Cable Row; Seated Cable Row - V Grip (Cable); Seated Cable Row - Bar Grip
- bicep-curls: Bicep Curl (Dumbbell); Bicep Curl (Barbell); Bicep Curl; EZ Bar Biceps Curl; Biceps Curl (Dumbbell)
- squats: Squat (Barbell); Squat; Back Squat (Barbell); Barbell Squat
- leg-press: Leg Press; Leg Press (Machine); Leg Press Horizontal (Machine)
- lunges: Lunge (Dumbbell); Lunge (Barbell); Lunge; Walking Lunge (Dumbbell); Walking Lunge
- leg-curls: Leg Curl; Lying Leg Curl (Machine); Seated Leg Curl (Machine); Leg Curl (Machine)
- calf-raises: Standing Calf Raise (Machine); Standing Calf Raise (Barbell); Standing Calf Raise (Dumbbell); Seated Calf Raise (Machine); Calf Raise; Calf Press (Machine); Calf Raise (Machine)
- push-up: Push Up; Push-Up; Push Ups; Pushup
- band-bicep-curl: Bicep Curl (Band); Bicep Curl (Resistance Band)
- dumbbell-row: Dumbbell Row; One Arm Dumbbell Row; Single Arm Dumbbell Row; Bent Over One Arm Row (Dumbbell)
- superman: Superman
- pike-push-up: Pike Push Up; Pike Push-Up
- hammer-curl: Hammer Curl (Dumbbell); Hammer Curl; Dumbbell Hammer Curl
- diamond-push-up: Diamond Push Up; Diamond Push-Up
- bodyweight-squat: Bodyweight Squat; Squat (Bodyweight); Air Squat
- split-squat: Bulgarian Split Squat; Bulgarian Split Squat (Dumbbell); Split Squat (Dumbbell); Split Squat
- step-up: Step Up; Step-up; Step Up (Dumbbell); Step-up (Dumbbell)
- glute-bridge: Glute Bridge; Bodyweight Glute Bridge
- hip-thrust: Hip Thrust (Barbell); Hip Thrust; Hip Thrust (Machine)
- single-leg-glute-bridge: Single Leg Glute Bridge; Single Leg Bridge
- plank: Plank
- dead-bug: Dead Bug
- burpee: Burpee; Burpees
- cable-curl: Bicep Curl (Cable); Cable Curl; Biceps Curl (Cable)
- machine-chest-press: Chest Press (Machine); Machine Chest Press; Seated Chest Press (Machine)
- pec-deck: Pec Deck (Machine); Butterfly (Pec Deck); Chest Fly (Machine); Pec Deck Fly; Pec Deck
- incline-dumbbell-press: Incline Bench Press (Dumbbell); Incline Dumbbell Press; Incline Press (Dumbbell)
- front-raise: Front Raise (Dumbbell); Front Raise
- lat-pulldown: Lat Pulldown (Cable); Lat Pulldown (Machine); Lat Pulldown
- dumbbell-pullover: Pullover (Dumbbell); Dumbbell Pullover
- cable-pullover: Cable Pullover; Pullover (Cable)
- single-arm-dumbbell-triceps-extension: Single Arm Triceps Extension (Dumbbell); Single Arm Tricep Extension (Dumbbell)
- single-arm-cable-triceps-extension: Single Arm Triceps Pushdown (Cable); Single Arm Triceps Extension (Cable)
- hack-squat: Hack Squat (Machine); Hack Squat
- romanian-deadlift: Romanian Deadlift (Barbell); Romanian Deadlift; Romanian Deadlift (Dumbbell)
- leg-extension: Leg Extension (Machine); Leg Extension
- adductor-machine: Hip Adductor (Machine); Hip Adduction (Machine); Adductor Machine; Hip Adductor
- abductor-machine: Hip Abductor (Machine); Hip Abduction (Machine); Abductor Machine; Hip Abductor
- assisted-dips: Triceps Dip (Assisted); Chest Dip (Assisted); Dip (Assisted); Assisted Dip; Dips (Assisted)
- assisted-pull-ups: Pull Up (Assisted); Chin Up (Assisted); Assisted Pull Up; Pull-Up (Assisted)

Library ids without alias: band-chest-press, band-pulldown, band-row, band-shoulder-press

## TDD evidence
RED (before implementation): `FAIL parseCsv: quoted comma ... -> ReferenceError: parseCsv is not defined` ... `==== checks: 1 passed, 21 failed ====` (test aborted at the first detect call).
GREEN: `==== checks: 67 passed, 0 failed ====` (re-run after final edit; also stable with import-history-view 44/44, import-isolation 36/36).
Covers: parse quirks, broken-quotes line 3, pathological input, detection of all 7 fixtures + unknown, Strong kg/lb/no-unit/BOM, Hevy variants (kg/lbs, both date formats, warmup/drop/failure, RPE, superset), Gym-Lift export, matching (en/sk/es, aliases), cleanImportedHistory + historyWorkingSets validity, garbage input.
Fixtures: tests/fixtures/csv/{strong-kg-comma,strong-lb-semicolon-decimal-comma,strong-no-unit,hevy,hevy-supersets-rpe-warmup-drop,gymquest-export,broken-quotes,bom-crlf}.csv. regression.sh got `run csv-parse node tests/app/csv-parse.js`.

## Fix note (ruling C4: assisted weights)
Strong negative weight = assistance. Now `weight = abs(w)`. If all working sets of an exercise are negative, the entry gets `assisted: true` (minimum weight kept, like library assisted exercises). If an exercise mixes negative and positive working sets, the positives stay normal sets, the entry is not assisted, and the negative rows are skipped and counted in skippedRows. Fixture tests/fixtures/csv/strong-assisted.csv, 4 new checks (library assisted, all-negative Dips, mixed Zercher Squat). csv-parse: 71/71.
