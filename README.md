# GymQuest 🏋️

**A free, offline personal workout tracker for planning workouts, tracking progress, building
streaks, earning XP, and staying consistent.**

GymQuest is a small static web app — no account, no sign-up, no server. Open it and train. It shows
you today's workout, remembers what you lifted last time, rewards you for showing up, and keeps
everything on your own device.

**Live version:** https://surotvsk.github.io/Gymquest/

---

## Features

- **Custom workout plans** — start from the built-in Push / Pull / Legs plans, rename them, reorder
  them (drag the ⠿ handle in **Manage plans**, or use the ‹ › buttons), delete them, or add as many of
  your own as you like.
- **Full Body builder** — create a plan by picking exercises straight out of your existing plans.
  The result is an ordinary custom plan you can rename, edit, reorder or delete like any other.
- **The same picker when you edit** — every plan editor has **Add exercises from existing plans**
  (*Pridať cviky z existujúcich plánov*), so you can pull exercises out of your other plans into a
  plan you already have instead of retyping them.
- **Reorder exercises** — move exercises up and down inside a plan by dragging the handle or with the
  ↑ / ↓ buttons. The order is saved with the plan.
- **Train one side at a time** — an optional per-exercise switch for unilateral work (single-arm,
  single-leg, split squats…), with independent completion and failure tracking for each side.
- **Editable weekly goal** — choose how many workouts you want to complete per week (1–7) and change
  it whenever you want; every counter, streak and reward recalculates immediately.
- **Workout rotation** — the next recommended workout follows the order of your own plan list, based
  on the last workout you completed.
- **Progress tracking** — full workout history with dates, exercises, sets, reps, weights, XP and
  notes. Edit or delete any past workout.
- **Optional training to failure** — plan which sets you *intend* to take to failure, then confirm
  or change the real result set by set while you train. Nothing is ever assumed, forced or enabled
  by default.
- **Workout duration** — starting a workout begins a timer that measures the whole session (not just
  rests). The final duration is saved with the workout and shown in Progress and the Calendar. Your
  progress survives editing a plan, switching language or tabs, and even a page reload.
- **Personal records and milestones** — best weight per exercise plus an automatic 5 kg milestone
  badge for every personal record you set.
- **XP, levels and achievements** — earn XP for finishing workouts and completing sets, level up,
  and unlock achievements automatically.
- **Weekly streaks** — consistency is measured in weeks. Reach your goal and the streak grows.
- **Rest timer** — 60 / 90 / 120 second presets plus a custom time (minutes + seconds, up to 60
  minutes), with an optional gentle gong when the countdown reaches zero. The sound is **off by
  default**, has a **Short / Standard / Long** length choice, and is toggled in ⚙️ Settings.
- **Editable rest-timer presets** — the quick-start buttons are yours: change any time, give a preset
  your own name, reorder them, add your own, or delete one for good. A custom time can be started once
  without saving, or saved as a reusable preset.
- **Comparison with last time** — every exercise shows whether you went heavier or lighter than your
  previous session **of the same workout plan**.
- **Six languages** — full **Slovak, English, Spanish, Brazilian Portuguese, French and Arabic**
  interfaces, chosen in ⚙️ Settings and switched instantly. Arabic is a complete right-to-left mode.
- **Body measurements** — log body weight, waist, chest, both upper arms, both thighs and hips with
  a date and an optional note, see the latest value and the change since the previous entry, and follow
  the trend on a small built-in chart. kg/lb and cm/in, with every value stored safely in one canonical
  unit. Purely optional, and kept separate from your exercise weights.
- **Optional calorie estimate** — an adult-only, clearly labelled *estimate* based on the published
  Mifflin-St Jeor equation, shown as a range, with its formula, source and limits spelled out. Hidden
  by default. It deliberately never suggests a weight-loss or weight-gain target.
- **Optional food log** — your own foods and meals with manually entered energy and, if you want,
  protein, carbohydrates and fat. Reusable saved foods, daily totals, and honest labelling that the
  numbers are yours and are not verified nutrition data. **There is no food database** — and none is
  pretended.
- **Plain-language explanations** — short, non-judgemental notes on measuring body weight, why daily
  changes are not a trend, what duration / sets / reps / progressive overload mean, and what the
  calorie estimate and your own nutrition numbers can and cannot tell you.
- **Exercise library** — 48 built-in exercises with primary and secondary muscles, movement pattern,
  difficulty, equipment, gym/home/outdoor availability, how-to steps, common mistakes, similar exercises
  with the reason each was suggested, and a **demonstration gallery** (a licensed video or photograph
  where one is available, otherwise an original illustration or an honest *unavailable* state) you can swipe through.
  Find something by what you want to train and where you are, search by name in any of the six languages,
  or tell it what equipment you have and see only what you can actually do.
- **Replace an exercise mid-workout** — swap an exercise without losing your progress. Sets you already
  finished stay recorded under the original exercise; the replacement is added for the rest of the
  session and your plan is never changed.
- **Export and import** — back up or restore all of your data as a JSON file.
- **Automatic backups** — opt-in JSON backup files every five workouts (at most weekly), created
  automatically on desktop and Android, and with one honest tap on iPhone. See *Automatic backups*
  below for exactly what is and is not automatic.
- **Installable** — add it to your phone's home screen and it opens like a native app.

---

## How to run it

**Online:** open https://surotvsk.github.io/Gymquest/

**Locally:** no installation, no build step and no dependencies. Just open `index.html` in a
browser — double-click the file or drag it into a browser window. The app works completely offline.

> Your data is stored per browser and per address, so the local copy and the online copy keep
> separate data. Use **Export data** / **Import data** to move your history between them.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure — screens, tab bar, dialogs, meta tags |
| `style.css` | Dark theme, colours, layout, responsive rules |
| `script.js` | All application logic — state, workouts, rotation, streaks, XP, achievements, translations |
| `manifest.json` | Web app manifest so the app can be installed to a home screen |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home screen and app icons |
| `media/` | Licensed exercise photographs and their credits (`media/CREDITS.md`) |
| `design-concepts/` | 32 clickable redesign prototypes (mockups with sample data, not part of the app). The gallery is `design-concepts/index.html`. The service worker leaves these pages alone, so they always load from the network. `design-concepts/app/` holds copies of the chosen designs; `app/r2/03-bento.html` is the reference the app follows |
| `README.md` | This documentation |

---

## Design: Bento, light and dark

GymQuest follows the **Bento** prototype (`design-concepts/app/r2/03-bento.html`, dark version
`r7/02-classic-dark.html`) on every screen: a warm grey background, 22 px rounded tiles on a 4-column
grid, bold type, lime and pastel tiles (lavender, peach, sky, sand), and a floating dark menu with six
icons — **Today** (grid), **Workout** (dumbbell), **Stats** (bar chart), **Messages** (speech bubble),
**Community** (two people) and **You** (person); the selected tab is a lime pill. The Messages icon shows
your unread messages, the Community icon your friend requests. Deeper screens open as sheets with a back arrow, as
in the prototype.

- **Today** — see below.
- **Workout** — the plans as coloured tiles (*Next ✦* or *Plan N*, exercises and sets; the selected
  one is dark), a tile with the selected plan's exercises and **Start** / **Edit**, then *Manage plans*,
  *New plan*, *Exercise library*, *Full Body builder* and — with Community — **Train with a friend**
  (a lavender tile; tapping it opens the friend picker as a tile right below). During a workout a dark tile shows the plan
  (tap its name to switch plans), the running time and **Rest**, **Finish · +XP** and **Discard**; every
  exercise is a tile (the one you are on is lavender, a finished one lime) with square set buttons
  showing reps and weight, and below them a pill per set for its reps, weight and failure mark, the
  drop-set button, replace and exercise details. The plan editor opens as a full-screen sheet.
- **Rest timer** — a sheet (presets, custom time, managing timers) opened from **Rest**; a running timer
  is a lime pill above the menu on every tab.
- **Stats** — Week (lime), Month and All tiles with workouts and sets, *Sets per week* for the last
  8 weeks, Records (dark), Achievements (peach), Calendar, History, your four latest workouts, Body,
  Photos, Food and Activities. Each opens its sheet (records and history, body, food, photos,
  achievements, the calendar, or that day).
- **Calendar** — opens from the *This week* tile on Today or the Calendar tile on Stats as a full sheet;
  workout days are green, past days without a workout pink, today has an orange outline.
- **Messages** — your conversations open straight away; tap one to chat, *New message* picks a friend.
  Back from a chat returns to the list. The list is kept in memory (for the signed-in account only), so after
  the first time it appears instantly and refreshes in the background; the requests that run before it are
  sent together instead of one after another. Under your last message you see **Sent**, which turns into
  **Seen** (live) once your friend has opened the chat — only when your message is the last one, like in
  Messenger. Needs server version 8 (migration 0015); on an older server no label is shown.
- **Community** — Top 20 (with your rank this week), New post, Messages and Friends tiles above the feed;
  search is the magnifier at the top. Messages, chats, friends, Top 20, profiles, the composer and the
  moderator queue open as sheets.
- **Profiles** (v81) are organised like Instagram, in Bento colours and shapes: a compact top bar (**Back**,
  the username, **⋯**), the avatar with *posts · followers · following* (and *friends* on your own), the name,
  bio and top achievements (small chips), the actions, and the posts right below as a grid of rounded squares
  — photos (a mark for several photos, a share or friends-only mark) and text-only posts as readable pastel
  tiles. Tapping a tile opens the full post (likes, comments, its menu). *Load more* pages as before.
  **Your own profile** (You → Community profile, or tapping your own name anywhere): **Edit profile** (name,
  bio, avatar, privacy switches, notifications, reminders, delete account / leave / sign out) and **Friends**;
  the ⋯ menu has *Settings and privacy*, *My posts*, *Moderation* (moderators only) and *Sign out*. Your posts
  still waiting for the moderator (or rejected) come first in the grid, marked, and open *My posts*.
  **Someone else's profile**: Follow / Following, the friendship button, Message (friends); ⋯ has Block and
  Report (and the leaderboard moderation items for moderators only). Followers / Following open the lists.
  A profile opens straight away with a skeleton carrying the right name — the Community tiles or the feed are
  never shown in between — and **Back** returns to the previous screen exactly as it was (content, search text
  and scroll position), refreshing profiles and lists quietly in place. Only what the server lets you see is
  shown (another person's pending or friends-only posts never).
- **You** (v80) is your own profile, the moment you tap it — like opening your profile on Instagram, in Bento
  shapes and colours. At the top: *You* with **New post**, **⋯** and the **Settings** gear. A compact header card
  holds your profile photo (or its letter), your name and @username, your bio (or a motivational line), your real
  counts (posts · followers · following · friends; without Community: workouts · week streak · achievements) and
  small pills for **Level · XP** (achievements), **Goal** (Settings at the goal) and **Progress photos** (private),
  plus **Edit profile** (name, bio, avatar, privacy, notifications, reminders, account) and **Friends**. The ⋯ menu
  has *Settings and privacy*, *My posts*, *Moderation* (moderators only) and *Sign out*.
  Below it is your published history, newest first: **All** (photos in a Bento mosaic — one wide, two halves or three
  in a row — text posts as readable cards, shared workouts and plans as summary cards with name, date, duration, XP and
  exercises), and filters **Pics**, **Text** and **Workouts**. Older posts load by themselves as you scroll (the same
  pages as the profile, never twice). Posts still waiting for the moderator or rejected come first, marked "only you
  see this", and open *My posts*. Tapping a post opens it in full (likes, comments, its menu); Back returns to You
  with the same filter and scroll position. **History** (lock) is owner-only: your finished workouts from this device,
  never posts and never on the server; a tap opens that day. Private chats stay in Messages and progress photos stay
  private — none of them ever appears among your posts. Without Community (or signed out, or offline) the header
  and History still work and a short note offers Community — nothing is switched on by itself.
- Dialogs slide up from the bottom; the exercise library, exercise details, the Full Body builder and the
  photo viewer open full-screen from the top on a phone, with their content scrolling inside. On a wider
  screen dialogs are centred. From 900 px the grid has
  8 columns.

The font is Space Grotesk (SIL Open Font License, `fonts/OFL.txt`), stored in the app so it also works
offline; Arabic keeps an Arabic system font. Keyboard focus is always visible, the theme choice works
with the arrow keys, and with *reduce motion* switched on in the system the sheets do not animate.

**⚙️ Settings** (v81) is grouped into Bento cards: **General** (language, appearance, weekly goal),
**Rest timer** (the sound switch; its length and *Test sound* appear only when the sound is on),
**Backup & sync** (account sync, *Sync now*, automatic backup, *Save backup now*), **Community**, and a
collapsed **More options** with the rarely used tools: export, import, load from account, recovery copies,
delete cloud backup, demo data and reset. Then updates, about and **Close**. Nothing was removed except the
separate *Save goal* button — the goal is saved as soon as you tap it (and Close saves it once more).

**⚙️ Settings → Appearance** chooses **Light**, **Dark** (near-black background, deep-toned tiles, lime
accents) or **System** (follows the device's light/dark setting, also when it changes while the app is
open). System is the default. The choice belongs to this device only: it is applied before the first
paint, it is not part of your data, the export or the account sync, and switching never changes
anything you saved.

Updating from an earlier version keeps everything exactly as it was — plans, workout history and
calendar, measurements, food log, progress photos, personal exercise media, settings, Community
messages and the account — only the look changes. Every feature works as before.

## Screens

### Today
The date and week, a greeting (with your Community username when you are signed in), and the Bento
grid. Every tile shows live numbers from your own data and opens the feature it stands for:

| Tile | Shows | Tap opens |
|---|---|---|
| **Next up ✦** (dark, with an exercise photo) | the recommended plan, its exercises and sets; during a workout **In progress** with the time and sets done | **Start** begins it, **Continue** returns to it |
| **This week** (lime) | workouts done / weekly goal, and seven day squares (filled = trained, outlined = today) | Calendar |
| **Streak** | weeks in a row | Achievements |
| **Busy week?** | excuse a week and keep the streak; *Excused ✓ · This week · tap to change* or *Next week excused ✓* | the **Busy week?** sheet: switches for **This week** and **Next week** (with their dates) |
| **Level** (lavender) | level, total XP, a bar and the XP to the next level | Achievements |
| **Body** (sky) | your latest body weight | Body |
| **Best lift** | your heaviest record and its exercise | Records |
| **Food today** (peach) | today's calories (or *Off*) | Food |
| **Rest** (sand) | the running rest timer | the rest timer |
| **Activity** | | run, walk, cycle, home or outdoor workout — and *Log activity* for a past one |
| **Friends** (lavender) | your friends' avatars and the number of unread messages and requests | the Messages tab |
| **Photos** | | Progress photos |
| **Settings** (dark) | | Settings |


The current date, weekday and ISO week number are shown under the heading.

### Calendar
A monthly grid with Monday as the first day of the week, previous/next month navigation and a
**Today** button. Each day shows its status at a glance: **green** means a workout was completed
that day (with a small badge when you trained more than once), a **muted red** day is a past day
with no workout recorded, a **neutral** day is in the future, and **today** always carries an
outline (black in light mode, lime in dark mode). The legend repeats the same meaning in words. The first and last rows also show a
few days of the previous and next month so every week is complete; those days are **faded** (their
green/red still shows, but pale) and each of them carries a small month name such as *Nov*,
so a workout from another month never looks like it belongs to the one you are viewing.

Tap any day in the month to see its full date and status, plus the plan name, exercises, sets,
reps, weight, completed sets, XP, note and any achievements unlocked that day. Days are matched to
your history by local calendar date, so a workout always appears on the day you recorded it.

When Community is on, every workout in the day window also has **Share to Community** (opens a new
post with that workout attached; it is reviewed by a moderator as usual) and **Send to a friend**
(pick one of your friends; the workout arrives in your chat with them as a card, and **Open chat**
takes you there).

### Workout
The selected plan name with a **✏️ Edit plan** button, and a **two-column grid of plan cards** for
switching between plans. Each card is just the plan's name — centred, equal in width, and given the
full card so long custom names wrap cleanly instead of being squeezed — with the currently selected
plan in orange and the recommended one marked ✦.

**Manage plans** (next to **+ Add workout plan**) switches the same grid into a one-plan-per-row
management list with a ⠿ drag handle and a ✏️ pencil on each plan: drag a plan to change the rotation
order, or tap the pencil to edit that plan. The handles stay hidden during normal use so the names keep
the whole card. **✏️ Edit plan** always edits the selected plan, and the editor's ‹ › buttons reorder
one step at a time.

Editing a plan lets you rename it, delete it with 🗑️, reorder **and** add its exercises, and change each
one — sets, reps, target weight in kilograms, planned failure sets, and whether it is trained one side
at a time.

Mark each set as done while you train, then press **Finish workout**. You can also run a rest timer
or reset the current workout without touching your history.

**Different weights per set.** Every set shows its weight next to the ✓ button. Tap it to change the
weight of that set (−2.5 / +2.5 kg buttons or type it; a comma works too). The new weight also applies
to the following sets until you change one of them, so "set 1 at 60 kg, then 65 kg" is two taps. Your
plan is never changed. The history keeps every set's weight (shown as *60 · 65 · 65 · 65 kg*), and
records, achievements and the "last time" comparison use the heaviest set you actually completed.
Editing that weight later in the history replaces the per-set weights with the single new weight.

**Different reps per set.** Next to the weight, every set shows its reps (for example *10×*). Tap it to
change that set's reps (−1 / +1 or type a whole number from 1 to 999). It works like the weight: doing
10 reps in set 1 and 8 in set 2 is one change on set 2, and the later sets follow until you change one
of them. Your plan keeps its reps; the history and the Calendar show every set (*3 × 10/8/8*), and a
shared workout shows them too. Editing the reps later in the history replaces the per-set reps with the
single new number.

**One side at a time, and completed sets stay as they were.** For an exercise done one side at a time,
every side of every set has its own reps and weight. A change applies to that row and the rows after it in
the order they are shown (*Set 1 — Left*, *Set 1 — Right*, *Set 2 — Left*, …), so entering fewer reps for
the right arm never rewrites the left arm. A set you have already ticked ✓ keeps its numbers even when you
change an earlier row (this applies to every exercise). When the two sides differ, history, the Calendar
and shared workouts show both: *Left 12/10 | Right 8/8 reps*.

**Drop sets.** Under the sets of every exercise there is **+ Drop set**: after your last set, lower the
weight and keep going without a rest. Each drop set is its own row (*Drop set 1*, *Drop set 2*, … up to
5) with ✓, reps and weight; it starts about 20 % lighter than the set before it (rounded to 2.5 kg) with
the same reps, and you can change both (only that drop set changes) or remove it with ✕. Your plan is
not changed. Only completed drop sets are saved; they are extra work, so they do not change the
"sets done" count or the XP. History, the Calendar and shared workouts show them as
*Drop sets: 50 kg × 8 · 40 kg × 6*.

### Progress
Totals for this week, this month and all time, your personal records, and the full history of
completed workouts. Every workout in the history can be edited ✏️ or deleted 🗑️.

Progress has three sub-views, chosen with the segmented control at the top — **Progress**, **Body** and
**Food**. The bottom five-tab bar is deliberately unchanged, so the phone navigation never gets
cramped. *Progress* is the original content described above; *Body* and *Food* are the optional
additions described under [Body, calories, food and information](#body-calories-food-and-information).

### Motivation
Your XP total, your level with a progress bar, and every achievement — including the 5 kg milestone
badges earned for personal records.

---

## How it works

- **Recommended workout** — GymQuest rotates through your plans in the order you arranged them
  (for example Push → Pull → Legs → your own plan), based on the last completed workout. You can
  always pick a different plan manually. The recommendation is shown on the Today screen and marked
  with ✦ on the plan chips.
- **Weekly goal** — set on first launch and changeable any time in ⚙️ Settings. Tap a number from
  1 to 7; it applies right away (there is no separate Save button).
- **Streak** — counted in weeks: hitting your weekly goal extends the streak by one week.
- **Excused weeks** — the **Busy week?** tile on the Today screen opens a sheet with two switches: **This week**
  and **Next week** (so a holiday or exam week can be excused in advance). An excused week keeps the streak
  alive but never adds to it; workouts done in it still count. A week whose goal is already reached has
  nothing to excuse (its switch is off and disabled). Past weeks cannot be changed, so a broken streak cannot
  be repaired afterwards. A tap on the tile never changes anything by itself. The stored format is the same
  list of ISO weeks as before (`excusedWeeks`).
- **XP and levels** — every workout gives **20 XP** plus **2 XP** for each completed set. You need
  100 XP to reach the next level.
- **Achievements** — unlocked automatically and stored with the date they were earned. Each exercise
  unlocks 5 kg milestones as you set new personal records (for example 50 kg, then 55 kg, then
  60 kg…).
- **Comparison with last time** — the arrow and the "+2 reps" / "−2 reps" line compare an exercise
  only with the **same exercise in the same workout plan**, using the stable plan id and the stable
  exercise id. Renaming a plan never breaks this, because its id does not change. A Bench press in a
  Full Body plan is never compared against a Bench press in Push, and two custom exercises that
  happen to share a name are never compared with each other. If there is no earlier record of that
  exercise in that plan, the app shows *First time* and no comparison at all — never a misleading
  number taken from a different plan.

### Reordering

- **Workout plans** — open **Manage plans** and drag a plan by its ⠿ handle to move it before or after
  another plan. The rotation order, the selector and the Today recommendation all follow the new order
  immediately, and the order is saved with your data (it survives a refresh and export/import). The ‹ ›
  buttons in the plan editor do the same thing one step at a time, and your currently selected plan
  stays selected. Plan ids, names and every past workout are untouched.
- **Exercise reordering** — every exercise row has a ⠿ handle and ↑ / ↓ buttons. Drag it, or step it
  up and down, then save the plan as usual. The saved order is what the Workout screen shows and what a
  finished workout records into your history. Reordering never changes sets, reps, weights, planned
  failure sets, completed progress or exercise ids.
- Both kinds of dragging use pointer events, so they work with a mouse **and** with a finger on a
  touch screen; the handle has `touch-action: none`, so dragging never scrolls the page.

---

## Languages

GymQuest ships with six fully supported interface languages, all built in — no translation service,
no network call, nothing to download:

| Code | Language | Locale | Direction |
|---|---|---|---|
| `sk` | Slovenčina | `sk-SK` | left-to-right |
| `en` | English | `en-US` | left-to-right |
| `es` | Español | `es-ES` | left-to-right |
| `pt-BR` | **Português (Brasil)** | `pt-BR` | left-to-right |
| `fr` | Français | `fr-FR` | left-to-right |
| `ar` | العربية | `ar` | **right-to-left** |

Portuguese is deliberately **Brazilian Portuguese** and is labelled *Português (Brasil)* everywhere —
the vocabulary is Brazilian (*treino*, *séries até a falha*, *Duração do treino*).

### Choosing a language

The header no longer carries a `SK | EN` switch — with six languages that would be cluttered on a
phone. Language now lives in **⚙️ Settings**, at the top:

```
Language
English
[ Change language ]
```

**Change language** opens a picker listing every language by its own name, with a ✓ on the current
one:

```
✓ English
  Slovenčina
  Español
  Português (Brasil)
  Français
  العربية
```

Tapping one switches the whole app **immediately** — no reload — and saves the choice, which then
survives refresh, export/import and app updates. Switching language **never touches your training**:
completed sets, failure markers, the rest timer, workout duration, the active session, the selected
plan, the plan order and the calendar month you are looking at all stay exactly as they were.

An old or unknown stored language value safely falls back to English, while existing Slovak and
English users keep the language they already had.

### What is translated

- **Everything in the interface** — navigation, Today, the workout screen, the plan editor, the Full
  Body builder and the "add from existing plans" picker, Progress, history, the Calendar, Motivation,
  achievements, Settings, every dialog and every accessibility label.
- **Built-in plans and exercises** are app content and are translated, so the Slovak plan *Nohy*
  appears as *Legs* in English, *Piernas* in Spanish, *Pernas* in Portuguese, *Jambes* in French and
  *الأرجل* in Arabic.
- **Custom exercises** you create or rename are never translated — they appear exactly as you typed
  them.
- A **renamed plan** becomes a custom name and is never translated. Rename *Nohy* to *Nohy + Core*
  and it stays *Nohy + Core* in every language. Untouched built-in plans keep translating. The app
  recognises a built-in plan's original name in **any** of the six languages, so typing *Legs* or
  *الأرجل* back into the field still counts as "not renamed".
- **Your notes** are never translated. **Workout history is an immutable record**: it keeps the
  exercise and plan names that were in use when the workout was logged, so a later rename or deletion
  never rewrites the past.

### Plurals

Counting text is pluralised with the browser's own `Intl.PluralRules` for the selected locale, so
each language follows its own CLDR rules — nothing is forced through one language's pattern:

| | 0 | 1 | 2 | 3 | 5 | 11 |
|---|---|---|---|---|---|---|
| Slovak | iné | 1 tréning | 2 tréningy | 3 tréningy | 5 tréningov | 11 tréningov |
| English | other | 1 workout | 2 workouts | 3 workouts | 5 workouts | 11 workouts |
| Spanish | otro | 1 entrenamiento | 2 entrenamientos | 3 entrenamientos | 5 entrenamientos | 11 entrenamientos |
| Portuguese (Brasil) | 0 treino | 1 treino | 2 treinos | 3 treinos | 5 treinos | 11 treinos |
| French | 0 entraînement | 1 entraînement | 2 entraînements | 3 entraînements | 5 entraînements | 11 entraînements |
| Arabic | 0 ثانية | 1 ثانية | 2 ثانيتان | 3 ثوانٍ | 5 ثوانٍ | 11 ثانية |

Note the details that a single rule would get wrong: French treats **0 as singular**, Portuguese
treats **0 and 1 as singular**, and Arabic has its own **dual** (2) and **few** (3–10) forms. The
`One / Two / Few / Many / Other` (and `Zero`) forms live in the dictionaries, and every language
always has an `Other` form, so a missing slot can never fall back to another language's text.

### Dates, numbers and the Calendar

Month names, weekday names and weekday abbreviations come from explicit per-language tables (the
app's deliberate choice: identical output in every browser, fully offline, no ICU variation). Each
language has its own date shape — `18. septembra 2026`, `Sep 18, 2026`, `18 sep 2026`,
`18 set 2026`, `18 sept. 2026`, `18 سبتمبر 2026` — and its own full form for the Today row and the
Calendar day detail. **The Monday-first calendar grid, the ISO week logic and the stored
`YYYY-MM-DD` history format are unchanged**, so no date ever shifts.

Weights, reps, sets, XP and durations keep Western digits in every language (`6 kg`, `3 × 10`,
`00:42:13`, `+22 XP`) and are bidi-isolated in Arabic so they always read left-to-right.

### Arabic and right-to-left

Arabic is a full RTL mode, not just a translation:

- `html lang="ar"` and `html dir="rtl"` are set (and reset to `ltr` when you switch away), and the
  layout is driven by CSS **logical properties** (`border-inline-start`, `inset-inline-end`,
  `padding-inline`, `text-align: start`), so it flips by itself.
- **Arrows never lie**: the Calendar's *previous month* control sits on the right and points right,
  *next month* sits on the left and points left, and the plan-editor reorder arrows swap the same way.
- **Fitness meaning is never mirrored**: *left* and *right* keep their real meaning, and the side
  sequence of a unilateral exercise is a training order, not a layout direction.
- Arabic-capable system fonts (`Noto Sans Arabic`, `Geeza Pro`, `Segoe UI`, `Tahoma`) are used from the
  existing stack — nothing is fetched.
- Long translations are handled by the same wrapping rules as before, and the layout is verified for
  overflow at 320 / 375 / 390 / 393 / 414 / 430 px in all six languages.

---

## Rest timer

The rest timer has three quick presets (60 / 90 / 120 seconds) plus a **Custom** option where you
enter minutes and seconds (up to 60 minutes; seconds ≥ 60 roll over into minutes). The last custom
time you started is remembered. Starting a rest timer never touches your workout progress, history,
XP, streaks or goals.

The countdown uses an **absolute end timestamp**, not a ticking counter, so it stays correct when you
switch tabs, open Settings or the Calendar, edit a plan, change language, or come back from the Home
Screen. If the countdown finishes while you are away, the app shows **Rest time is over.**
(*Pauza skončila.*) when you return, without restarting and without a delayed gong. A rest timer
that is still running also survives a page refresh.

Every countdown gets its own **timer session id**, and its completion is recorded once against that
id. That is what makes the completion *idempotent*: the ticking interval, returning from the
background, restoring the page, opening the Workout tab, tapping the timer, starting another timer and
every screen re-render all go through the same guard, so a countdown can never be "completed" twice.
A completion is only treated as a live one — and only then may the gong play — when the app is visible
and the end was detected within about two seconds of the real end. Anything later was a suspended
callback, and it finishes **silently** with the visual *Rest time is over.* state instead.

### Rest timer sound

The rest timer can play a short **gentle gong** when its countdown reaches zero. It is a setting in
⚙️ Settings (*Rest timer sound* / *Zvuk po skončení pauzy*) with a **Test sound** button, a
**Short / Standard / Long** length choice, and it is **off by default** — nothing plays until you
switch it on.

- The gong is generated in the browser with the Web Audio API and is a **simple repeated gong, not a
  melody**: the **same single tone** strikes every time and only gets quieter, so it sounds like an
  ordinary timer notification — *gong … gong … gong*. **Short ≈ 2 s (two gongs), Standard ≈ 4 s
  (three, default), Long ≈ 6 s (three)**. Each gong has a smooth natural decay, and the whole thing is
  moderate in volume — no harsh beep, no alarm. **No audio file is bundled or downloaded**, and
  GymQuest stays offline.
- It plays **once**, only when a countdown reaches zero on its own **while the app is open**. Stopping
  the timer, resetting the workout or picking a different duration stays silent, and it never plays
  for the workout-duration timer or any other event. Rapid taps stop the previous gong before
  starting the next, so sounds never pile up.
- **Test sound** plays exactly the same gong on demand — it is the *same code path*, not a second
  implementation. It is disabled while the sound setting is off (with a short explanation), and it
  never starts a rest timer or touches your workout.
- **One shared audio context.** The app creates exactly one `AudioContext`, only in response to a real
  tap, and never a second one. It is created and resumed inside the user gesture (turning the setting
  on, **Test sound**, starting a rest timer, or the first tap anywhere while sound is on), and after
  each successful resume it also sends one silent sample to the audio destination. That last step
  matters on iOS: WebKit only switches its output route — speaker, headphones, Bluetooth — once the
  audio session has actually been activated by a user gesture, which is the usual reason a Web Audio
  gong is inaudible on headphones. The gong is scheduled only once the context is genuinely running,
  so nothing is queued on a suspended context. If the browser still refuses to play, **Test sound**
  shows a short message (*Sound could not be played. Check your device sound settings.*) and the rest
  timer keeps working normally.
- Going to the background cancels any gong that is still scheduled or playing, so a suspended audio
  context can never flush an old gong after you come back.

### Honest iPhone / Safari limits

GymQuest is a static web app, so its rest-timer sound **cannot** be guaranteed to play while iOS has
the page suspended in the background, after returning to the Home Screen, while Silent Mode is on,
or under Do Not Disturb / Focus. It also **cannot choose your output route**: whether a gong comes out
of the speaker, wired headphones or a Bluetooth device is decided entirely by iOS and the browser, and
GymQuest only asks for the audio session to be active. It does not schedule native notifications and
does not attempt to bypass Silent Mode or misuse Critical Alerts. What it *does* guarantee: the timer
stays correct (from the absolute timestamp), the completion state is shown on return, no old gong is
ever replayed late, and — when the app is open and audio is allowed — the gong plays once at the
natural end of a countdown.

---

### Rest timer presets

The quick-start buttons above the timer are **your** presets, not fixed choices. Out of the box they are
the original three — **60 s, 90 s and 120 s** — and you can change everything about them:

- **Start one** by tapping its button. It always starts *that* preset's own duration.
- **Edit** a preset's time, and give it **your own name** if you want one (up to 40 characters, shown
  exactly as you typed it and never translated).
- **Rename** it at any time by editing it again. A preset without a name is labelled with its duration,
  which is translated in every language.
- **Reorder** with the ↑ / ↓ buttons; the row order is the button order.
- **Delete** any preset, after a confirmation that names it. **Defaults are not special** — delete the
  60 s preset and it stays gone through refreshes, imports and app updates.

Open **Manage timers** to do all of that (it keeps the button row clean), and **Done** to close it.

**Custom time.** The `Custom` button opens the minutes/seconds panel with two actions:

- **Start once** runs that time *right now* and creates **no** preset — and it no longer overwrites the
  custom time you had saved, which is what used to happen.
- **Save preset** adds it to your quick-start buttons for next time. It deliberately **does not start a
  timer**, so saving can never set off a countdown by accident.

If you have a saved custom time from before this update, GymQuest keeps it and offers once to turn it into
a preset — it never creates one behind your back.

**Rules the presets follow.** Times are whole seconds, greater than zero and at most 60 minutes. A
duplicate length is allowed only when both presets have different names of their own (two differently
named rests can sensibly share a length); otherwise you get a message telling you which preset already
uses it. Deleting every preset is fine — the `Custom` timer is not part of the list, so the timer is never
left unusable. Changing, renaming, reordering or deleting a preset during a rest **never touches the
running countdown**, and your sound on/off and gong-length settings are untouched.

## Creating a workout plan

**+ Add workout plan** asks which kind you want:

- **Blank workout plan** — an empty custom plan; add the exercises yourself in the editor.
- **Full Body builder** — pick exercises from plans you already have. Every active plan (built-in
  Push / Pull / Legs, renamed ones, and your own) appears as a section, and each exercise row shows
  its sets, reps and weight. Tick any combination, or use **Select all** / **Clear** per section.
  The counter shows how many you have picked, and a plan name is pre-filled with *Full Body*
  (*Celé telo*) — edit it before saving if you like.

Nothing is pre-selected, and **Create Full Body workout** needs at least one exercise. Created
exercises are *copies*: name, stable id and built-in/custom status, sets, reps, weight and the
planned failure sets are copied, but there is no live link to the source plan afterwards — editing
either side never changes the other. A deliberate duplicate rule applies: if the same **built-in**
exercise (same stable id) is picked from more than one section, it is added once, and the builder
says so. **Custom** exercises are never merged, even when they share a name.

The new plan is saved immediately and opens in the normal plan editor, so you can still change the
name, order, sets, reps, weights, failure sets, add exercises or delete them. From then on it behaves
exactly like any other plan: rotation, Today recommendations, history, Calendar, XP, export/import
and safe deletion all work the same way. Nothing is written to a special plan type.

### Adding exercises to a plan you already have

The same picker is available while you edit **any** plan, through the **Add exercises from existing
plans** (*Pridať cviky z existujúcich plánov*) button in the editor. It is not tied to any special plan
type and never looks at the plan's name, so it works exactly the same for a Full Body plan you created
earlier, for one you have since renamed, and for an ordinary custom plan.

- Every other **active plan** appears as a section with the name you gave it (Push, Pull, Nohy, a
  renamed plan, or one of your own).
- Exercises that are **already in the plan you are editing** show up ticked, so you can see what is
  already there and untick anything you want to remove.
- Exercises that are only in the plan itself — for example one you typed by hand — get their own
  section at the end, also ticked.
- Tick anything else to add a **copy** of it; **Select all** / **Clear** work per section.
- **Add to plan** applies the selection and returns you to the editor. Nothing is written to your data
  until you press **Save**, exactly like every other editor change, and typing an exercise by hand
  with **+ Add exercise** still works as before.

Copies are independent: the same fields as the builder copies (name, stable id and built-in/custom
status, sets, reps, target weight, planned failure sets, and the one-side-at-a-time setting) are taken
once, and there is no live link in either direction afterwards. Recorded results are never copied —
`actualFailureSets` belongs to finished history and can never leak into a future plan. Built-in
exercises are de-duplicated by their stable id; custom exercises are never merged, even when their
names look the same.

---

## The exercise library

GymQuest ships with a built-in catalogue of **48 exercises** — the 13 that have always powered the
built-in plans, plus 20 added so the app is genuinely useful away from a gym, and 15 further gym
exercises (cable curl, machine chest press, pec deck, incline dumbbell press, front raise, wide-grip
lat pulldown, dumbbell and cable pullover, dumbbell triceps extension, single-arm cable triceps extension, hack
squat, Romanian deadlift, leg extension, adductor machine and abductor machine). There is
**no server, no download and no external service**: the catalogue lives in the app's own code, so it
works offline from the first launch and adds nothing at all to your stored data.

### What each exercise tells you

- **Primary muscle**, called out on its own, and **secondary muscles** listed separately. They are never
  mixed into one list, because "this trains your chest" and "this also uses your triceps" are different
  claims.
- **Movement pattern** (horizontal push, hip hinge, lateral raise …), **difficulty**
  (beginner / intermediate / advanced), **equipment needed**, and **where it can be done** —
  gym, home or outdoors.
- **How to do it** — a short setup-to-finish description, written for someone doing it for the first
  time.
- **Common mistakes & technique notes** — one plain sentence about what usually goes wrong.
- **A demonstration** — a licensed video or photograph where one is available, otherwise an original
  illustration, or an honest *Demonstration unavailable* state (see the note below).
- **Similar exercises**, each with the reason it was suggested.

### Opening it

There is **no new bottom tab** — the five-tab bar on a phone is left exactly as it was. The library
opens from places you are already working in:

- the **Exercise library** button on the **Training** screen,
- the same button while a **plan editor** is open, where exercises you find can be added straight into
  the plan you are editing,
- the **⇄ replace** button on any exercise **during a workout**.

### Finding something to train

1. **What do you want to train?** — Chest, Back, Shoulders, Arms, Legs, Glutes, Core, or Full body.
2. **Where are you training?** — Gym, Home or Outdoors.
3. **Search** by name, and open **Filters** for difficulty, movement pattern and exercise type.

Search understands **all six languages at once**, so typing an English name finds the exercise even
when the interface is in Slovak — and it also finds **your own** custom exercises, which appear in a
separate *Your own exercises* section and are never merged with a library entry that happens to look
similar.

**Full body** is a deliberate selection spread across the major muscle groups, not a claim that each
listed exercise trains everything.

When nothing matches, you get a plain sentence saying so plus a **Reset filters** button. Reset clears
the search, muscle, location, difficulty, pattern and type filters — it does **not** clear your saved
equipment, because that is a preference rather than a filter.

### My equipment — and why "No equipment" is different

Under **My equipment** you tell GymQuest what you actually have: *No equipment, Resistance bands,
Dumbbells, Pull-up bar (or dip bars), Adjustable bench, Barbell, Machine*, or the **Full home gym**
shortcut, which simply selects bands, dumbbells, a pull-up bar, a bench and a barbell for you. You can
change it at any time and the suggestions update immediately.

- **"No equipment" is a filter choice, not equipment.** It cannot be combined with anything else:
  choosing it clears the rest, and choosing anything else clears it.
- **Bodyweight exercises are always available.** If you have only bands, you can still see push-ups —
  owning a band does not remove your own body. But if you select *No equipment*, you see **only**
  exercises that need no equipment.
- **Until you tell it, GymQuest does not pretend to know.** With nothing selected it filters nothing,
  shows everything, and says plainly that it needs your list before it can narrow things down.

### Gym to home

Open any exercise and the **Home alternatives** block suggests what you could do instead with the
equipment you have. Every suggestion carries its reason — *same primary muscle, different equipment*,
*no-equipment version*, *easier variation*, *more challenging variation* — and says nothing about being
an identical swap. If nothing suitable exists for your equipment, GymQuest **says so** instead of
offering an exercise you cannot perform. For example, a Lat Pulldown (cable rows) with only resistance
bands suggests the band row and a bodyweight back extension; with no equipment at all it suggests only
the bodyweight option.

### Replacing an exercise during a workout

If the machine is taken, tap **⇄** on that exercise (available once your workout is running) and pick
what you will do instead. **Your plan is never changed** — tomorrow you are back on the original.

Before anything changes you are told exactly what will happen:

- **If no sets are recorded yet:** *"No sets recorded yet. Bench press will be replaced for the rest of
  this session."*
- **If sets are already recorded:** *"2 of 4 sets are already recorded for Bench press. Those stay
  recorded under Bench press, and Push-up is added for the remaining work."*

That is exactly what GymQuest then does. The completed sets stay under the original exercise, shown in
a dimmed, locked block that cannot be edited, and the replacement is added below for the remaining work
with a note saying what it replaces. **Completed sets are never relabelled onto the new exercise.**
Progress, XP and the workout timer carry straight on, and everything survives a refresh, closing the app
or switching language. You can replace again (the chain is recorded in order, each step keeping its own
sets) or **undo the last replacement**; if the replacement already has sets recorded, undoing asks first
and tells you they will be discarded.

When you finish, the history records both sides honestly: the original with the sets it actually
performed plus *Replaced by Push-up*, and the replacement with *Replaces Dips*. An exercise with no sets
that was replaced is not written to history at all. If a plan lists the same exercise twice, GymQuest
refuses the replacement and says why, rather than risk mixing the two up.

### Demonstrations: what is here, and what is not

The demonstration gallery uses two kinds of media, and **both work offline once viewed**. Every file
is served from this repository and kept by the service worker after its first view; nothing is
hot-linked or fetched from another site.

- **Thirty-one exercises use a short local video** (`media/*.webm` and `media/*.mp4`) with
  play/pause controls and a poster image, and **no autoplay**. Eleven are originals from Wikimedia
  Commons: **Bench press, Squat, Overhead press, Bent-over row, Biceps curl, Pull-up, Lunges,
  Superman, Machine chest press, Incline dumbbell press** and **Leg extension** (the incline dumbbell
  press clip is the Commons 480p transcode). Twenty are Pexels videos (Pexels License), each trimmed
  to one clean repetition: **Dumbbell triceps extension, Leg curl, Calf raise, Band row, Dumbbell row,
  Hammer curl, Bodyweight squat, Step-up, Glute bridge, Single-leg glute bridge, Lateral raise, Cable
  curl, Pec deck, Wide-grip lat pulldown, Hack squat, Dips, Cable rows, Leg press, Push-up** and
  **Plank**.
- **A video is the only demonstration.** When an exercise has a video, the gallery shows just that
  video; earlier photographs of those exercises were removed.
- **Burpee, Front raise** and the **Hip abductor machine** use licensed photographs only. No correct,
  legally usable video was found for them yet.
- The **creator and licence are printed under every video and image** and listed in
  [`media/CREDITS.md`](media/CREDITS.md).

**Not every exercise has a demonstration yet, honestly.** These have **no correctly-matched, legally
usable photo or video yet**, so they show the *no photo or video* message with the written steps:
*Dumbbell pullover*, *Cable/machine pullover*, the *single-arm cable triceps extension*, the *Romanian
deadlift*, the *adductor (inner-thigh) machine*, *band chest press*, *band pulldown*, *pike push-up*,
*band shoulder press*, *diamond push-up*, *band biceps curl*, *split squat*, *hip thrust* and *dead
bug*. We searched Wikimedia Commons, Pexels, Pixabay and Mixkit on 2026-10-12; every rejected
candidate and the reason are in `tools/media/batches/batch-1.json` and `batch-23.json`. No
illustration was invented to fill a gap.

**Your own demonstrations.** From any exercise's detail view — built-in **or** one you created — you
can attach your own photo or video with **Add my photo or video**. These files are stored **only on
this device** (in the browser's IndexedDB), shown **first** in the gallery and labelled *My
demonstration*, and can be replaced or deleted at any time. They are **private**: never uploaded, not
sent to GitHub, a server, analytics or other users, and **not synced between devices**. They are also
**not** part of the JSON backup, so a backup does not carry them and they can be lost if you clear the
app's data. Photos (JPG, PNG, WebP, GIF) up to 15 MB and videos (MP4, WebM, MOV) up to 60 MB are
accepted, up to 12 of your own items per exercise.

**Beyond the gym.** From **Today**, *What do you want to do?* lets you choose a **gym**, **home** or
**outdoor** workout, or a **run**, **walk** or **cycle**. Home and outdoor training reuse the same
exercise library, filtered by place and by the equipment you have (the outdoors assumes none), and
ship with two optional, editable **starter workouts** — `for example` *Home starter* and *Outdoor
starter* — that you can rename, edit or delete. Runs, walks and cycles are recorded with
**start / pause / resume / finish / discard**, or logged **manually** after the fact: the timer
measures **active time only** (pauses excluded, derived from saved timestamps), **distance is only
ever what you type**, and **pace** (run/walk) or **average speed** (cycle) is **calculated** from the
two and shown only when both are valid. There is **no GPS, map, route, live speed or calorie
estimate**. Every activity appears in **Progress** and the **Calendar** with a clear label, and —
conservatively — counts toward your weekly goal, streak and XP (each completed activity gives the
base 20 XP once; editing never re-awards). Silo strength statistics are unchanged.

**Progress photos.** **Progress → Photos** keeps a private timeline of your own photos. Add one or
more at a time, set the **date** (defaults to today), and optionally a **note** and a **view** (Front
/ Side / Back / Other). Thumbnails are listed in chronological order; tap one for a larger view with
edit, delete (with confirmation) and **Save to device**. **Compare** any two photos: the earlier date
is shown as *Before*, the later as *Now*, side by side (stacked on narrow screens) with their aspect
ratios kept. Photos are stored **only on this device** in IndexedDB — **not** synced, **not** in the
JSON backup, **not** encrypted or password-protected, and lost if you clear the app/browser data. Only
an **optimized copy and a thumbnail** are kept (the original file is not stored), and location
metadata is never shown or exported.

**Community (optional, online).** GymQuest can also host an **opt-in** community: a moderated,
paginated **Everyone** feed of approved posts, a **Following** feed (posts and shares from people you
follow), public profiles with a username (never an email), follower and following counts and lists,
**likes**, internal **shares** (inside GymQuest only — no public links), blocking, reporting with a
reason, and a moderator queue. A post is text, 1–4 photos, or both; **every new post is reviewed by a
moderator** before others see it, and its text can no longer be edited after review. Accounts are for
people aged **16 or older** (confirmed once; no birth date is stored). Community is **off by default**
and stays off until the owner configures a Supabase project (`community-config.js`) *and* the user
explicitly enables it — the app makes **no network requests** before that. Only the text and photos
you put in a post are uploaded — photos from your device or your private gallery, re-saved in the app
without location or camera data — never your workouts, plans, measurements, calendar, backup or the
rest of your gallery. Blocking someone hides your profiles and posts from each other and removes the
follows between you. Setup, security (RLS/Storage policies, server-side quotas and spam limits), the
rollback and the owner steps are in [`supabase/README.md`](supabase/README.md).

**Community invitation.** If Community is set up but you have not turned it on, GymQuest
shows a short **Join the GymQuest Community** window the first time you open the app each day. **Join** takes you to the
Community tab (sign in or create an account there); **Not now**, **✕**, Esc or tapping outside
closes it. It comes back at most **once a day** (the next calendar day) until you join, and
someone who has not finished a workout yet first sees it the day after starting to use the app. It never appears during a
workout, while a form, dialog or the update/backup notice is open, on the Community tab or while
offline. Showing it sends nothing. The time it was last shown is stored only on this device
(`gymquest_community_invite`) and is never synced.

**Leaderboard (Top 20).** With Community on, the **Top 20** button shows the 20 members with the
most XP in two tabs: **All time** (total XP and level, the same numbers as in your app) and **This
week** (XP from workouts and activities since Monday). Your own row is highlighted, and if you are
outside the top 20 your rank is shown underneath. To keep it fair, the leaderboard counts at most
300 XP from workouts and activities per day and 1,000 per week, and achievements count with their
real value. Every Community member appears by default. Turn off **Community → Profile → Show me on
the leaderboard** to hide yourself. The leaderboard shows only your username, avatar, level and XP,
never your workouts. Moderators can remove a member from it. It needs internet and a Community
account; your XP in the app never changes because of it.

**Message notifications (optional).** Turn on **Community → Profile → Notifications** (or **Turn on**
above the chat list) to get a notification on this device when a friend sends you a chat message,
even when GymQuest is closed. Tapping it opens that chat. The notification shows only the friend's
username (*New message from anna*), never the message text, in your app language. Several quick
messages from the same chat give one notification (at most one every 20 seconds per chat). It is
off by default, works per device, and asks for the system permission first. Signing out, leaving
Community or turning Community off stops notifications on this device. **iPhone and iPad:** web
notifications work only when GymQuest is added to the Home Screen (Share → Add to Home Screen) and
opened from there, on iOS 16.4 or newer; in Safari the app explains this instead of the switch. If
notifications are blocked in the phone or browser settings, the app says so and how to allow them.
The notification goes through your browser's push service (Apple, Google, Mozilla or Microsoft),
encrypted so that only your device can read it.

**Reminders (on by default).** With notifications on, **Community → Profile → Reminders** reminds you to
**drink water** (every 30 minutes to 3 hours between two times), to **eat** (up to three meal times) and
to **work out** (chosen weekdays at a time). They use your phone's time zone, arrive even when the app
is closed, and are sent by the server at most once per reminder (checked every 5 minutes, so a
reminder may come up to 5 minutes after its time). Turning notifications off, signing out or leaving
Community stops them. They start **switched on** (water every 2 hours 08:00–21:00, meals at 08:00 · 12:30 · 18:30, workout
Mon/Wed/Fri at 17:00, in your phone's time zone) as soon as notifications are on; every switch can be
turned off and stays off.

**Opening a chat** always shows the newest messages, right above the input box (scroll up for older
ones). A new message from your friend keeps you at the end if you were there, but never pulls you down
while you are reading older messages; your own message always takes you to the end.

**Replies and reactions in chat.** Tap a message to react with ❤️ 😂 👍 😮 💪 🔥 (one reaction per person
per message; tap your reaction again to remove it) or to **Reply** — the answer shows the quoted
message. Tap the quote (or **Show the original message** in the reply's menu) to jump to the original
message, which lights up briefly; if it is older than the loaded part of the chat or was deleted, a short
note says so. Only the two people in the chat see reactions; reactions in an open chat refresh every few
seconds.

**Sharing workout plans and workouts.** In a chat, **Share a plan or workout** sends one of your plans
or one of your last five workouts as a card (exercises, sets × reps, weights; a workout also shows the
date, duration, XP and each set's weight and reps). An exercise done one side at a time shows as
*2 sets per side* (not as *4/2 sets*), and **Save to my plans** keeps it one side at a time. In a new post you can **attach your current plan**, your
**last workout** or any plan or recent workout — like a tweet with an attachment; the post is
reviewed by a moderator as usual and the card follows the post's visibility (everyone / friends).
After finishing a workout, **Share to Community** opens a new post with that workout already
attached. Anyone who sees a card can tap **Save to my plans** to get their own copy as a new plan
(the original is never changed).

**Train together with a friend.** On **Workout**, tap **👥 Train with a friend** and pick one of your
friends; you can also send your current plan so you both do the same workout. Your friend gets a chat
message (and a notification if they turned them on) and an invitation on **Today** and **Workout**:
**Join** (optionally with your plan, saved as a copy in their plans) or **Not now**. The invitation is
valid for 30 minutes. While you train together, each of you sees a small live card of the other —
current exercise, sets done out of planned, the last set (reps × kg) and *finished ✓* — and you can send
quick cheers 💪 🔥 👏 🙌. Only that summary is shared, only with that friend and only during the
session; each phone still saves its own workout offline exactly as before. Either of you can **End** the
session; it also ends by itself when both have finished, or after 6 hours. Workouts done together show
*👥 Trained with …* in Progress and in the Calendar. You can be in one session at a time; unfriending or
leaving Community removes your sessions with that person.

**Top achievements on your profile.** Your profile shows your three best achievements (by XP). The app
reports which achievements you earned; the server keeps only real ones that match your number of
workouts. Turn off **Profile → Show my top achievements on my profile** to hide them from others.

**Swipe between media** with your finger, or use the **‹ ›** buttons, the dots, the counter or the arrow
keys. Each item has a **caption** in every supported language, and the **creator and licence are printed
under the media**. If a demonstration cannot be loaded, you get a clean **"Demonstration unavailable"**
state with the written steps — never a broken-image icon.

**Provenance.** Every visual asset is listed in a developer-facing manifest
(`exerciseMediaManifest()` in the console) with its asset id, exercise id, source type (`file` or
`original`), creator, licence, licence URL, source page and offline path. The full attribution list is
also in [`media/CREDITS.md`](media/CREDITS.md).

**Video format and offline.** Every video comes as **WebM (VP8/VP9)** and **MP4 (H.264)**. The browser
picks the one it can play, so older iPhones get the MP4. A demonstration is **downloaded the first time
you open that exercise**, then kept on the device in its own cache, so it works offline from then on.
App updates never download demonstrations again. If you open an exercise for the first time while
offline, it shows *Connect to the internet once to load this demonstration.* Most clips are modest
(under ~0.6 MB). The public-domain CDC clips are larger (bicep curl ≈ 5.4 MB, machine chest press ≈
3.6 MB, leg extension ≈ 5.9 MB), and the incline dumbbell press clip is the Commons 480p transcode
(≈ 10.9 MB). Each MP4 copy is at most 4 MB.

### Accuracy and safety

The library is descriptive and educational. It does not promise a specific body shape or result, it does
not label any exercise universally "safe" or "unsafe", and it does not give medical diagnoses or
treatment advice. An alternative is a training suggestion, **not** a medical recommendation for an
injury. If something hurts, stop and get qualified advice.

## Training to failure (optional)

Training to failure is an optional technique — GymQuest only records what you choose, and never
switches anything on by itself.

- **Planned failure sets** — in the plan editor, every exercise has a **Sets to failure** section
  (*Série do zlyhania*). Pick any combination of set numbers, or **None**. The choices are stored
  with the plan and survive refresh, export/import, language switching and updates. Reducing the set
  count drops any selection above the new maximum; increasing it keeps your existing choices.
- **Completed failure sets** — during a workout every set has its own small flame toggle. A set that
  was planned shows a subtle dashed hint but is **never** counted as taken to failure on its own. You
  can mark any set — planned or not — and unmark a planned one, right up to the moment you finish.
- **Separate in history** — the finished workout stores the planned configuration *and* the actual
  result as two different fields. History and the Calendar day detail only ever show the actual
  result, and only when there is one. Old workouts without this data simply show no failure line.

It is tracked information only — not a training recommendation, and never medical advice.

---

## Training one side at a time (optional)

Some exercises are done one side at a time — a single-arm curl or triceps extension, a single-arm row,
a single-leg extension or curl, a Bulgarian split squat, or any custom unilateral exercise.

Every exercise in the plan editor has an optional switch, **Train both sides separately** (*Cvičiť
každú stranu samostatne*). It is **off by default**, so nothing about your existing plans changes until
you switch it on. When it is on you also choose the side you start with — **Start with left** (*Začať
ľavou*) or **Start with right** (*Začať pravou*), defaulting to left. Both the switch and the starting
side are saved with the plan and survive a refresh, export/import, language switching and updates.

During the workout the exercise is listed as *N sets per side* (*N série na každú stranu*) and every
planned set becomes two independent rows, alternating the sides in the order you chose:

```
Single-arm Triceps Extension        3 sets per side
Set 1 — Left    [✓] [🔥]
Set 1 — Right   [✓] [🔥]
Set 2 — Left    [✓] [🔥]
Set 2 — Right   [✓] [🔥]
Set 3 — Left    [✓] [🔥]
Set 3 — Right   [✓] [🔥]
```

- Each side is tracked **separately**: ticking the left never ticks the right, and each side has its
  own 🔥 failure marker. You can finish left-only, right-only, one side at a time, or anything in
  between.
- The rest timer stays completely manual — nothing is ever started for you between sides. Start it
  yourself whenever you want it, exactly as before.
- Your progress through the sides lives in the active session, so it survives changing language,
  switching tabs, opening the Calendar, editing a plan, backgrounding the app and a page refresh, and
  the workout duration keeps running normally.
- History and the Calendar day detail record that the exercise was unilateral, which side you started
  with and which sides you actually completed — for example *3 sets per side · 12 reps · 10 kg*,
  *Completed: Left and Right*, *Failure: Set 3 — Right*.
- **XP rule (documented):** a unilateral set is one working set per side, and GymQuest already awards
  XP per *tracked* set — so each completed side counts once, just like any other completed set. Sets
  that were not completed count for nothing, a side is never counted twice, and personal records are
  unaffected because they are based on the exercise's weight, not on how many sides you logged.
- An exercise without the switch behaves exactly as before, and nothing in your existing plans,
  history, XP or achievements is changed by this feature.

It is tracked information only — not a training recommendation, and never medical advice.

---

## Training to failure, side by side

The optional **failure** tracking works unchanged, and on a unilateral exercise each row has its own
flame: *Séria 3 — Pravá* can be marked as failure while *Séria 3 — Ľavá* is not. The finished workout
stores the planned configuration for the exercise and the actual per-side result separately, and
history only ever shows the recorded result.

---

## Body, calories, food and information

These four additions live inside the **Progress** screen as the **Body** and **Food** sub-views. They
are strictly optional: nothing here is enabled, prefilled or guessed for you, and every one of them
works fully offline with no account needed. All of it is saved in your browser's own storage on your
device, and it is also synced to your account only if you sign in with account sync on.

### Body — weight and measurements

Optional and available right away (there is nothing to switch on). In **Progress → Body** you can log:

- body weight
- waist
- chest
- left and right upper arm
- left and right thigh
- hip
- an optional free-text note

Every entry has a **local calendar date**. You can save more than one entry for the same day — the
model is a flat list of entries with stable ids, so nothing has to be overwritten. The screen shows, for
each measurement you have recorded, the **latest value**, the **change since the previous entry** (as a
plain `+1.2` / `−0.8`, deliberately with no colour coding and no "good" or "bad" judgement, because an
increase or decrease is not automatically either), a **chronological history** you can edit ✏️ or
delete 🗑️ (with a confirmation on delete), and a small **trend chart**.

The chart is drawn with a few lines of inline SVG — there is no charting library, no CDN and no
download. Pick which measurement to plot with the chips above it; it appears once that measurement has
at least two entries.

**Units.** Choose `kg · cm` or `lb · in` in the Body card. **Values are always stored in kilograms and
centimetres**; the setting only changes what you type and read. Switching units therefore never
rewrites, reinterprets or damages an existing entry — a value logged in kg is still the same value when
you switch to lb.

**Validation.** Weight must be between 1 and 500 kg and circumferences between 1 and 400 cm (converted
from whatever unit you are using). Negative, zero, non-numeric and implausibly large values are
rejected with a message that names the offending field, and the dialog keeps your input so you can fix
it. A value that *is* valid is stored exactly as you entered it — never silently adjusted. A completely
empty entry is rejected, and a date that does not exist (say `2026-02-31`) is refused.

Body measurements are kept in their own collection and are never mixed with the weights you lift.

**Nothing is inferred.** GymQuest does not guess your age, height, sex, weight or goals from your
workout history, and it never prefills personal data.

### Calories — optional and cautious

Hidden by default. Turn it on with **Show the estimate** in **Progress → Body** and it can be hidden
again at any time with **Hide the estimate**; hiding keeps the values you entered.

- **Every input is yours.** Height, age, the sex variable the formula uses, and an activity level. The
  **body weight is taken from your own latest logged measurement** and is clearly labelled with its
  date. With no measurement logged, the field is empty and **no estimate is produced** — GymQuest will
  not guess it.
- **The adult question comes first.** You are asked whether you are 18 or older before any formula
  input is even shown. If you are **under 18**, no numbers are displayed at all and no formula is run:
  you get a short explanation that calorie targets for a growing body are a conversation for a doctor,
  a dietitian or a parent, and GymQuest will not invent one. If the question is unanswered, nothing is
  calculated.
- **Fewer than all inputs, no number.** If anything is missing the card says what is still missing
  instead of filling in an assumption.
- **A range, not an instruction.** The result is shown as a range of ±10 %, labelled as an estimate.
- **The formula and its source are printed in the app.** Resting energy from **Mifflin-St Jeor**
  (Mifflin MD et al., *Am J Clin Nutr*, 1990) — `10 × kg + 6.25 × cm − 5 × age + 5` for male and
  `− 161` for female — multiplied by an activity factor (1.2, 1.375, 1.55, 1.725 or 1.9) to estimate
  daily energy expenditure.
- **Deliberately omitted: weight-loss and weight-gain targets.** GymQuest offers no deficit or surplus
  presets and never phrases the result as a meal plan, because the honest version of that advice depends
  on things a formula cannot see.
- **Its limits are listed in the app**, in plain language: it is a population average, it cannot see
  body composition, health conditions, medication, pregnancy or how you actually train, it is not a
  target to hit exactly, it is not a meal plan, and anything medical belongs with a qualified
  professional.
- **Freshness is shown.** *Last calculated* updates whenever a relevant input changes, and the estimate
  recalculates at the same moment.
- **Completely separate from your training rewards.** The calorie estimate and the food log write
  nothing to XP, achievements, streaks or the weekly goal.

### Food — a manual log, and nothing more

Off by default. Turn it on in **Progress → Food**; turning it back off keeps every entry you logged.

- Add a food with a name, energy in kcal and, optionally, protein, carbohydrates and fat, plus an
  amount multiplier for the portion you actually ate.
- Save any of them as a **reusable food** and pick them from a list next time. Amounts scale the energy
  and macros for you.
- Every day has its own totals, and you can step to the previous or next day.
- Edit or delete entries and saved foods; deleting asks for confirmation first.
- **History is never rewritten.** A logged entry stores its own copy of the name and values, so editing
  or deleting a saved food later cannot change what you recorded at the time.

**What GymQuest does not have, and does not pretend to have:** there is **no food database**, no
barcode scanner, no packaged-food or restaurant database, and no synced meal tracking. All of those
would need an online service or a backend, which would break the offline, privacy-first promise. The
food log therefore says plainly that **you entered these values yourself and GymQuest does not verify
nutrition data**.

Those four things are possible future work, and their cost is the same each time: a remote database,
network access, an account to sync against, and somebody to keep the data current. None of them is
compatible with an app that stores your data only on your own device.

### Information

A collapsible **How to read these numbers** card in the Body sub-view (and a shorter one about logged
values in Food) explains, in every supported language:

1. how to measure body weight consistently,
2. why day-to-day body-weight changes do not necessarily reflect a long-term trend,
3. what workout duration, sets, reps and progressive overload mean,
4. what the calorie estimate can and cannot tell you,
5. what user-entered nutrition values mean.

The wording is informational only. It is not personalised medical advice, and it deliberately uses no
shame, guilt, "earned food" framing or pressure to change your weight.

## Workout duration and your active session

**Duration** — pressing **Start workout** starts a session timer shown as *Workout duration*
(*Trvanie tréningu*) above the exercise list, in `HH:MM:SS`. It measures the whole workout, not just
rests, and it keeps running while you move between exercises, mark sets, open dialogs, edit a plan,
switch tabs or send the app to the background. It is derived from an absolute start timestamp, so it
stays accurate after backgrounding, screen lock or a reload. It stops only when you confirm
**Finish workout**; the saved duration then appears as *Duration: 42 min* (*Trvanie: 42 min*) in
Progress and in the Calendar day detail. The rest timer is completely separate.

**Your progress is kept** — what you have checked off lives in an **active session** saved with your
data, not in the screen you are looking at. Editing a plan weight, saving a plan, opening the editor,
switching SK/EN, switching tabs, opening Settings or the Calendar, and a browser refresh all keep
your completed sets, your failure markers, your timer and your selected plan exactly as they were.
Changing a plan weight still updates the target weight shown for sets you have not done yet; already
completed sets are never rewritten. Saving a plan during a workout confirms it with *Plan changes are
saved. Your current workout progress is preserved.*

The session is created only when you start a workout or mark your first set, and it is cleared only
when you **confirm** Finish workout, or **confirm** Reset workout — cancelling either dialog changes
nothing. A partially finished session is never written into your history, is not included in
**Export data**, and is dropped on import, so a backup can never carry a half-finished workout onto
another device.

---

## History: undo, edit, delete

- After finishing a workout you can press **Undo this workout** in the dialog — the workout and its
  XP are removed.
- In **Progress**, every workout has ✏️ (edit date, note, sets, reps and weights) and 🗑️ (delete)
  buttons. After any change, counts, streak, XP, level, records and achievements are recalculated.
- **Reset workout** on the Workout screen clears only the sets you have marked in the current
  session — your history is never touched.
- These confirmations always name both choices: **Reset workout** / **Back to workout**,
  **Undo this workout** / **Keep workout**, and **Delete** / **Keep workout**.

---

## Export, import and reset

- **Export data** (⚙️ Settings) downloads all of your data as a JSON file.
- **Import data** restores your data from a JSON backup, with validation and a confirmation prompt.
- **Reset data** erases everything after a double confirmation.

---

## Automatic backups — what is automatic and what is not

Automatic backup has **no switch**: it is **always on while this device does not sync to an account**
(you are not signed in, or account sync is turned off) — then a backup file is your only safety copy.
While account sync is on, your data is already safe in your account, so no backup files are created
and ⚙️ Settings shows *Not needed – your data syncs to your account*. It only ever acts **while the app
is open** — a static web app cannot run while it is closed or suspended, so GymQuest never claims
otherwise.

A JSON backup becomes due after **five newly completed workouts** and **at most once every seven
days**. If a backup is already due the next time you open the app, you are offered it
then. Nothing is offered during an active workout, while you are entering exercise data, or while a
dialog is open — the app waits until you are done.

### The one honest limitation: iPhones cannot save a file without a tap

| | Desktop / Android | iPhone (Safari and Home Screen) |
|---|---|---|
| Backup file created **with no tap** | **Yes** — the file goes straight to your Downloads | **No.** iOS gives no reliable way to do that |
| What you get instead | — | A **Save backup now** strip; tapping it opens the iOS share sheet |
| Where the file ends up | your Downloads folder | the share sheet → **Save to Files** → iCloud Drive or On My iPhone |

A web app cannot silently write to Files or iCloud Drive, and the share sheet always needs a real tap —
so on iPhone **one tap is always required**, and GymQuest says so instead of pretending otherwise.
Worse, iOS gives no confirmation that the file was actually kept (the share sheet reports "done" even
when you cancel), so **GymQuest never displays "Backup saved"** on any platform. It tells you the file
was created and where to look, and nothing more.

### Using it

- **⚙️ Settings → Backup & sync → Automatic backup** — its state (*On*), the honest explanation and the date
  of the last backup offered. While account sync is on the row is hidden (it would only say *Not needed*).
  **Save backup now** is always available, with or without an account.
- When a backup is due you also get a small strip above the tab bar with **Save backup now** (or
  **Save again**), the filename, and the plain truth about confirmation. Dismissing it hides it for
  that session only; export/import and the manual button are always there.

The file is named `gymquest-backup-YYYY-MM-DD-HHMM.json` using your **local** date and time, and its
contents are exactly the same payload as **Export data** (state without a half-finished workout). Old
exports import into it and it imports into old versions — the format has not changed.

Two protections worth knowing: because every offer is recorded, backups cannot pile up — at most one
file per seven-day window; and if you ever import a backup that contains **fewer workouts than you
currently have**, the confirmation dialog says so before anything is replaced.

### Nothing leaves your device

There is no server, no account and no cloud API. A backup file is only ever created **on your device**,
by your browser, into your own Downloads folder or your own Files app. GymQuest also deliberately keeps
**no second copy** in IndexedDB or the cache: storage that is wiped together with the app is not an
independent backup, so it is not offered as one. Backup files are never added to the app's offline
cache and never committed to the repository.

### Recovering GymQuest from a backup file

1. Open GymQuest (a brand-new install or a wiped browser is fine).
2. ⚙️ Settings → **Import data** → choose `gymquest-backup-….json`.
3. Confirm. Your plans, history, XP, achievements, streaks, goals, notes, durations, failure sets and
   settings come back exactly as they were. Your current language is kept if the file has none.

### On-device iPhone checks

1. Add GymQuest to the Home Screen and open it from the icon.
2. ⚙️ Settings → **Automatic backup** on → **Save backup now** → the share sheet appears → **Save to
   Files** → iCloud Drive or On My iPhone.
3. Check **Files** for `gymquest-backup-….json` and open it — you should see the JSON.
4. To see the due strip without waiting a week, open Safari's Web Inspector console with the app in the
   foreground and run:
   `state.settings.autoBackupWorkoutCount = 0; state.settings.autoBackupOfferedAt = 0; saveState(); refreshBackupOffer();`
   — on iPhone this shows the strip and waits for your tap. This is the part that cannot be verified
   from a desktop browser, so it is worth confirming on your own device.
5. Background it, wait, and reopen: the strip comes back only if a backup is still due. Nothing runs
   while GymQuest is closed.

---

## Data storage and privacy

Everything is saved on your device first — in `localStorage` (state) and IndexedDB (photos and your
own exercise media) — and survives page refreshes and browser restarts. There are **no analytics and
no tracking**.

- **Without an account** nothing leaves your device.
- **With an account** (signed in via Community), your data is also synchronized privately to your own
  account — see *Account sync* below. Nobody else can read it; Community moderators cannot either.
- **Message notifications** (only if you turn them on) store this device's push address on the
  server so a friend's message can be announced; it is deleted when you turn them off, sign out,
  leave Community or delete your account.
- When several people use the same link, **each person's data is private to their own browser.**

### Account sync (offline-first)

- **Local first.** Every change is saved on the device immediately, online or offline, and also when
  sync is off or the session has expired. Settings show **two separate lines**: *Saved on this device*
  and the account sync status (synced / pending / offline / conflict / incomplete).
- **Automatic.** Sync is on by default for signed-in users (⚙️ Settings → *Account sync*, per account
  on each device). It runs on start, after sign-in, a few seconds after each change, when the device
  comes back online, when the app returns to the foreground, and every 5 minutes while open. There is
  no live push: other devices see changes at those moments.
- **New device.** Sign in and your calendar, workouts, plans and custom exercises, motivation,
  measurements, food, photos and exercise media load automatically.
- **Never silent.** If this device and the account both changed, sync pauses with an explicit choice
  (*Keep this device* / *Keep account* / *Decide later*). Before applying a choice, a recovery copy of
  **both** versions is kept (⚙️ Settings → *Recovery copies*). An empty device never overwrites a
  populated account, and *Reset data* re-loads the account instead of uploading empty data.
- **Separate workspaces.** Each account has its own storage on the device; signed out you use a
  separate guest workspace. Signing out or switching accounts never shows or uploads one account's
  data as another's, and pending changes stay with their account until it signs in again.
  Data from before this version stays where it was: it is linked to an account automatically only if
  this device had already backed it up to that account; otherwise you are asked.
- **One tab at a time.** GymQuest runs in a single browser tab per device; another tab shows
  *GymQuest is open in another tab* with **Use here**, which first lets the active tab finish its
  sync and save, then hands over. (Browsers without the Web Locks API are not coordinated.)
- **Expired session.** Saving on the device continues; changes wait and are uploaded after you sign
  in again to the same account. Signing in to a different account never receives them.
- **Device-only settings** (never uploaded, never overwritten by the account): language, rest-timer
  sound and length, the custom rest time, JSON auto-backup settings, the Community switch, the
  running workout/activity and the running rest timer. Everything else belongs to the account.
- **Media.** Files are uploaded before the backup that references them; a file that failed to upload
  stays marked as unsynced and is never replaced by account data. Videos over 50 MB stay on the device
  (shown as "synced with a warning").
- **Interrupted loads.** Loading account data is journaled; if the app or browser is killed midway, the
  next start finishes it or rolls it back. The browser may write the most recent seconds of
  `localStorage` changes to disk with a short delay, so a crash immediately after a change can lose
  that last change on the device (it is still in the account if it was already synced).
- On first launch, after confirming your weekly goal, **no demo data is created** — you start with a
  clean history (0 workouts, 0 XP, no achievements). You can load demo data at any time from
  ⚙️ Settings with **Load demo data**, and remove it with **Remove demo data**.

### Account emails (confirmation and password reset)

- **Sign-up** sends a confirmation link; the account works after the link is opened. The message is
  the same whether or not the email already has an account, so nobody can probe which emails are
  registered. The email stays in the form.
- **Resend confirmation email** (on the sign-in form and on the expired-link page) sends a new link;
  earlier links stop working. Each email address can get one email per 60 seconds — the button shows
  the countdown.
- **Forgot password** sends a reset link that opens GymQuest's *set a new password* form. Each link
  works once; a used, expired or altered link shows *invalid or expired — nothing was changed* with
  buttons to request a new reset or confirmation link.
- Rate limits, sending failures and no connection are shown as such; the app never says an email was
  sent when the request failed. Emails can take a few minutes and may land in spam.
- Verification: `tests/auth/README.md`.

### How much room there is

The whole app lives in a single `localStorage` value, and browsers allow roughly **5 MB per origin**
(Safari can be stricter). That is a lot of workouts, and it is worth knowing where it goes:

| Data | per entry | 1 year | 10 years |
|---|---|---|---|
| Body measurement | ~170 bytes | ~60 KB (one a day) | ~600 KB |
| Food log entry | ~130 bytes | ~475 KB (ten a day) | **~4.7 MB** |

So the **food log is the only part that can realistically fill it up**, and only if you log a lot for
many years. The exercise library adds **nothing here at all** — it lives in the app's code, not in your
stored data, so a bigger library never costs you storage. It does make the app itself a little larger to
download and cache (about 145 KB of code and translations, roughly a third more for `script.js`), which
is a one-time cost and is cached offline like the rest of the app.

GymQuest never deletes anything to make room. Instead:

- If a save is ever refused by the browser, a warning appears at the top of the app saying what
  happened and pointing you at **Export data** — so you can save a file while your data is still in
  memory.
- Once the stored data passes roughly 3.5 MB, the **Body** and **Food** sub-views show a short notice
  suggesting you export a backup and consider removing old entries you no longer need. Nothing is
  pruned automatically, ever.

**A browser is not a durable backup.** `localStorage` — and the internal browser caches — are part of
your browser's profile and disappear if you clear site data, uninstall the browser or reset the device.
Only the JSON file produced by **Export data** or **Automatic backups** exists genuinely outside
GymQuest, which is why [recovering from one](#recovering-gymquest-from-a-backup-file) is documented
below.

### Clearing your data

Open **DevTools (F12) → Application → Local Storage → `gymquest`** and delete the value, or use
**Reset data** in Settings.

### A note for iPhone users

Safari removes script-writable storage (including `localStorage`) after roughly **7 days without
visiting the site**. Adding GymQuest to your **Home Screen** avoids that limit, which is the
recommended way to use it on iOS. Regardless: **export a backup occasionally** — a browser is not a
durable database.

---

## Deployment

GymQuest is a purely static site, so it is published with **GitHub Pages** and needs no build step,
no CI pipeline and no server.

- **Source:** the `main` branch, `/ (root)` folder.
- **To deploy your own copy:** create a public repository, push these files to `main`, then open
  **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
- **Resulting URL:** `https://<your-user>.github.io/<your-repo>/`

Nothing has to be compiled: the files in the repository are exactly the files the browser runs.

---

## Updates and offline use

GymQuest is a progressive web app: a service worker (`sw.js`) precaches the app shell, so after the
first successful load **it works fully offline**, including from a Home Screen icon.

When a new version is deployed, the app notices the waiting update and offers a small in-app message —
*A new version of GymQuest is available* / *Je dostupná nová verzia GymQuestu.* — with an **Update now**
/ **Aktualizovať** button. Nothing is reloaded until you press it, and the message stays hidden while
you are in the middle of something that would lose input: an active workout, an open plan editor, a
note, or a settings form.

The app looks for a new version every time it opens, and again whenever it comes back to the screen
(at most once a minute). An app installed on a phone's Home Screen usually just resumes instead of
reloading, so it needs this check.

You can also check by hand: **⚙️ Settings → App updates** shows the installed version and has a
**Check for updates** button. If a new version is ready, **Update now** installs it right there. During a
workout it waits until you finish. If you're offline or the check fails, the message says so.

### Deploying an update

1. Change the app files.
2. **Bump `CACHE_VERSION` in `sw.js`** (for example `v1` → `v2`).
3. Push to `main`.

Step 2 matters: the new worker only installs if `sw.js` itself changed, and a new version is what
re-fetches every asset and deletes the previous cache. Skipping it leaves readers on the old cached
files. The cache name (`gymquest-v1`, `gymquest-v2`, …) is visible in DevTools →
Application → Cache Storage, so what is deployed can be inspected directly.

---

## Technology

Pure **HTML**, **CSS** and **vanilla JavaScript**. No frameworks, no CDN and nothing to install or
build. The app itself works fully offline and keeps your data on the device.

The optional online features (Community and account sync) use a **Supabase** backend: authentication,
a Postgres database with row-level security, Storage and Realtime. The Supabase JavaScript client is
vendored as `vendor/supabase-js.js`, the one third-party library, served from this site and not a
CDN. The backend is configured in `community-config.js` (public project URL and publishable key
only), and its database migrations and Edge Function are in `supabase/` (see `supabase/README.md`).
If you leave those values empty, the app makes no network requests at all.

---

## Licence

This is a personal project and no licence file is included, so no reuse rights are granted beyond
viewing the source.
