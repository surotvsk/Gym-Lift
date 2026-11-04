# Phase 3 — Shared exercise data, weight memory, assisted exercises (v100) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a finished workout the app remembers each exercise's working weight and uses it in every plan
(incl. Full Body) and on every device; one-side-at-a-time settings are shared the same way; assisted exercises
exist and count "less assistance" as progress. Sets/reps stay per plan.

**Architecture:** Vanilla JS `script.js` (Slovak comments, globals). Shared values are written into **every plan
row with the same identity** (fields older versions keep) plus `settings.exerciseMemory[identity]` (unknown
settings keys survive older versions). The running session takes a snapshot at start. History is never
rewritten. Tests: Node + headless Chrome (`tests/sync/lib.js`); sync tests on the local stack.

**Tech Stack:** vanilla JS, Node test scripts, local Supabase stack (docker project `gqtest`).

**Spec:** `docs/superpowers/specs/2026-10-30-gym-lift-improvements-design.md` §0, §1.2, §3 (3.1–3.5), §11; decisions
D3, D4 approved.

## Global Constraints

- Never overwrite populated records with defaults; additive only; history entries are never rewritten.
- No new top-level state keys. New data only inside plan exercise rows (`id`, `assisted`) and inside
  `settings.exerciseMemory` (object keyed by identity: `{ weight, assisted, unilateral, startSide, at }`).
- Sets, reps, order, planned failure / drop habits stay per plan row and are never propagated.
- Library variants with different ids are never merged; "Dips" ≠ "Assisted dips (machine)".
- A discarded or unfinished session never changes shared values.
- Every user-visible string in all 6 languages; Light/Dark tokens; ≥ 44 px targets; inputs ≥ 16 px.
- Release: `CACHE_VERSION` `v100`, every `?v=` → `106`. Commit/push only with the owner's approval.

## Review Focus

- Two devices (or a v90 device) loading the same account must not produce a sync conflict or two different
  ids for the same custom exercise. → Task 1 test "two devices, same ids, no conflict" (local stack).
- A sync apply or plan edit on another device during a running workout must not change the running
  workout's weights. → Task 3 test "snapshot".
- A state saved by v100 and re-saved by v90 (Android app) keeps every plan row's `id`, `assisted`, weights and
  `settings.exerciseMemory`. → Task 6 test "old version round trip".
- Assisted values never create PRs, 5-kg milestones or "▲ heavier" messages. → Task 5 test.
- Unilateral exercises: the rule runs per side and the heavier side wins; a session with only one side
  done still updates. → Task 2 examples.

---

### Task 1: Stable exercise identity (deterministic for custom exercises)

**Files:** Modify `script.js` (`backfillState` ~9842 plan-exercise map, new helpers near `builtinExerciseId`
~12793, plan editor add-custom path, `customExercisesMatching` ~13775) · Create `tests/app/exercise-identity.js`.

**Interfaces:** Produces `exerciseIdentity(ex) -> string|null` = library id for built-ins, else
`'cx-' + stableHash(normalizedName)` where `normalizedName = name.trim().replace(/\s+/g,' ').toLowerCase()` and
`stableHash` is a deterministic 32-bit FNV-1a in base36 (no randomness — every device computes the same id);
`null` for an empty name. Backfill sets `row.id = exerciseIdentity(row)` on custom rows that have no id or
whose id is not a library id and not already `cx-…` (existing `cx-` ids are kept). New custom rows created in
the editor get the same id.

- [ ] **Step 1: Failing test**: rows "Dips" (library) and custom "My Curl" in two plans + " my  curl " in a third →
  both custom rows get the same `cx-` id, "Assisted dips" (custom) gets a different id, library rows keep
  their ids; running backfill twice changes nothing (idempotent); two fresh browsers loading the same saved
  state compute identical ids; `syncContentHash` equal after a second load (no false dirty); history untouched.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the test + `forward-compat.js`,
  `bento-home.js`, `plan-names.js`; local stack: `tests/sync/run.js "smoke|D3|no false conflict"`, plus a new
  scenario in `tests/sync/run.js` "identity: two devices, same ids, no conflict" (device A on v98 state with
  custom rows, device B same account; both load v100 → no conflict, one revision).
- [ ] **Step 5: Stop and report.**

### Task 2: Next-session working weight rule (pure function)

**Files:** Modify `script.js` (new pure helpers near `historyExerciseEntry` ~20838) · Create
`tests/app/working-weight.js` (Node-only unit test that loads the function source from script.js, pattern of the
`sw.js` function test in `tests/social/ui-chat-read.js`, plus one in-browser smoke).

**Interfaces:** `nextWorkingWeight(sets, opts) -> number|null`; `sets` = completed main sets in order
`[{ weight, side? }]` (drops excluded, failure-marked included); `opts = { assisted: boolean }`. Rule (spec §3.4):
a weight used in ≥ 2 completed sets → the highest such weight (assisted: the lowest such); otherwise the last
completed set's weight; no sets → `null`. Unilateral: compute per side, then take the heavier side (assisted:
the lower assistance).

- [ ] **Step 1: Failing test** with exactly the spec examples: 40/45/45 → 45; 60/60/50 → 60; 60/60/80 → 60;
  50/55/60 → 60; 60 + drop 40 → 60 (drop excluded upstream — assert the helper that builds `sets` from a session
  excludes drops); none → null; assisted 30/25/25 → 25; assisted 30/20 → 20; unilateral L 20/20, R 22/22 → 22;
  only left side done 20/20 → 20; bodyweight 0/0/0 → 0.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS.
- [ ] **Step 5: Stop and report.**

### Task 3: Apply on Finish + session snapshot

**Files:** Modify `script.js` (`confirmFinish` ~20919, `ensureSession`, activeSession normalizer ~9690,
`effectiveSetValue` ~11562, sync-apply path if it re-renders the session) · Create `tests/app/weight-memory.js`.

**Interfaces:** Consumes `exerciseIdentity`, `nextWorkingWeight`. Produces `rememberExerciseDefaults(identity,
values, at)` which writes `weight` (and, when given, `unilateral`, `startSide`, `assisted`) into every plan row
with that identity and into `settings.exerciseMemory[identity]` with `at = Date.now()`; one `saveState()` (normal
seq bump → syncs). `ensureSession` stores `activeSession.snapshot = { [sessionKey]: { weight, unilateral,
startSide, assisted } }` (add to the normalizer); while a session runs, planned values come from the snapshot,
not the live plan row. On Finish, for every exercise with ≥ 1 completed main set, apply the rule and remember
the result (unchanged result = no write). Quick-workout exercises and exercises started from the library update
`exerciseMemory` and every plan row with the same identity too.

- [ ] **Step 1: Failing test**: Push + Full Body both contain bench press (60); finish Push with 60/62.5/62.5 →
  next session in Full Body shows 62.5 in all sets; sets/reps of Full Body unchanged; history entry still shows
  60/62.5/62.5; discard instead of finish → nothing changes; **snapshot**: start a session (60), then change the
  plan row weight to 80 from "another device" (write state + call the sync apply path / `renderTrening`) → the
  running session still shows 60; quick workout from the library with a custom exercise → memory written;
  reload keeps everything.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS + `add-set.js`, `quick-workout.js`, `finish-discard.js`,
  `set-weights.js`, `drop-sets.js`.
- [ ] **Step 5: Stop and report.**

### Task 4: Plan editor sets the shared values

**Files:** Modify `script.js` (`saveEditPlan` ~13664 and the editor rows: weight, one-side-at-a-time,
start side) · Test: extend `tests/app/weight-memory.js`.

**Interfaces:** Consumes `rememberExerciseDefaults`. Saving the editor with a changed weight / unilateral /
startSide / assisted for a row calls `rememberExerciseDefaults` for that identity, so the same exercise in every
other plan updates; sets and reps never propagate. A one-line note under the weight field: "Shared with your
other plans" (`shared.note`, 6 languages) when the exercise appears in ≥ 2 plans.

- [ ] **Step 1: Failing test**: edit bench press weight to 70 in Full Body → Push shows 70; edit sets 3→5 in Full
  Body → Push keeps 3; toggle one-side-at-a-time on dumbbell curl in one plan → the other plan's curl is
  unilateral with the same start side; the note is visible only when the exercise is in ≥ 2 plans.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS + `plan-names.js`, `bento-home.js`.
- [ ] **Step 5: Stop and report.**

### Task 5: Assisted exercises

**Files:** Modify `script.js` (`EXERCISE_LIBRARY` ~164: add `assisted-dips` and `assisted-pull-ups` with
`assisted: true`, names in all 6 languages, alternatives to `dips` / `pull-ups`; editor "Assisted" toggle;
set-row caption; `personalRecords` ~10287, milestones ~10558, `previousWorkoutFor` / "vs last time"), `style.css`
· Create `tests/app/assisted.js`.

**Interfaces:** `isAssisted(ex) -> boolean` (library flag or row `assisted: true`). For assisted exercises the
weight caption reads "Assistance" (`session.assistance`), the unit "kg", the plan/history line "Assistance 25
kg" (`assisted.line`); lower = progress in "vs last time"; no PRs, no `ms-` milestones, no best-lift tile from
assisted values; the working-weight rule uses `{ assisted: true }`. Marking a custom row assisted gives it its
own identity only through its name (D3); a library "Dips" row is never merged with "Assisted dips".

- [ ] **Step 1: Failing test**: library shows both new entries in 6 languages; a session with assisted pull-ups
  30/25/25 → captions say Assistance, finish → next session 25, no PR/milestone/best-lift change, "vs last time"
  says less assistance as progress; a custom "Dips" row marked assisted shows Assistance; ordinary Dips
  unaffected.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS + `bento-home.js`, `bento-theme.js` (captions fit at
  320 px in de-facto longest languages fr/es/ar), `ios-zoom.js`.
- [ ] **Step 5: Stop and report.**

### Task 6: v100 release preparation and old-version compatibility (no push)

- [ ] Bump `CACHE_VERSION` `v100`, `?v=106`; README (weight memory rule with the examples, shared settings,
  assisted exercises); add the 5 new suites to `../claude-code/local-preview/regression.sh`.
- [ ] **Old version round trip** (new test `tests/sync/old-version-roundtrip.js` or a scenario in `run.js`, local
  stack): v100 writes state with custom ids, assisted rows and `exerciseMemory` and uploads; a v90 build
  (`git archive 5b20048`) loads the same account, edits an unrelated field and uploads; v100 loads again → all
  ids, assisted flags, weights and `exerciseMemory` intact, no conflict.
- [ ] Run `regression.sh`, `tests/sync/run.js` full, `bento-update.js` (`GQ_OLD_REF=HEAD`), `tests/sync/bento-upgrade.js`
  (v99 → v100 with a running session) → green except the two known harness items; screenshots of the editor note,
  assisted session, next-session weight (en/sk/ar, light/dark, 393 px) into `claude-code/improve-2026-10-30/phase3/`.
- [ ] Report to the owner; wait for release approval.
