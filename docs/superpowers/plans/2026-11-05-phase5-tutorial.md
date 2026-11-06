# Phase 5 — Tutorial (web v102) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short, skippable tutorial (5 steps + one tab-bar line) that points at the real controls of the
current UI, starts once for new users, is offered (never forced) to existing users, and can be replayed from
Settings → Help — without ever creating or changing any workout data.

**Architecture:** One self-contained tutorial module in `script.js` (Slovak comments): an overlay with a
spotlight on a real element (or an inert illustration when the element only exists during a workout), a card
with Back / Next / Skip / Close, and a device-only progress key `gymquest_tutorial` in localStorage. The
tutorial reads the DOM; it never calls state-mutating functions. Styles in the Bento section of `style.css`.

**Tech Stack:** vanilla JS/CSS, Node + headless Chrome tests.

**Spec:** `docs/superpowers/specs/2026-10-30-gym-lift-improvements-design.md` §10; owner's tutorial request
(4–6 contextual steps, Skip/Next/Back/Close, replay from Settings → Help, no fake data, device-only state,
built against the final UI).

## Global Constraints

- The tutorial never creates or changes plans, sessions, sets, XP, achievements, history or settings; the
  synced state is byte-identical before and after any tutorial run.
- Its state lives only in localStorage `gymquest_tutorial` (never in `state`, never synced).
- Never starts or appears during an active workout, an open sheet/modal, or the first-run setup sheet.
- Every string in 6 languages (sk, en, es, pt-BR, fr, ar RTL); Light/Dark tokens; ≥ 44 px buttons; keyboard
  (Tab/Enter/Esc) and screen reader usable (dialog role, labelled, focus returned on close); respects
  `prefers-reduced-motion`; Android hardware Back closes it.
- Release: `CACHE_VERSION` `v102`, every `?v=` → `108`. Commit/push only with the owner's approval.

## Review Focus

- Anchors that are hidden, scrolled away or off-screen at 320 px must still produce a readable step (scroll
  into view or fall back to the illustration) — never a card pointing at nothing. → Task 1 test.
- A user who signs in on a new device must not get the first-run tutorial again if they already finished it
  on this device; a fresh device may offer the invitation card (device-only by design). → Task 3 test.
- Tutorial open + app update notice / sync conflict sheet: the tutorial yields (closes) and never covers a
  required action. → Task 3 test.
- RTL: card placement and arrows mirror correctly in Arabic. → Task 2 screenshots/test.
- Running the tutorial twice in a row leaves state byte-identical. → Task 1 test.

---

### Task 1: Tutorial engine

**Files:** Modify `script.js` (new section "Návod"), `style.css`, `index.html` (overlay root `#tour` if
needed) · Create `tests/app/tutorial.js`.

**Interfaces:** `TOUR_KEY = 'gymquest_tutorial'`; stored value `{ v: 1, status: 'done'|'skipped'|'invited-dismissed',
at }`. `startTour(steps, { from })`, `closeTour(reason)`, `tourOpen() -> boolean`. A step is
`{ id, target: () => Element|null, illus: () => HTMLElement|null, title, body, tab?: string }`: when `target()`
returns a visible element it is scrolled into view and spotlighted (rounded cut-out, the card placed above or
below, never off-screen); otherwise the `illus()` node (inert, `aria-hidden`, cloned markup with the real CSS
classes and no ids) is shown inside the card. Optional `tab` switches the visible tab before the step (only
via the existing `switchTab`, which doesn't mutate data). Buttons: Back (hidden on step 1), Next / Done,
Skip (all steps but the last), × Close. Focus trap; Esc and Android Back close; focus returns to the opener.

- [ ] **Step 1: Failing test** `tutorial.js`: with a 2-step dummy tour, spotlight geometry matches the target
  rect; a missing target shows the illustration; Back/Next/Skip/Close/Esc work; focus trap; reduced motion has no
  transition; `JSON.stringify(state)` and localStorage of the app state are byte-identical after open/next/close
  twice; tourOpen() false after close; nothing throws at 320 px in ar.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS. **Step 5:** stop and report.

### Task 2: The 5 steps + tab-bar line (content and illustrations)

**Files:** Modify `script.js` (step definitions, i18n), `style.css` · Test: extend `tests/app/tutorial.js`.

**Interfaces:** `TOUR_STEPS` (spec §10 order):
1. `plan` — Workout tab, the plan tiles (`#plan-chips`/first plan tile); body mentions starting from an
   exercise too (Exercises button/library).
2. `start` — the Start button of the selected plan (do NOT press it).
3. `sets` — illustration of one compact set row (number · Weight kg · Reps × · 🔥 · ✓) + "+ Add set";
   real rows when a session already exists is NOT required (tutorial never runs during a session).
4. `rest` — Today's Rest tile (real) + illustration of the rest card (big mm:ss, Pause / +15 s / Restart / ✕).
5. `finish` — illustration of the Finish bar and the ⋯ menu with Discard; then points at Stats → History /
   Calendar tiles (real) for where results appear.
6. `tabs` — the tab bar (real): one line naming the tabs.
Titles/bodies: exact short copy in en (≤ 2 sentences each), translated to sk, es, pt-BR, fr, ar (informal tone
like the app). Illustrations reuse the live CSS classes so they look like the real UI in both themes.

- [ ] **Step 1: Failing test**: all 6 steps render in 6 languages without missing keys; steps 1, 2, 4 (tile),
  5 (Stats tiles) and 6 spotlight real elements at 393 px; steps 3–5 show illustrations; no step's card overflows
  at 320 px (fr, ar, 130 %); state byte-identical after the full tour.
- [ ] **Step 2–4** + screenshots of every step (en/sk/ar, light/dark, 393 px) →
  `claude-code/improve-2026-10-30/phase5/task2/`. **Step 5.**

### Task 3: When it appears (first run, invitation, replay)

**Files:** Modify `script.js` (after the setup sheet closes; Today invitation card; Settings → Help group;
Android Back list `NATIVE_BACK_CLOSE`), `index.html`, `style.css` · Test: extend `tests/app/tutorial.js`.

**Interfaces:**
- **First run** (fresh guest or a newly registered account on a device with no `gymquest_tutorial`, no history,
  no activities): starts automatically once, right after the setup sheet is closed. Finish → `done`;
  Skip/Close → `skipped`. Never auto-starts again on that device.
- **Existing users** (has history or activities, no key): a dismissible card on Today: "New: a 1-minute tour"
  with Start / Not now. Not now → `invited-dismissed` (never shown again on this device).
- **Replay**: Settings → Help → "Show the tour" (always available).
- Never during an active workout or while any modal/sheet is open; if the update notice, a sync conflict sheet or
  any modal opens while the tour runs, the tour closes first.

- [ ] **Step 1: Failing test**: fresh guest → auto-starts after setup once, not after reload; existing user →
  card shown once, Not now hides it forever, Start opens the tour; Settings → Help replays; active session → no
  auto-start and the Help button starts it only after the workout (or is disabled with a hint — pick one and
  test it); opening a modal closes the tour; Android Back closes it (via the native back handler function).
- [ ] **Step 2–4.** **Step 5.**

### Task 4: v102 release preparation (no push)

- [ ] Bump `CACHE_VERSION` `v102`, `?v=108`; README (Tutorial section); add `tutorial.js` to
  `../claude-code/local-preview/regression.sh`; run `regression.sh`, `bento-update.js` (`GQ_OLD_REF=HEAD`),
  `tests/sync/bento-upgrade.js` (v101 → v102), `tests/sync/run.js "smoke|D3"` → green except known harness items.
- [ ] Report to the owner with screenshots; wait for release approval.
