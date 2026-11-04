> **Owner decision change (2026-11-04):** no conversion / no `settings.xpLegacy`. Workout and activity XP are
> derived from history with the new rules for every entry; levels may go down. Task 4 = recalculation; Task 5 note
> says XP was recalculated; Task 6 migration resets training XP so the recalculated value is accepted once.

# Phase 4 — XP, levels and achievements v2 (web v101 + migration 0017) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inflated XP model with spec §4 (workout/activity XP with daily limits, a rising level curve,
a new achievement table) for everyone the same way: all XP and levels are recalculated with the new rules (owner decision
2026-11-04, replacing the earlier "Convert XP" choice: "all users are on the same"). The leaderboard follows on the server.

**Architecture:** XP is derived, never accumulated: `totalXP = workoutXP + activityXP + achievementXP +
legacyBonus`. Old history entries keep the `xp` recorded when they were finished; new ones use the new rule.
The one-time conversion is stored as `settings.xpLegacy` (synced; unknown settings keys survive older versions).
Server: migration `0017_leaderboard_v2.sql` (+ `supabase/rollback/0017_down.sql`), detected by
`community_social_version()` = 9; the app sends the new fields only when the server is ≥ 9.

**Tech Stack:** vanilla JS (`script.js`, Slovak comments), Postgres/Supabase SQL, Node + headless Chrome tests,
local Supabase stack (docker project `gqtest`).

**Spec:** `docs/superpowers/specs/2026-10-30-gym-lift-improvements-design.md` §1.1, §4 (4.1–4.5), D1/D2;
owner decision "Convert XP" (this plan, Task 4).

## Global Constraints

- Never rewrite history entries' `xp`, achievements' unlock dates, or any record. Additive data only.
- No new top-level state keys; conversion data lives in `settings.xpLegacy`.
- Achievements stay merge-only: an earned id is never removed; ids dropped from the new table stay visible as
  earned badges worth 0 new XP (their old XP is inside the conversion).
- Displayed level after the update ≥ the level before it, for every user and every device (deterministic).
- Production: migration 0017 is applied only after the app release, with the owner's approval and the
  production write protocol (pre-check → exact change → impact/rollback → approval → post-check). Never `db push`.
- Every user-visible string in all 6 languages; Light/Dark tokens; ≥ 44 px targets.
- Web release: `CACHE_VERSION` `v101`, every `?v=` → `107`. Commit/push only with the owner's approval.

## Review Focus

- Two devices (or a device and an older app version) converting the same account must store the same
  `settings.xpLegacy` and never double the bonus. → Task 4 test "two devices, one conversion".
- A third workout on the same calendar day shows "+0 XP" and explains why; it is still saved normally. → Task 2.
- The first session of an exercise is never a PR; assisted PR = less assistance. → Task 3.
- The app talking to a server without 0017 (production before the migration) keeps submitting successfully
  with the old payload. → Task 6.
- A user with 0 XP before the update gets no bonus; a brand-new user has no `xpLegacy`. → Task 4.

---

### Task 1: XP engine (pure functions)

**Files:** Modify `script.js` (XP constants ~9216; `levelInfo` ~10471) · Create `tests/app/xp-engine.js`
(Node unit test extracting the functions from script.js, pattern `tests/app/working-weight.js`).

**Interfaces:** `cumXpForLevel(L) = 10*L*L + 70*L`; `levelCost(L) = 80 + 20*L`; `levelForXp(xp) -> { level,
into, cost }` (level = largest L with cumXpForLevel(L) ≤ xp); `workoutXpFor(doneSets) -> number` = 0 if
doneSets < 3, else 30 + 2*min(doneSets, 24); `activityXpFor(minutes) -> number` = 0 if minutes < 10, else
min(30, floor(minutes/2)). Daily limits are applied by callers (Task 2).

- [ ] **Step 1: Failing test**: cumXpForLevel 5/10/20/30/50 = 600/1700/5400/11100/28500; levelForXp(0)=L0,
  (79)=L0, (80)=L1, (2944)=L14 into 4 cost 360, (10730)=L29; workoutXpFor 2→0, 3→36, 15→60, 24→78, 40→78;
  activityXpFor 9→0, 10→5, 45→22, 120→30.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS. **Step 5:** Stop and report.

### Task 2: New XP at Finish and for activities (daily limit: first 2 per calendar day)

**Files:** Modify `script.js` (`confirmFinish` ~21611 xp, Finish bar label ~13006, activity save ~23561/23707,
history normalizer only if needed) · Create `tests/app/xp-daily.js`.

**Interfaces:** `xpForNewWorkout(doneSets, dateISO) -> number` = workoutXpFor unless 2 finished workouts with
xp > 0 already exist on that local calendar day → 0. `xpForNewActivity(minutes, dateISO)` likewise (activities
counted separately). The Finish bar shows the value the save will award; when it is 0 because of the limit, the
"Save workout?" sheet says why (`xp.dailyLimit` "You've earned XP for 2 workouts today — this one is saved
without XP."; 6 languages). Old entries keep their stored `xp`; nothing is recomputed.

- [ ] **Step 1: Failing test**: 1st/2nd workout of a day with 15 sets → 60 each, 3rd → 0 and saved with all
  sets; < 3 sets → 0; an activity of 45 min → 22, 3rd activity that day → 0; a workout finished after midnight
  counts for the new day; Finish label equals the saved `xp`; stored values are never recomputed later (undoing the 2nd
  workout does not change the 3rd's stored 0).
- [ ] **Step 2–4.** Also run `finish-discard.js` (its XP-once check now expects the new value), `quick-workout.js`,
  `bento-home.js`. **Step 5.**

### Task 3: Achievement table v2

**Files:** Modify `script.js` (`staticAchievementDefs`, `evaluateAchievements`, `achievementDateFor`,
`reconcileAchievements` ~10840, PR helpers `prStats`/`personalRecords`, achievement screen rendering ~20854,
i18n) · Create `tests/app/achievements-v2.js`.

**Interfaces:** New defs exactly per spec §4.3 (ids, conditions, XP): first 25; start3 50; goal1/4/12/26
50/100/250/400 (excused weeks don't count); streak4/8/12/26 150/300/450/800; w10/25/50/100/250
100/200/350/600/1000; pr1/pr10/pr25 50/150/300 (PR = heavier working weight than any EARLIER session of that
exercise; first session = baseline; assisted = less assistance; history entries' `assisted` flag decides);
steady5 100; back 50; rest5 25 (needs a per-workout "rest timer used" flag: record `restUsed: true` on the
history entry at Finish when any rest timer ran during the session — additive); ownplan 25; fullbody 25;
explorer10 50; body4 50; together 50; balanced10 25. Old ids not in the table (fourplans, customplan, customex5,
missedweek, comeback, xp200, weeklygoal1, consistent*, solid*, fullweek, newpr, pr5, improve, variety4, five,
ten, twentyfive, fifty, hundred, …) remain in `state.achievements` and render under "Earlier badges" with no
XP. Old ids that equal a new id keep their date. Names/descriptions in 6 languages.

- [ ] **Step 1: Failing test** per achievement: the exact boundary (e.g. start3 with workouts on day 0/5/14 → yes,
  day 0/5/15 → no; pr1 not on a first session; assisted 30→25 is a PR; steady5; back after ≥ 14 days gap + 2 in
  7 days; rest5 with restUsed; goal1 not from an excused week); an old `fourplans` badge is still shown but gives 0
  XP; nothing ever unlocks twice; fresh install unlocks nothing.
- [ ] **Step 2–4.** Also `bento-home.js`, `assisted.js`, `weight-memory.js`. **Step 5.**

### Task 4: One-time XP conversion (owner decision "Convert XP")

**Files:** Modify `script.js` (new `ensureXpConversion()` called from load/backfill after achievements are
reconciled; `totalXP`, `levelInfo`) · Create `tests/app/xp-convert.js`; scenario in `tests/sync/run.js`.

**Interfaces:** `oldRulesTotal()` = Σ history `xp` + Σ activity `xp` + Σ OLD achievement table XP of earned ids
(copy the old table from 0009/current `staticAchievementDefs` as `ACHIEVEMENTS_V1_XP`). `oldLevel =
floor(oldTotal/100)`, `frac = (oldTotal % 100)/100`. `converted = cumXpForLevel(oldLevel) + floor(frac *
levelCost(oldLevel))`. `newTotalNow = Σ history xp + Σ activity xp + new achievementXP()`. `bonus = max(0,
converted - newTotalNow)`. Store `settings.xpLegacy = { v: 1, bonus, fromXp: oldTotal, fromLevel: oldLevel }`
ONLY if `settings.xpLegacy` is absent and the state has any history/activities/achievements from before this
version; never recompute once present (another device's stored value wins via sync; identical inputs give
identical results). `totalXP = … + (settings.xpLegacy?.bonus || 0)`.

- [ ] **Step 1: Failing test**: owner-like state (old total 2944, L29 44 %) → displayed level 29, XP ≈ 10,730,
  next level after the expected amount; 0 XP state → no xpLegacy; fresh install → none; idempotent (reload
  twice); **two devices** (local stack): both load the same pre-update account → one xpLegacy value, no conflict,
  no doubled bonus; level shown == old level for 10 random synthetic histories (property check: new level ≥ old
  level, and < old level + 1); old-version round trip keeps `settings.xpLegacy`
  (`tests/sync/old-version-roundtrip.js` extension).
- [ ] **Step 2–4.** **Step 5.**

### Task 5: Level and XP UI

**Files:** Modify `script.js` (Today level tile, You/profile level, level-up toast, achievements screen, any
"XP to level N" text), `style.css` · Test: extend `tests/app/bento-home.js` / `tests/app/xp-convert.js`.

**Interfaces:** All level displays use `levelForXp(totalXP())`; progress bar = `into / cost`; "N XP to level L"
uses the new cost; the achievements screen shows new achievements with XP and an "Earlier badges" section; a
short one-time note after the update ("Levels now grow step by step — you kept your level", `xp.converted`, 6
languages, device-only dismiss flag in localStorage).

- [ ] **Step 1: Failing test**: tile shows L29 / correct remaining XP for the converted state; progress bar width
  matches; earlier badges listed without XP; note shown once, then never again on that device.
- [ ] **Step 2–4** + screenshots (en/sk/ar, light/dark, 393 px) → `claude-code/improve-2026-10-30/phase4/task5/`.
  **Step 5.**

### Task 6: Leaderboard v2 (migration 0017), app compatibility, v101 prep

**Files:** Create `supabase/migrations/0017_leaderboard_v2.sql`, `supabase/rollback/0017_down.sql`; modify
`script.js` (`leaderboardPayload` ~16180, version detection), `supabase/README.md`, `README.md`, `CLAUDE.md`
(version list), `tests/social/leaderboard.js`, `tests/social/ui-leaderboard.js`; bump `sw.js`/`index.html`.

**Interfaces (SQL):** `community_social_version()` → 9. New `leaderboard_achievement_value_v2(p_ids text[],
p_workouts int)` with the §4.3 table (min-workout guards like 0009). `leaderboard_entries`: new column
`legacy_xp integer not null default 0 check (legacy_xp between 0 and 2000000)`; `achievement_xp` check raised to
the new table's max; `total_xp` = training + achievement + legacy; `level` generated as
`floor((sqrt(4900 + 40*total) - 70) / 20)`. The migration converts every existing row once with the same formula
as Task 4 from its stored totals (old level = total/100) into `legacy_xp`. `leaderboard_submit` gains
`p_legacy integer default null`: accepted only up to the row's migration ceiling (`legacy_cap`, set by the
migration; new rows 0); old 5-arg signature keeps working. Rollback drops the new column/functions and restores
0009's definitions exactly. One transaction.
**Interfaces (app):** send `p_legacy` and v2 ids only when `communityVersion >= 9`; otherwise the old payload.

- [ ] **Step 1: Failing tests** (local stack): `leaderboard.js`: after 0017 a converted row keeps its level, a new
  user's level follows the curve, `p_legacy` above the cap is clamped, old 5-arg calls still work, rollback then
  reapply restores 0009 behaviour; `ui-leaderboard.js`: levels shown match the app.
- [ ] **Step 2–4.**
- [ ] **Step 5:** `CACHE_VERSION` `v101`, `?v=107`; README (XP rules, daily limit, levels, conversion,
  achievements); `supabase/README.md` 0017 release + rollback steps (app first, then migration); add the new suites
  to `regression.sh`; run `regression.sh`, `tests/sync/run.js` full, `bento-update.js` (`GQ_OLD_REF=HEAD`),
  `bento-upgrade.js` (v100 → v101), `old-version-roundtrip.js`, `tests/social/run.js` leaderboard parts → green
  except the known harness items.
- [ ] **Step 6:** Report to the owner; the production migration is a separate, approved step.
