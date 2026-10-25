# Play Console — Health apps declaration & Health Connect permissions

GymQuest requests exactly three Health Connect permissions (`AndroidManifest.xml`), all optional and
only after the user turns on Settings → Health Connect:

| Permission | Why GymQuest needs it (text for the declaration form) |
|---|---|
| `android.permission.health.READ_HEART_RATE` | After the user finishes a workout in GymQuest, the app reads heart-rate samples recorded by the user's watch **for the time of that workout only** and shows the average and maximum heart rate on the finished workout. |
| `android.permission.health.READ_ACTIVE_CALORIES_BURNED` | Same time window as above: shows the active calories burned during the finished workout. |
| `android.permission.health.WRITE_EXERCISE` | Saves each finished GymQuest workout to Health Connect as an exercise session (weightlifting, start/end time, plan name) so it appears in the user's other fitness apps; deletes it again when the user undoes or deletes the workout. |

## Answers

- **App category**: Health & Fitness — fitness/workout tracker (not a medical app, no diagnosis).
- **Core functionality using health data**: workout tracking; heart rate is a summary shown on the user's own workouts.
- **Does the app share Health Connect data with third parties?** No. The heart-rate summary is stored
  on the device and, only if the user enables cloud sync, in the user's private backup (Supabase,
  service provider). It is never shown in Community, never sold, never used for ads.
- **Limited Use**: the privacy policy states compliance with the Health Connect Permissions policy
  including the Limited Use requirements.
- **Privacy policy URL**: `https://surotvsk.github.io/Gymquest/privacy.html` (section "Health Connect").
- **Permission rationale screen**: `HealthPrivacyActivity` handles
  `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` and `VIEW_PERMISSION_USAGE` and opens that page.
- **Background reads**: none (reads happen right after a workout, on app resume within 2 h, or when
  the user taps "Refresh heart rate").
- **History reads** (older than 30 days): not requested.

## Video for the review (if asked)

Record on a phone: Settings → Health Connect switch → permission screen → finish a short workout →
result shows heart rate → Health Connect app shows the GymQuest exercise.
