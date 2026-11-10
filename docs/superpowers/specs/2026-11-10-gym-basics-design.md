# Gym-Lift: tracker basics and coaching (items 1–10) — design

Date: 2026-11-10 · Branch `gym-basics` (worktree `.claude/worktrees/gym-basics`, from v106 `f9590a9`)

## Why

A comparison with the most used gym apps (Hevy, Strong, Fitbod, JEFIT, Boostcamp, Alpha Progression,
MacroFactor Workouts, Gravl) showed GymQuest is ahead on motivation (XP, streaks, achievements) and social,
but misses the logging and insight basics that people switching from Hevy or Strong expect, and the coaching
features the newer apps sell. The owner wants items 1–10 of that list. Everything stays free.

## Scope

In: 1 supersets/circuits · 2 per-exercise charts + estimated 1RM · 3 plate calculator · 4 warm-up sets +
warm-up calculator · 5 RPE/RIR per set · 6 sets and volume per muscle group · 7 CSV export + import of Strong
and Hevy files · 8 next weight/reps suggestions · 9 ready-made multi-week programs with deload weeks ·
10 muscle recovery map.

Out (owner, 2026-11-10): watch apps, home-screen widgets, lock-screen rest timer, live PR banner, monthly
summary, gym profiles, a bigger exercise library (item 11).

## Goals

- A Hevy/Strong user finds the tools they rely on (supersets, warm-ups, RPE, plate calculator, exercise charts,
  CSV) and can bring their history over.
- GymQuest tells you what to lift next time and what to train, with plain explanations.
- Nothing existing changes meaning: XP, levels, streaks, records, achievements, leaderboard and sync behave
  exactly as today for workouts that do not use the new features.

## Non-goals

- No AI / LLM. All coaching is simple, explainable rules.
- No server changes, no Supabase migration, no Edge Function change, no new native Android code.
- No new exercises in the library; programs use only the existing 50.
- No paywall or "Pro" tier.

## Anti-goals (failure even if it "works")

- Anything that changes an existing user's XP, level, streak, records or leaderboard score just by updating.
- A feature that switches itself on or clutters the workout screen for someone who never asked for it.
- A suggestion that silently changes a plan's weights. The user always taps to accept.
- Data loss or a sync conflict caused by an older app version (Android Play build, a second device) meeting
  the new fields.
- Charts or numbers that pretend to be precise (estimated 1RM and recovery are labelled as estimates).

## Constraints (from the repo)

- One app file `script.js` (globals, Slovak comments), `index.html`, `style.css`; Bento design tokens, light and
  dark; check every new screen with `tests/app/bento-theme.js`-style contrast/overflow checks.
- Six languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar` RTL); `en` is the reference; every new string in all six.
  Arabic strings get flagged for a native check (as with the tutorial).
- State changes are additive. Derived values (XP, PRs, streaks, achievements) are recomputed from history.
  New fields on plan rows and history entries are optional; absence means "old behaviour".
- Forward compatibility: older versions keep unknown top-level fields (`tests/app/forward-compat.js`) but may
  drop unknown fields on a plan row or history entry **when the user edits that row/entry in the old version**
  (known precedent: the assisted mark, Phase 3). That is accepted: the result must still be a valid workout
  with the same XP, and nothing else may be lost. Add a round-trip test like `tests/sync/old-version-roundtrip.js`
  (v106 ↔ new) covering every new field.
- No v77/v106 element id is removed (`tests/app/bento-parity.js`). Existing suites stay green.
- Another agent is changing `main` at the same time (phase 8: body/HR/reminders/nav). This branch stays
  local: phases are committed on `gym-basics` only (never `main`, never pushed) and merged later. **Do not bump `CACHE_VERSION` / `?v=` per phase on this
  branch**; the version bump happens once, at merge time. Keep edits in new, clearly named sections of
  `script.js`/`style.css` where possible to keep the merge small.
- Exercise weights are kilograms only in the app today; the new features stay kg (plate calculator included).

## Shared building blocks

**Exercise identity.** Charts, suggestions, volume and recovery group history by the same identity the app
already uses: library id (`exId`) for built-in exercises, otherwise the custom identity (`cx-…` /
`exerciseIdentity`). Assisted exercises never produce a 1RM, volume load or "heavier" suggestion (the number is
help, not load) — they get "less help" suggestions instead.

**Per-set reconstruction.** One helper turns a history entry into a list of done working sets
`{ weight, reps, side?, rpe?, failure? }`, using `setWeights`/`setReps`/`sideWeights`/`sideReps`/`sidesDone`
when present, else `weight × reps` for `setsDone` sets. Drops are listed separately; warm-ups (new) are never
working sets. Every insight feature uses this one helper.

**Muscle data.** Library entries have `primary` and `secondary` among the 7 `MUSCLE_CODES`
(chest, back, shoulders, arms, legs, glutes, core). Counting rule everywhere: a working set counts 1 for the
primary muscle and 0.5 for each secondary. Custom exercises without library data count under "Other" (shown
but never in the recovery map).

## Features

### 1. Supersets and circuits

- Plan rows get an optional `group` string. Consecutive rows with the same `group` form a superset (2 rows) or
  circuit (3+). In the plan editor each row has "Link with next" / "Unlink"; linked rows are shown with a
  bracket and a letter label (A, B, …) that is display-only.
- In the workout, the group is shown as one bracketed block. Completing a set of a non-last exercise in the
  group moves focus/scroll to the next exercise in the group (same set number). Completing the round
  (last exercise) is the moment to rest.
- Rest: the rest timer stays manual as today. New optional device setting **"Start rest automatically after a
  set"** (off by default). When on, it starts the last-used preset after a completed set — for grouped rows only
  after the last exercise of a round. (Builder's call how the preset is chosen if none was used yet: first preset.)
- History entries get `group` copied from the row so past workouts show the bracket. Unlinking/reordering
  that breaks adjacency simply ungroups (never errors). Quick workout / added exercises are ungrouped.
- No effect on XP, sets count or records.

### 2. Per-exercise progress screen + estimated 1RM

- New exercise progress sheet, opened from: Records, the exercise library detail, a history entry, and the
  exercise tile during a workout (an icon, not a new primary button).
- Shows: best estimated 1RM, heaviest weight, best set (weight × reps), best session volume, number of
  sessions; three small inline-SVG charts over time (estimated 1RM, heaviest weight, session volume) using the
  existing body-chart approach (no charting library), with a time range (3 months / 1 year / all); and the list
  of past sessions of that exercise across **all plans**.
- Estimated 1RM: Epley `w × (1 + reps/30)`, only for sets with 1–12 reps and weight > 0; reps 1 = the weight.
  Labelled "estimated". Unilateral sets are per side (best side). Volume = Σ weight × reps of working sets + drops.
- Existing `personalRecords()` and achievements are not changed.

### 3. Plate calculator

- Opens from the weight of any exercise whose library equipment includes `barbell` (and from a "Plates" button
  on custom exercises, since we can't know their equipment), in the workout and in the plan editor.
- Input target weight (prefilled), bar weight (default 20 kg; choices 20 / 15 / 10 / custom), available plates
  (default 25, 20, 15, 10, 5, 2.5, 1.25 kg; user can toggle and set counts). Output: plates per side, a simple
  drawing, and "closest possible: X kg" when the exact weight can't be built.
- Bar weight and plate set are a device-independent **synced setting** (`settings.plates`), since they describe
  the user's gym. Greedy largest-first per side is enough.

### 4. Warm-up sets + warm-up calculator

- Warm-up sets are separate from working sets: session data and history field `warmups: [{ weight, reps, done }]`
  (history keeps only done ones, like `drops`). They never count for sets done, XP, records, 1RM, volume,
  muscle sets, recovery, or suggestions. Old versions ignore the field.
- On an exercise tile in the workout: "+ Warm-up" adds one; "Warm-up ramp" generates a ramp for the working
  weight: empty bar × 10, 40 % × 5, 60 % × 3, 80 % × 2, rounded down to what the plate set can build (barbell) or
  to 2 kg / 1 kg steps (others); sets below the bar weight are skipped. The user edits or deletes any of them.
- Shown before the working sets, visually lighter, marked "W". Optionally saved to the plan row as
  `warmupRamp: true` so it is generated automatically next time (off by default).

### 5. Effort rating (RPE / RIR)

- Device-independent synced setting `settings.effort`: `off` (default) / `rpe` / `rir`.
- When on, a completed working set shows a small effort chip; tapping opens a picker (RPE 6–10 in 0.5 steps, or
  RIR 0–4+). Skipping is always fine.
- Stored canonically as RPE (`RIR r` → `RPE 10 − r`) per set: session per set key, history `setRpe` (array by set
  number, `null` where not rated; `sideRpe` for unilateral). Display follows the setting.
- Used by suggestions (item 8). Shown in history and the exercise progress sheet.

### 6. Sets and volume per muscle group

- A new Stats tile "Muscles" opening a sheet: for the selected week (default this week, arrows for earlier
  weeks) the working sets per muscle (1 / 0.5 rule) as horizontal bars, with an 8-week trend per muscle and
  volume load (kg). A short plain note explains the counting and that common guidance is ~10–20 weekly sets
  per muscle, without judging the user.
- Drops count as sets for their exercise; warm-ups never.

### 7. CSV export and import (Strong, Hevy)

- **Export** (Settings → Data, next to JSON export): one row per set, UTF-8 with header, comma-separated, using
  the Hevy column layout (`title, start_time, end_time, description, exercise_title, superset_id, exercise_notes,
  set_index, set_type, weight_kg, reps, distance_km, duration_seconds, rpe`) so other apps can import it.
  `set_type` = `normal` / `warmup` / `dropset` / `failure`. JSON export/import stay unchanged and remain the
  full-fidelity backup.
- **Import**: pick a CSV; the app detects the format from the header (Strong, Hevy, or GymQuest's own export),
  shows a preview (number of workouts, date range, exercises matched to the library vs. new custom exercises,
  unit detected — Strong exports may be in lb and are converted to kg) and imports only after confirmation.
- Exercise matching: exact (case/space-insensitive) match against library names in all six languages plus a
  small alias table for common Strong/Hevy names (e.g. "Bench Press (Barbell)" → `bench-press`); otherwise a
  custom exercise identity from the name.
- Imported workouts become ordinary history entries with `source: 'strong' | 'hevy' | 'csv'` and a stable
  `importKey` (source + start time + title); re-importing the same file skips existing keys. They have no
  `planId` (shown under their original workout name). One `saveState()` for the whole import; a recovery copy
  of the previous state is kept as for JSON import.
- **Imported workouts count for history and insight only (owner, 2026-11-10):** they appear in history, exercise
  charts/1RM, suggestions, muscle stats and the recovery map, but give NO XP, level, streak/weekly-goal credit,
  achievements, personal records (`personalRecords()`), or leaderboard score. Every derived calculation
  excludes entries with `source` set, each with its own test.
- The exact Strong and Hevy CSV columns must be verified against current real export files/documentation
  before coding; the builder adds fixture files for tests.

### 8. Next weight / reps suggestions

- Per exercise (not assisted, not imported-only history), based on the last session of that exercise **in the
  same plan** (consistent with "comparison with last time"):
  - all planned working sets done at ≥ planned reps, and (if rated) average RPE ≤ 8 → suggest + one step
    (2.5 kg upper-body / 5 kg lower-body by library `primary` legs/glutes; custom exercises 2.5 kg; for
    dumbbell exercises 2 kg); RPE ≤ 7 → may suggest + two steps;
  - some sets short of planned reps, or RPE ≥ 9.5 → keep the weight, aim for the planned reps;
  - short of reps two sessions in a row → suggest − 10 % (rounded to a step) as a "reset";
  - assisted: the same rules move toward **less** help.
- Shown as a small chip on the exercise tile ("Try 62.5 kg · why?"); tapping "why" explains the rule in one
  sentence; tapping the chip applies it to this session (and, as today, the weight memory for the plan). Never
  applied automatically. Device setting "Show suggestions" (on by default — it is unobtrusive).
- When a program (item 9) is active, the program's week prescription wins and the chip explains that.

### 9. Ready-made programs

- A "Programs" entry (Workout plan picker and Today "New plan" area) lists built-in programs, each with goal,
  level, days per week, length and a week-by-week outline:
  - **Beginner full body** — 3 days/week, 8 weeks, A/B alternation, deload week 5 is not needed (beginners);
    linear progression via item 8.
  - **Push / Pull / Legs** — 3 or 6 days/week, 8 weeks, deload in week 8.
  - **Upper / Lower** — 4 days/week, 8 weeks, deload in week 8.
  - **Strength wave (5s / 3s / 1s)** — 4 days/week, 4-week waves (week 1: 3×5 at 65/75/85 %, week 2: 3×3 at
    70/80/90 %, week 3: 5/3/1 at 75/85/95 %, week 4 deload 40/50/60 %) of a training max = 90 % of the estimated
    1RM (item 2) or a user-entered number. (Named generically, not after a person/brand.)
- Starting a program creates ordinary custom plans (one per training day, from library exercises only), sets the
  weekly goal to the program's days per week (with confirmation, since it changes streak targets going forward),
  and stores `state.program = { id, startedAt, week, … }` (synced). The plans stay ordinary: editable, deletable.
- Each week the program sets that week's sets/reps/target weights on its plans' sessions (session-level, not
  rewriting the plan), shows "Week 3 of 8" on Today and Workout, and in deload weeks shows "Deload week:
  lighter on purpose". Week advances by calendar week from the start, with "Repeat this week" / "Skip ahead".
  Ending or abandoning a program never deletes plans or history.
- Program content (exercises, sets, reps, percentages) is static data in `script.js`, translated names only.

### 10. Muscle recovery map

- A body map (original front + back SVG drawn for GymQuest, 7 regions; no copied artwork) on a new Stats tile
  and in the Muscles sheet (item 6), coloured from "fresh" to "worked".
- Fatigue per muscle from working sets in the last 96 h (1 / 0.5 rule; RPE ≥ 9 weighs 1.25×), recovering
  linearly to fresh over 72 h (48 h for core and arms). Recovery % = 100 − fatigue, clamped. Clearly labelled
  as a rough estimate based only on logged workouts.
- "Uses it to pick your next workout": on Today, under the recommended workout, a one-line hint when the
  recommended plan mostly hits muscles under 50 % ("Legs still recovering — consider Push"). The rotation
  itself is not changed.

## Rollout inside this branch (builder may refine)

1. Logging: supersets (1), warm-ups (4), effort (5), plate calculator (3), auto-rest setting.
2. Insight: per-set helper, exercise progress sheet + 1RM (2), muscles sheet (6), recovery map (10).
3. Data: CSV export + Strong/Hevy import (7).
4. Coaching: suggestions (8), programs (9).

Each phase: tests first (headless Chrome suites under `tests/app/`, like the existing ones), all six languages,
light/dark checks, old-version round trip for every new field, full regression green, screenshots before/after.
Owner's standing choice: subagent-driven execution, subagents on sonnet / medium effort.

## Left to the builder

Exact UI layout within the Bento design, exact copy (all six languages), internal field names beyond those
named here, chart details, the alias table, and test structure.

## Calls made by Claude after the builder check (owner can overrule)

- **Synced settings.** `settings.plates` and `settings.effort` live in `state.settings`. `normalizeState` builds
  settings with `Object.assign({ weeklyGoal, lang }, base.settings)`, so unknown keys survive older versions.
  The old-version round-trip test must prove it. They are not in `DEVICE_SETTING_KEYS`, and conflicts follow the
  normal whole-state sync rules. "Start rest automatically" and "Show suggestions" are device-only (added to
  `DEVICE_SETTING_KEYS`).
- **CSV times.** History entries have a date but no start time. Export writes `start_time` = date 00:00 local and
  `end_time` = start + `durationSeconds` (blank if unknown). Import keeps the file's local date and time-of-day
  as written, with no timezone conversion. The date goes into `date`, and the raw start string goes into
  `importKey`, so re-imports dedupe exactly. Same-day imports keep file order.
- **Program content.** The builder drafts the day templates (library exercises only; sets/reps per week; PPL
  3-day = one cycle per week, 6-day = two). The owner reviews them through screenshots before the merge, not
  beforehand.
  - Training max with no history or 1RM: the program asks for it, prefilled from the plan's current weight × 1.1.
  - Mid-program edits: the week prescription only touches rows the program created (matched by row id), so
    rows the user adds or edits stay as they are. A deleted row is simply skipped.
- **Recovery scale.** 10 weighted sets on a muscle = 100 % fatigue (capped). The Today hint fires only when ≥ 2 of
  the recommended plan's primary muscles are under 50 %, at most once per day.

## Questions for the owner

1. Imported workouts → history + charts only (no XP/level/streak/achievements/records/leaderboard). — owner 2026-11-10
2. Commits → yes, each finished phase is committed on the local `gym-basics` branch only (never `main`, never pushed);
   merged later with a normal git merge. — owner 2026-11-10
