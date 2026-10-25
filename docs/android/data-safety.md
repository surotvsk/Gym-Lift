# Play Console — Data safety answers (GymQuest Android, first release)

Basis: what the code does today (`script.js`, Supabase migrations 0001–0016, `push` / `reminders` /
`delete-account` Edge Functions). Re-check when features change.

## Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (only when the user turns on an account, Community, notifications or Health Connect) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS to Supabase, Firebase) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in-app (Settings → Community → Delete my community account) and on the website |

"Shared" in Play's sense = transferred to a third party for its own use. Supabase, Firebase and
GitHub act as service providers for GymQuest, which Play does **not** count as sharing.
→ Nothing is **shared**.

## Data types collected

| Data type | Collected | Optional? | Purpose | Notes |
|---|---|---|---|---|
| Personal info → Email address | Yes | Optional (account) | Account management | Sign-in only, never shown to others |
| Personal info → Name / User IDs | Yes | Optional (Community) | App functionality, account management | Public username in Community |
| Photos and videos → Photos | Yes | Optional (Community posts, avatar) | App functionality | EXIF removed; progress photos stay on device unless shared |
| Messages → Other in-app messages | Yes | Optional (Community chat) | App functionality | Between friends, stored on server |
| Health and fitness → Fitness info | Yes | Optional (account sync / Community) | App functionality | Workouts in the private backup; shared workouts / leaderboard only when the user posts them |
| Health and fitness → Health info | Yes | Optional (Health Connect + sync) | App functionality | Heart-rate summary of a workout, only in the user's private backup when sync is on; never in Community |
| App activity → Other user-generated content | Yes | Optional (Community) | App functionality | Posts, comments, likes |
| Device or other IDs | Yes | Optional (notifications) | App functionality | FCM token / Web Push subscription for message alerts |

Not collected: location, contacts, financial info, browsing history, search history, calendar,
audio, files, crash logs / diagnostics, advertising ID. No analytics SDK, no ads SDK.

For every collected type: **processed ephemerally?** No · **required or optional?** Optional ·
**collected, not shared**.

## Security practices

- Data encrypted in transit: Yes
- Users can request deletion: Yes
- Independent security review: No
