# Phase 8 — 3-button navigation bar, body fat, measurement chart, heart-rate chart, reminders (web v107)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Owner request (2026-11-10), with answers to clarifying questions:**
1. Phones with **3-button navigation**: the tab bar is docked full-width directly above the system buttons
   (like Instagram, owner's screenshot), not a floating pill. Gesture navigation, iPhone and browsers stay as they are.
2. **Body fat % calculator — US Navy tape method.** The result is saved with the date in Body measurements and is
   shown on the chart.
3. **Body measurements:** a **bigger dated chart** (dates on the axis, values on points) and **compare two dates**.
4. **Heart-rate chart:** a real heart-rate-over-time chart on finished workouts (Android, Health Connect, from the
   watch) **and** a Google Play listing screenshot of it.
5. **Reminders:** **water at exact times** (not only "every N minutes"), **more meal times** (up to 6) and **own
   reminders** with own text, time and days.

**Architecture:** vanilla JS PWA (`script.js`, Slovak comments), `style.css` Bento tokens, `index.html`, `sw.js`;
Android Capacitor plugins in `android/app/src/main/java/surotvsk/gymapp/`; Supabase migrations + Edge Functions.
Read `CLAUDE.md` in the repo first.

## Global Constraints

- Every user-visible string in 6 languages (sk, en, es, pt-BR, fr, ar RTL). Tokens, not literal colours; Light/Dark.
  Touch targets ≥ 44 px, inputs ≥ 16 px. Works at 320 px and 130 % text. Keyboard/screen-reader labels.
- **No data loss with older apps.** The Android app in Play (vc5) runs web v105 and syncs the same state. A field an
  old normalizer drops (e.g. `cleanMeasurement` keeps only `MEASURE_FIELDS`) must not silently erase new data for
  everyone: verify with `tests/sync/old-version-roundtrip.js`-style evidence and choose a storage shape that survives
  (or document precisely what an old client can lose and get a controller ruling). No new top-level state keys.
- Heart-rate samples are private: never synced to the server, never shared in Community, never stored in `state`
  beyond what already exists (avg/max). Charts read from Health Connect on demand.
- Production (Supabase `mbjbtprkwvoqgqphgudq`) is never touched by workers. Server work = migration + rollback +
  local tests only; production goes through the owner's protocol later.
- Old app versions keep working against the new server (reminders_set from v105/v106 must not wipe new reminder
  fields; reminders_get keeps its old keys).
- Release: `CACHE_VERSION` `v107`, every `?v=` → `113` (Task 6 only). Android versionCode 6 is built later
  together with Google sign-in — not in this plan.

---

### Task 1: 3-button navigation — docked tab bar (Android app)

**Files:** `GymBarsPlugin.kt` (or a small method on it), `script.js` (native bars init), `style.css`, test.
- Detect navigation mode natively: `Settings.Secure` `navigation_mode` (0 = 3-button, 1 = 2-button, 2 = gesture) with a
  fallback on the navigation-bar inset height (≥ 40 dp ⇒ buttons). Expose `GymBars.navMode() → { mode: 'buttons' |
  'gesture' }` and re-check on resume/configuration change. JS sets `html.nav-buttons` only in the native app.
- `html.nav-buttons`: the tab bar is a full-width bar flush to the bottom edge of the WebView (directly above the
  system buttons), square top corners or a subtle top border, solid themed background, same icons/active state,
  no floating gap; content padding and every element positioned from `--tabbar-h` (update banner, sticky Finish
  bar, rest card, toasts) still clear it. Without the class nothing changes.
- Test: headless Chrome with the class forced (geometry: bar spans the viewport width, bottom = viewport bottom,
  nothing hidden under it at 320/393 px, light/dark, ar); plus an emulator check that switches
  `cmd overlay enable com.android.internal.systemui.navbar.threebutton` / `…gestural` and reads the class
  (emulator-5554 only — never the owner's phone).

### Task 2: Body fat % (US Navy) saved as a measurement

**Files:** `script.js` (measurements, Body screen), `index.html` (modal or section), `style.css`, test.
- New measurement field **neck (cm)** and **body fat %** (`bodyFatPct`, 3–60). Height and sex come from the existing
  calorie profile (`state.profile`); if missing, the calculator asks for them (saved to the profile as today).
- Navy formula (cm, log10): men `495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450`;
  women `495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450`. Round to 0.1. Reject
  impossible input (waist ≤ neck etc.) with a clear message. Imperial display follows the existing unit setting.
- UI: "Body fat calculator" on the Body screen: inputs prefilled from the latest measurement, live result with a
  one-line explanation ("estimate, ±3–4 %"), **Save** writes/updates the measurement of the chosen date (default
  today) with neck/waist/hip and `bodyFatPct`. It appears in history, summary and the chart metric chips.
- Age 18+ wording like the calorie calculator? Not required (no targets are given) — only the estimate.
- Tests: formula against known values (male 180/85/38 → ≈ 18.6 %; female 165/75/32/100 → ≈ 29.4 %; compute exact
  expected values in the test from the formula and check the UI shows them), save/edit/delete, units, 6 languages,
  old-client survival evidence (Global Constraints).

### Task 3: Bigger dated chart + compare two dates

**Files:** `script.js` (`renderBodyChart`, history), `index.html`, `style.css`, test.
- Replace the sparkline with a responsive SVG line chart: y-axis with 3–5 nice ticks in the display unit, x-axis
  date labels (locale format, no overlap at 320 px), a dot per entry; tapping/focusing a dot shows date + value.
  Metric chips stay (now incl. neck and body fat %). Range: All / 3 months / 1 month chips. Empty/one-point states
  stay readable. RTL keeps time flowing in the natural reading direction for charts (document the choice).
- **Compare:** pick two dates (two selects of existing entries; defaults first vs latest) → a table: every
  measurement present in both, value A, value B, difference with sign and colour (down = good for waist/body fat,
  neutral wording otherwise), plus days between.
- Tests: chart geometry (points ordered by date, labels inside the card, no overflow at 320 px ar/fr 130 %),
  tooltip text, range filter, compare table values/signs, units (kg/lb, cm/in).

### Task 4: Heart-rate chart on finished workouts (Android)

**Files:** `GymHealthPlugin.kt` (new method), `script.js` (health section of a history entry), `style.css`, tests.
- `GymHealth.heartRateSamples({ start, end })` → `{ samples: [{ t: epochMs, bpm }] }` from `HeartRateRecord`
  samples in the workout window, sorted, at most ~300 points (downsample by time buckets, keep max per bucket).
  Permission READ_HEART_RATE already exists; denial/unavailable → no chart, existing text stays.
- On a finished workout that has `health.start/end` (native app, Health Connect on): a compact chart of bpm over
  workout minutes with avg line and max marker, loaded on demand when the entry is opened (never stored in state,
  never synced, never shared). Loading/empty/denied states in 6 languages.
- Tests: plugin parsing/downsampling (unit-style where possible), web chart with a mocked plugin (geometry, avg/max,
  no samples → text only, nothing written to state/localStorage), Kotlin compiles (`assembleDebug`).
- **Play listing image:** render the chart in headless Chrome with a realistic demo series inside the real UI at
  1080×1920 (phone portrait), light and dark, save PNGs to `../claude-code/play-listing/heart-rate/`. The controller
  uploads them with the owner.

### Task 5: Reminders — water at exact times, up to 6 meals, own reminders (server + app)

**Files:** `supabase/migrations/0019_reminders_v2.sql`, `supabase/rollback/0019_down.sql`,
`supabase/functions/reminders/index.ts`, `script.js` (reminders card + `nativeReminderSchedule`), tests in
`tests/social/`.
- Schema (additive): `water_mode` ('interval' | 'times', default 'interval'), `water_times time[]` (≤ 12),
  `custom jsonb` array (≤ 10) of `{ id, text (1–60 chars, trimmed), time 'HH:MM', days [1..7] }`. Keep all
  existing columns/keys. `reminders_get` returns the new keys too; `reminders_set` validates them and, when a key is
  **absent** (old app), keeps the stored value (never wipes). `reminders_due` + the Edge Function send water at the
  exact times (mode 'times') and custom reminders with their own text (escaped, no HTML). `community_social_version()`
  → 11. Grants explicit like 0012. Rollback drops only what 0019 added.
- App: UI in the existing reminders card — water: "Every … from … to …" or "At set times" with add/remove time rows;
  meals: up to 6 times with add/remove; "Own reminders": add/edit/delete text + time + weekday chips. Version-gated
  (≥ 11), otherwise today's UI. Native Android scheduling (`nativeReminderSchedule`) covers the new kinds with
  stable ids inside the existing 1000–3999 range.
- Tests: SQL (validation, absent-key preservation, due calculation for times/custom incl. time zones), app UI with
  mocked RPC, native schedule list contents, rollback + reapply (`L.rollbackFrom(19)` / `L.reapply()`).

### Task 6: v107 release preparation (no push)

- Bump `CACHE_VERSION` `v107`, every `?v=` → `113`; README sections for all five features; add new suites to
  `../claude-code/local-preview/regression.sh`; run the full regression + `bento-update.js` (`GQ_OLD_REF=HEAD`) +
  `tests/sync/bento-upgrade.js` + `tests/sync/old-version-roundtrip.js` → green.
- Report; the owner approves commit/push, production 0019 (protocol) and the reminders function deploy.
