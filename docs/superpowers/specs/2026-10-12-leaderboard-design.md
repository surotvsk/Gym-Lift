# Community leaderboard: design

Date: 2026-10-12. Status: agreed in conversation; waiting for the owner's spec review.

## Goal

A large table in the app that shows the **top 20 Community members ranked by XP and level**, plus the
viewer's own rank. It should motivate people to train while staying private by default and resistant
to fake XP.

## Decisions (owner, 2026-10-12)

| Topic | Decision |
|---|---|
| Who appears | **All Community members, opt out.** Shown by default, with a "Show me on the leaderboard" switch to hide. |
| What it ranks | Two tabs: **All time** (total XP and level, the same numbers as in the app) and **This week** (training XP since Monday). |
| Fair play | Server-side limits plus a moderator "remove from leaderboard" action. |
| Placement | The Community tab gets a **Feed / Leaderboard** switch. |
| Server approach | **A:** the app reports its XP through a server function that checks it. The server never re-derives XP from private backups. |

## Measurements behind the limits (fresh install, headless Chrome, 2026-10-12)

Four workouts were finished in one day through the real UI, with every set ticked:

| Workout | Sets | Workout XP | Achievement XP | Gain | Total / level |
|---|---|---|---|---|---|
| 1 | 13 | +46 | +200 (first, newpr, fourplans) | +246 | 246 / 2 |
| 2 | 13 | +46 | +150 (pr5) | +196 | 442 / 4 |
| 3 | 17 | +54 | +375 (weeklygoal1, pr10) | +429 | 871 / 8 |
| 4 | 18 | +56 | +150 (variety4) | +206 | 1,077 / 10 |

- A normal workout is worth about 50 XP (20 per workout plus 2 per set).
- Large jumps come from achievements, mostly in a new user's first days.
- The 25 achievements add up to 5,150 XP. The per-exercise weight milestones give 0 XP.

## XP model (unchanged in the app)

`total XP = workout XP + activity XP + achievement XP`, and `level = floor(total XP / 100)`
(`levelInfo()` in `script.js`). The leaderboard shows exactly the same total and level the user sees.
The app's XP is never changed by leaderboard limits.

## What the app sends

`leaderboard_submit(training_total, week_training, week_key, workout_count, achievements)`

- `training_total`: lifetime workout XP plus activity XP.
- `week_training`: workout XP plus activity XP dated in the current ISO week.
- `week_key`: the ISO week, e.g. `2026-W42`, in the device's local calendar.
- `workout_count`: the number of completed workouts in history.
- `achievements`: the ids of the earned static achievements (the 25 in `staticAchievementDefs()`).

When it is sent: after a workout is finished, edited, undone or deleted, after an activity is
completed, edited or deleted, after a new achievement, and when Community is opened. Changes are
debounced, and only the latest value is sent. Nothing is queued while offline: the next send after
reconnecting carries the latest value.

## Server (migration `0009_leaderboard.sql`, local stack first)

### Table `leaderboard_entries` (one row per user)

`user_id` (PK, FK auth.users ON DELETE CASCADE), `training_xp`, `achievement_xp`, `total_xp`
(= training + achievement), `level` (= total / 100), `week_key`, `week_xp`, `day_key`,
`day_gain`, `reached_at` (when `total_xp` last increased; breaks ties), `hidden` (default false),
`removed_by_moderator` (default false), `updated_at`.

There are no direct table privileges for `anon` or `authenticated`. All access goes through
SECURITY DEFINER functions, following the pattern of `0002` and `0006`.

### Achievement XP is computed on the server

A fixed server-side list mirrors the app's 25 achievements and their XP (for example
`consistent12 = 750`, `hundred = 750`). The server adds up the XP of the ids it receives and ignores
unknown ids. **Achievements are never subject to the daily or weekly limits.**

Achievements that cannot be earned yet are dropped, and nothing else is affected:

| Achievement | Requires `workout_count` of at least |
|---|---|
| hundred (750) | 100 |
| fifty (350) | 50 |
| twentyfive (200) | 25 |
| ten (100) | 10 |
| five (50) | 5 |
| consistent12 (750) / consistent8 (500) / consistent4 (300) | 12 / 8 / 4 |

### Limits (training XP only)

| Limit | Value | Behaviour |
|---|---|---|
| Daily | **300 XP** per day (`day_key` = the server's UTC date, so changing the phone's clock cannot reset it) | The leaderboard counts at most 300 of new training XP per day; the rest is ignored. |
| Weekly | **1,000 XP** per ISO week | `week_xp` stored = min(reported, 1,000). |
| First submission | none | The first value is accepted as the starting point, so long-time users can join. Moderators handle abuse. |
| Decrease | allowed | Deleting or editing a workout can lower XP; the server stores the lower value. |

Exceeding a limit never removes the user and never changes the XP in the app.

### Reading

`leaderboard_top(period)`, where `period` is `'all'` or `'week'`. It returns at most 20 rows (rank,
user id, username, avatar path, level, XP shown) and the caller's own rank and XP, also when the
caller is outside the top 20.

- `all`: sorted by `total_xp` desc, then `reached_at` asc.
- `week`: sorted by `week_xp` desc, then `reached_at` asc. Only rows whose `week_key` is the
  server's current ISO week (UTC) count; other rows show 0 and are left out. Near midnight on Sunday a
  device's local week can differ from the server's UTC week for a few hours; that week's XP then
  counts from the next submission.
- Left out: hidden users, users removed by a moderator, suspended profiles, non-Community members
  (`community_joined_at` is null), and anyone the caller has blocked or who has blocked the caller.
- Only signed-in Community members can call it. No workouts, history or other data are exposed.

### Other functions

- `leaderboard_set_hidden(boolean)`: the user's own switch.
- `leaderboard_moderate(user_id, removed boolean)`: moderators only (`is_moderator()`). The action
  is recorded in the existing moderation history.
- Leave Community and full account deletion remove the row (`community_leave_cleanup` and the
  cascade from `auth.users`).
- `community_social_version()` returns **3** once 0009 is applied. The app shows the leaderboard only
  when it gets 3 or higher, so the release order is: the app first, then the migration.
- A rollback file `supabase/rollback/0009_down.sql` drops the leaderboard objects and sets the
  version back to 2.

## The app

- **Community tab:** a **Feed / Leaderboard** switch at the top (new `communityView = 'leaderboard'`).
- **Table:** tabs **All time** / **This week**, and columns rank, avatar, username, level and XP, with
  tabular numbers. Ranks 1–3 get gold, silver and bronze rank badges (styled, no emoji). The viewer's
  own row is highlighted. When the viewer is outside the top 20, a pinned row such as "#47 · you"
  sits below the table. This week shows the week's XP and the note "Resets Monday". Tapping a row
  opens that member's Community profile.
- **States:** loading; offline ("Connect to the internet to see the leaderboard"); an empty week ("No
  XP yet this week. Be the first."); and hidden ("You're hidden from the leaderboard" with a **Show
  me** button).
- **Settings → Community:** a "Show me on the leaderboard" switch, on by default.
- **Moderators:** a **Remove from leaderboard / Restore** action on a member's profile.
- **Text and accessibility:** all strings in 6 languages, Arabic laid out right to left. The table is a
  real `<table>` with headers. Each row is announced as "Rank 1, marek_lifts, level 42, 4,236 XP".
  It works with the keyboard, and the design matches the existing Community styles.
- **Offline and devices:** the board is online-only. Nothing about it is stored on the device. A
  device-only setting is not needed, because the hidden flag lives on the server.

## Testing

- **Server** (`tests/social/leaderboard.js`, **local Supabase stack only**, never production):
  - RLS and privileges, so `anon` gets no access and there are no direct table writes
  - submit limits (daily 300, weekly 1,000, first submission, decrease)
  - achievement XP computed on the server, unknown ids ignored, impossible achievements dropped
  - hidden, suspended, blocked (both ways), non-member and moderator removal
  - ranking ties, week rollover, own rank outside the top 20
  - Leave Community and account deletion remove the row
  - `community_social_version()` = 3; `0009_down` restores version 2
- **App** (`tests/social/ui-leaderboard.js`, headless Chrome against the local stack):
  - the switch appears only on version 3
  - both tabs, top 3 badges, own highlighted and pinned row
  - all states, the Settings switch, the moderator action
  - 6 languages including RTL, no page errors, no missing translations
- **The owner's acceptance check:** open the leaderboard on the iPhone after the release.

## Release (owner runs the production step)

1. Push the app (it hides the leaderboard until the server reports version 3).
2. The owner runs `0009_leaderboard.sql` once, as one transaction, in the Supabase SQL editor, then
   `NOTIFY pgrst, 'reload schema';`.
3. Deploy the `delete-account` function if `community_leave_cleanup` changed.
4. `supabase/README.md` gets the 0009 steps and rollback notes.

## Out of scope

Monthly or yearly boards, friends-only boards, live updates through Realtime, rewards or badges for
rank, and leaderboards for people outside Community.
