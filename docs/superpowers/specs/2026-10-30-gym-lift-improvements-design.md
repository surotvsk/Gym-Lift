# Gym-Lift improvement project — audit, phases and proposals (2026-10-30)

Status: **approved 2026-10-30** (D1 = A, D2–D7 as proposed, plus D8). Nothing implemented yet. Everything stays local until the owner approves each release.
Sources: code audit of `main` at v90 (5b20048), screenshots in `claude-code/improve-2026-10-30/audit/`.
Labels used below: **[BUG]** confirmed defect · **[UX]** improvement · **[DATA]** data-model change ·
**[SERVER]** needs a Supabase migration / Edge Function deploy (production approval) ·
**[NATIVE]** Android wrapper change (new AAB) · **[EXT]** needs external configuration by the owner ·
**[LIMIT]** platform limitation.

## 0. Ground rules for every phase

- Never overwrite populated records with defaults; every new field is additive.
- **Compatibility constraint (confirmed in code):** `migrateV2toV3` rebuilds the saved state from a fixed list
  of top-level fields, so **any new top-level field is dropped by older app versions** (e.g. the Android app
  v90, an old Home-Screen icon) and would be lost on their next upload. Fields *inside plan exercises* and
  unknown keys *inside `settings`* survive older versions. New data therefore lives there (see §3), and the
  first release of this project also teaches the loader to keep unknown top-level fields for the future.
- Synthetic local accounts only; no real user's data is read or changed.
- Each phase: acceptance criteria → focused change → regression tests → upgrade test from v90 →
  data-model + rollback note → owner approval → release.

## 1. Audit findings

### 1.1 XP and achievements (current)
- Workout XP = 20 + 2 per completed set (13 sets → 46). Activity XP = flat **20 for any activity, even 1 s**
  (farmable). Levels are linear: 100 XP per level.
- 25 static achievements worth up to 5,150 XP; per-exercise 5 kg milestones (`ms-…`) give 0 XP.
- Inflation sources: **"four plans" (+100) unlocks on install** (5 default plans), "custom plan" (+50) and
  "5 custom exercises" (+125) need no training; the first appearance of every weighted exercise counts as a
  **PR**, so "first PR" (+75) and "5 PRs" (+150) unlock in the first one or two sessions.
  Measured: the built-in sample data (3 workouts) reaches **level 7 / 796 XP**; Vera reached 275 XP with
  zero workouts.
- Perverse incentives: "comeback" (+100 after a 14-day gap) and "missed week" (+150) reward skipping.
- Achievements are merge-only (never removed) — good for safety, but means rebalancing needs an explicit
  migration decision.
- The leaderboard (0009) recomputes achievement XP **on the server** from a hard-coded table
  (cap 5,150) and limits training XP growth → any XP change needs a server migration **[SERVER]**.

### 1.2 Weight memory (current) — **[BUG]**
- Finishing a workout records every set (`setWeights`, `sideWeights`, drops) and the heaviest completed set
  (`weight`) in history, but **nothing is written back to the plan**. The next session starts again from the
  plan's old weight; the app only shows "▼ x kg vs last time".
- Weight is stored per plan row; the same exercise in two plans has two unrelated weights.
- Custom exercises have **no stable id** (identified by name `c:<name>`); built-in ones use library ids.
- No assisted exercises exist in the library; "assisted dips" can only be a custom exercise, and a larger
  number is treated as better everywhere (PRs, milestones, "vs last time").

### 1.3 Workout screen, timer, settings, stats (screenshots)
- No "Add set" in the active workout; removing sets only via the plan editor. Set pills read
  "S1 12× 0 kg 🔥" — weight vs reps vs failure is not obvious.
- "Finish · +20 XP" is a small pill next to "Discard" in the session tile.
- Rest timer: deadline-based (survives reload — good) but the countdown is a slim bar above the tab bar that
  covers exercise content; the selected preset is not marked; no pause/restart.
- Settings: sections run together ("AUTOMATIC BACKUP … ON"), headings/descriptions/controls touch.
- Large empty top area on Today/Workout/Stats headers.
- Stats month: needs a visual + date-boundary check (owner reports misalignment) — to verify in Phase 1.

### 1.4 Account, sync, sign-out
- Account sync is **already on by default** for signed-in accounts (`meta.disabled = false`); it is off only
  after an explicit "turn off / delete cloud backup". v88 already blocks uploading lost local data.
- Sign-out (`communitySignOut`) pauses sync and switches to the guest workspace; account data stays on the
  device. **It does not tell the user about unsynced changes [UX]**, and the button sits in
  You → Settings and privacy, not in Settings → Account.

### 1.5 Android (Capacitor 8 wrapper, own Kotlin plugins GymHealth, GymBars)
- `@capacitor/local-notifications` is present (reminders channel). `SCHEDULE_EXACT_ALARM` is removed from
  the manifest (earlier fix), so scheduled notifications are inexact.
- The rest timer gong is Web Audio inside the WebView — **silent when the screen is off or the app is in the
  background [BUG on Android]**.
- Sign-in is Supabase email + password only.

### 1.6 Community and chat
- Feed (`community_feed`): pure recency per scope (everyone / following / friends), keyset pagination.
- Chat header already has a profile button (`cchat-who` → `open-user`); Back-to-conversation state/scroll and
  avatar tap need verification.
- Push for chat is sent regardless of whether the recipient is looking at that chat; read markers are written
  when the chat is open (0015) — visibility/viewport conditions to verify.

## 2. Phases (dependencies → order)

| Phase | Content | Needs | Release |
|---|---|---|---|
| 1 | Bug fixes & polish: chat→profile/back, chat read-state + in-app suppression, Stats month, settings spacing, top spacing, Sign-out in Settings with unsynced check, loader keeps unknown top-level fields, default plan names, remove excuse option (D8) | web only | v91 |
| 2 | Workout UX: active-workout redesign (Add set, remove set, labels, Finish vs Discard), rest timer UI (selected preset, big countdown, pause/resume/restart/cancel), start workout from an exercise | Phase 1 | v92 |
| 3 | Shared exercise data: stable ids, weight-memory rule, cross-plan propagation, assisted exercises | Phase 2 UI, loader fix released first | v93 |
| 4 | XP + achievements rebalance | owner decisions D1–D2, **[SERVER]** leaderboard migration | v94 + migration |
| 5 | Tutorial (built on the Phase-2 UI) | Phase 2 (and 3 for the weight-memory hint) | v95 |
| 6 | Android: native rest-timer alerts; Google sign-in | **[NATIVE]**, **[EXT]** | AAB vc3 (+ web) |
| 7 | Community feed ranking; chat push suppression while viewing | **[SERVER]** | migration + fn deploy |

Phases 1–3 and 5 are web-only and testable here end to end; 4, 6, 7 need production approvals.

## 3. Exercise data model and rules (Phase 3)

### 3.1 Layers (never mixed)
1. **Shared exercise defaults** — per exercise identity: remembered working weight, one-side-at-a-time
   (`unilateral`, `startSide`), assisted flag. Same value in every plan.
2. **Plan-specific** — sets, reps, order, failure/drop habits: per plan row, never synchronized.
3. **Active session** — values typed during a workout; a snapshot of the defaults is taken **when the
   session starts**, so another plan/device changing defaults never changes a running workout.
4. **History** — immutable records; updating defaults never rewrites them.

### 3.2 Identity
- Built-in: the library id (`bench-press`, …) — unchanged.
- Custom: every custom plan row gets a stable `id` `cx-<random>`; at migration, rows **with exactly the same
  normalized name** (trim, case-insensitive) inside one user's own plans get the same id. Different names stay
  different exercises (e.g. "Dips" ≠ "Assisted dips"). Only the user's own local state is involved; nothing
  is matched across users. → decision **D3**.
- Library variants with different ids (e.g. dumbbell vs barbell) are never merged.

### 3.3 Storage (compatible with older app versions)
- The shared values are written into **every plan row with the same identity** (fields that older versions
  already keep: `weight`, `unilateral`, `startSide`; new `assisted`, `id`), plus
  `settings.exerciseMemory[id] = { weight, assisted, unilateral, startSide, at }` for exercises not in any
  plan (started from the library). Both survive older versions.
- Precedence when they disagree (e.g. an old device edited one plan): newest `at` wins on the next
  propagation; the user's explicit edit in the plan editor always sets the shared value.

### 3.4 Next-session working weight (precise rule)
Applied **only when a workout is finished and saved** (never for discarded/unfinished sessions), per
exercise, using **completed main sets** (marked done; drop-set entries excluded; failure-marked sets count):
1. If one weight was used in **2 or more completed sets**, take the **highest such weight**.
2. Otherwise take the weight of the **last completed main set**.
3. No completed set → nothing changes.
4. One-side-at-a-time: apply per side, then use the heavier side (sides are shown separately anyway).
5. Assisted exercises: same rule with "highest" replaced by **lowest assistance**.
Examples: 40/45/45 → **45** (your example); 60/60/50 (lighter last set) → 60; 60/60/80 single → 60;
50/55/60 pyramid → 60 (last completed); 60 + drop 40 → 60. Warm-up sets do not exist in the app today
**[LIMIT]**; if added later they are excluded.

### 3.5 Assisted exercises
- New library entries "Assisted dips (machine)" and "Assisted pull-ups (machine)"; any exercise can be marked
  **Assisted** in the plan editor.
- The number is labelled **"Assistance kg"**; "less assistance = progress" in comparisons; no PR/milestone
  XP from assistance values; never merged with "Dips"/"Weighted dips".

## 4. XP model and achievements (Phase 4) — proposal for decisions D1/D2

### 4.1 XP sources
- **Finished workout:** 30 XP if it has **≥ 3 completed sets**, + 2 XP per completed set, max 24 sets
  counted (max 78 XP). Only the **first 2 finished workouts per calendar day** earn XP (others are saved
  normally, 0 XP). No extra XP for weight or volume.
- **Activity (run/walk/ride):** 1 XP per 2 active minutes, from 10 minutes, max 30 XP; first 2 per day.
- **Achievements:** below. Plan building and exploring features give small or no XP.

### 4.2 Levels
Cost of the next level = 80 + 20 × current level (L0→1: 80, 1→2: 100, 2→3: 120 …).
Cumulative XP for level L = 10·L² + 70·L (L5 = 600, L10 = 1,700, L20 = 5,400, L30 = 11,100, L50 = 28,500).

### 4.3 Achievements (all one-time; stored once by id, so they can never unlock twice)
| Id | Name | Exact condition | XP |
|---|---|---|---|
| first | First workout | 1 finished workout | 25 |
| start3 | Getting started | 3 finished workouts within 14 days of the first | 50 |
| goal1 / goal4 / goal12 / goal26 | Weekly goal ×1/×4/×12/×26 | calendar weeks with the weekly goal met (excused weeks don't count) | 50 / 100 / 250 / 400 |
| streak4 / 8 / 12 / 26 | Streak 4/8/12/26 weeks | current streak reaches N | 150 / 300 / 450 / 800 |
| w10 / w25 / w50 / w100 / w250 | 10/25/50/100/250 workouts | finished workouts | 100 / 200 / 350 / 600 / 1000 |
| pr1 / pr10 / pr25 | First PR / 10 / 25 PRs | heavier working weight than **any earlier session of that exercise**; the first session of an exercise is its baseline, not a PR; assisted = less assistance | 50 / 150 / 300 |
| steady5 | Steady progress | working weight increased on 5 different exercises | 100 |
| back | Back on track | after ≥ 14 days without training, 2 finished workouts within 7 days | 50 |
| rest5 | Rest counts | rest timer used in 5 finished workouts | 25 |
| ownplan | Your plan | finish a workout with a plan you created | 25 |
| fullbody | Full body | finish a workout with a Full Body plan | 25 |
| explorer10 | Explorer | 10 different exercises across finished workouts | 50 |
| body4 | Body tracker | body weight logged in 4 different weeks | 50 |
| together | Train together | finish a train-together session | 50 |
| balanced10 | Balanced | 10 finished one-side-at-a-time exercises | 25 |
No achievements for volume, heavy singles or training every day (safety). "Four plans", "custom plan",
"5 custom exercises", "missed week", "comeback" stop giving XP (kept as earned badges if D1 = keep).

### 4.4 Example progression (15 sets/workout = 60 XP)
- **New user, week 1, 3 workouts:** 180 + first 25 + start3 50 + goal1 50 = **305 XP → level 3**
  (today: level ~7).
- **Moderate, 3/week for 3 months (36 workouts):** 2,160 + achievements (first, start3, goal1/4/12,
  streak4/8/12, w10, w25, pr1, pr10, rest5, steady5 = 2,000) ≈ **4,160 → level 17**.
- **Long-term, 4/week for 2 years (~400 workouts, 18 sets = 66 XP):** 26,400 + ~6,000 ≈ **32,400 → level 53**.

### 4.5 Migration (decision D1, needs approval; nothing is recalculated silently)
- **Option A (recommended): keep everything earned.** Existing unlocked achievements and their XP stay as a
  "legacy" bonus (`settings.xpLegacy`, computed once per device from the old rules at upgrade and kept as the
  max), new rules apply to new progress, and the displayed level is never lower than before the update.
- Option B: recalculate everyone with the new rules (levels drop, e.g. the owner's 2,8xx XP from ~28 to ~13).
- Server: new `0017_leaderboard_v2` with the new achievement table/caps, reversible; apply only after the app
  release (same order as earlier migrations).

## 5. Workout screen and rest timer (Phase 2)
- Session tile: exercise name, set rows "Set 1 · **Weight** [kg] · **Reps** [×] · ✓" with labelled numeric
  inputs (`inputmode="decimal"`/`numeric`, 16 px, ≥ 44 px targets), clear completed state.
- **+ Add set** under each exercise (copies the last set's weight/reps; never touches other sets).
  Removing a set: swipe/⋯ menu with confirmation if it has data or is completed.
- **Finish workout**: large primary button at the end of the list and in a sticky bar above the tab bar;
  confirm sheet "Save workout / Keep training". **Discard** moves into the ⋯ menu with a two-step confirm.
  Double tap protection on Finish.
- Rest timer: tapping a preset immediately shows a large countdown card (sticky, above the tab bar, never
  over inputs), the chosen preset highlighted, Pause/Resume, +15 s, Restart, Stop; starting another preset
  replaces the running timer explicitly ("Replaced 90 s with 120 s"). Remaining time always computed from the
  stored deadline.
- **Start from an exercise**: "Start workout with this exercise" in the exercise sheet → a quick session
  ("Quick workout") using the normal session/finish/history code; if a workout is running: "Add to current
  workout" / "Go to current workout" — never discards it.

## 6. Android rest-timer alerts (Phase 6) — [NATIVE]
- New Kotlin plugin **GymRest**: on timer start schedules an `AlarmManager.setExactAndAllowWhileIdle`
  alarm **if** the user granted "Alarms & reminders" (Android 12–13 default granted, **Android 14+ the user
  must allow it** — the app asks once, with explanation); otherwise falls back to a foreground service with a
  countdown notification (type `shortService` ≤ 3 min; longer timers use the inexact alarm and the app says
  it may be late) **[LIMIT]**.
- Alert = high-priority notification on a dedicated "Rest timer" channel with its own sound; Android routes
  notification sound to connected wired/Bluetooth headphones according to system settings; no override of
  silent mode / Do Not Disturb **[LIMIT]**.
- Cancel/replace: every timer has an id; starting/stopping cancels the previous alarm/notification.
- Play Console: exact-alarm use must match policy (timer is core functionality) **[EXT]**.
- Test: Samsung A21s (Android 12) + emulator Android 15/17: screen off, background, headphones (wired/BT
  where available), permission denied, battery saver.

## 7. Google sign-in (Phase 6) — [NATIVE] [EXT]
- **Sign in with Google** (Google account), **not** Google Play Games Services (that is for games and gives
  no email-based account).
- Android: Credential Manager (`androidx.credentials` + Google ID) in a small own Kotlin plugin → ID token →
  `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`. Web (optional): Supabase OAuth
  redirect.
- Existing accounts: Supabase links a Google identity to an existing account with the **same verified
  e-mail**; unverified e-mail/password accounts are not auto-linked — the app then explains "sign in with your
  password first, then connect Google in Settings" (manual linking with `linkIdentity`). No duplicate accounts
  created silently; cancellation returns to the sign-in screen without changes.
- External setup the owner must do (no values invented): Google Cloud project → OAuth consent screen;
  **Web client ID + secret** (entered in Supabase → Auth → Providers → Google); **Android client ID** with the
  **SHA-1 of the Play app-signing key** (Play Console → App integrity), the upload key and the debug key;
  Supabase redirect URLs (already include Gym-Lift).

## 8. Community feed (Phase 7) — [SERVER]
- New RPC `community_feed_ranked`: tier 1 = posts from friends and followed accounts (newest first),
  tier 2 = recommended public posts from others, ordered by recency with a small boost for posts liked by
  people you follow and a cap of 2 consecutive posts per author; recommended posts carry a "Suggested" label.
- Same visibility/moderation/block rules as `community_feed`; keyset cursor `(tier, created_at, id)` →
  stable pages, no duplicates; new users with no follows get tier 2 only. No tracking beyond existing data.

## 9. Chat notifications and read state
- Read: a message counts as seen only when the chat is open, `document.visibilityState === 'visible'` and the
  message bubble has been on screen (IntersectionObserver).
- Foreground: Android app suppresses the system notification for the conversation currently visible; web
  service worker skips showing it when a focused window reports that conversation as visible (Chrome
  allows this; **iOS Safari requires showing every push [LIMIT]** → server-side skip below).
- Server **[SERVER]**: the client reports "viewing conversation X" (heartbeat while visible); the push
  function skips recipients viewing that chat in the last ~30 s. Badges recount from read markers.

## 10. Tutorial (Phase 5)
- First-run, guest and newly registered users: 5 steps anchored to real controls — (1) pick a plan or start
  from an exercise, (2) Start, (3) weight vs reps and the ✓, + Add set, (4) rest timer presets and the running
  countdown, (5) Finish vs Discard and where History/Calendar show the result; plus one line on the tab bar
  (Exercises, Community, Messages, You). Skip / Back / Next / Close; replay in Settings → Help.
- Existing users: one dismissible invitation card, never forced. State in a device-only key
  (`gymquest_tutorial`), never in workout data; the tutorial never creates plans, sets, XP or history.
- Exact texts in 6 languages are written in Phase 5 against the final Phase-2 UI.

## 11. Test plan (every phase)
Existing suites + new: weight-memory rules (all examples in §3.4), cross-plan propagation, old-version
compatibility (state written by the new app loaded and re-saved by v90 keeps all data), assisted labels,
XP calculator vs examples, timer deadline after background/resume, tutorial no-data-change check, feed
pagination/visibility (local stack), chat read/viewing, Android device tests. Light/Dark/System, 6 languages,
393 px, offline, account switching.

## 12. Decisions needed from the owner
- **D1** XP migration: A (keep earned, recommended) or B (recalculate).
- **D2** XP model and achievement list (§4) — approve or change.
- **D3** Custom exercises with exactly the same name in your own plans become one exercise (shared weight).
- **D4** Weight-memory rule (§3.4).
- **D5** Default plan names: Push → "Chest, Shoulders & Triceps", Pull → "Back & Biceps", Legs → "Legs",
  only for untouched built-in plans whose exercises still match the defaults.
- **D6** Phase order and per-phase releases (table §2).
- **D7** Android exact-alarm approach (ask for "Alarms & reminders" permission on Android 14+).
- **[EXT]** Google Cloud OAuth clients + Supabase Google provider (§7) when Phase 6 starts.
- **D8 (owner, 2026-10-30): remove the "excuse a week" option.** No new excuses can be made (the Today tile
  "Busy week? Excuse it", the excuse sheet and its buttons go away). Weeks excused before the update keep
  counting for streaks and achievements (stored `excusedWeeks` untouched, nobody's streak drops). Phase 1.

## 13. Decisions recorded
D1 A (keep earned XP, legacy bonus, level never lower), D2–D7 approved as written, D8 as above.
