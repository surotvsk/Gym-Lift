# Exercise library demonstrations — design

Date: 2026-10-12 · Status: approved in conversation, awaiting spec review

## Goal

Every exercise in the built-in library (48 entries, `EXERCISE_LIBRARY` in `script.js`) shows a real
demonstration so users can learn the movement. That means a short video, or, where no correct video
exists, a 2–3 photo sequence of one person. Where neither exists, the current honest message stays.

## Current state (2026-10-12)

| Demonstration | Count |
|---|---|
| Licensed video (`EXERCISE_VIDEO_MEDIA`, WebM + poster) | 11 |
| Licensed 3-photo sequence (`EXERCISE_PHOTO_MEDIA`) | 5 |
| Single licensed photo | 8 |
| Text only (`media.none`): 18 lost their drawn illustrations in `3bf82b0`, and 6 never had media | 24 |

All media (36 MB) is precached by `sw.js` in the versioned app cache, so every `CACHE_VERSION` bump
re-downloads it.

## Rules for every demonstration (from the owner's stated preferences)

1. Order of preference: (1) a real video; (2) a 2–3 photo sequence of the **same person** and the
   same variation, in movement order (start → movement → end), with a caption for each phase and an
   "Image 1 of 3" indicator; (3) the existing `media.none` message. No drawn, schematic or AI-generated
   media.
2. Each candidate must show the **exact** named exercise and equipment variation. Before it is used,
   it is checked visually (frames extracted) and approved by the owner. A wrong or approximate match
   is rejected, and the exercise stays at (3).
3. Licences that allow redistribution in the app only: public domain / CC0, CC BY, CC BY-SA, and the
   Pexels or Pixabay licences. Creator, licence, licence URL and source page go in `MEDIA_CREDITS`
   (`script.js`) and `media/CREDITS.md`, and are shown under the media as today.
4. Exercises that already have photos: a correct video is added **before** the existing photos, which
   stay in the gallery.
5. The 11 existing videos get an MP4 copy (see "Formats").

## Sourcing

The search order for each exercise: Wikimedia Commons (video, then photos) → public-domain government
sources (e.g. CDC, already used) → Pexels / Pixabay. Originals are downloaded to a scratch directory
outside the repository. Only processed files are committed.

## Formats and processing (`tools/media/`)

A script that wraps `ffmpeg` / ImageMagick, so every file is produced the same way:

- **Video:** trimmed to one clean repetition (about 4–10 s), scaled to 480 px high, 30 fps, no audio.
  Two files: WebM (VP9) and MP4 (H.264, `libopenh264`, `+faststart`). Target about 2 MB per file,
  hard cap 4 MB. A poster JPEG (max 960 px wide) is taken from a representative frame.
- **Photos:** JPEG, longest side max 1200 px, all metadata (EXIF/GPS) stripped.
- **Naming:** `media/<exercise-id>[-n].{webm,mp4,jpg}`. A file is never changed in place: a
  replacement gets a new name (`-v2`), because cached media is never re-fetched.

## App changes

### Data and gallery (`script.js`)

- `EXERCISE_VIDEO_MEDIA[id]` gains `mp4`: `{ src: '<webm>', mp4: '<mp4>', poster }`.
- `framesForExercise()` returns the video frame **followed by** the photo frames when both exist
  (today it returns only one kind). `MEDIA_CREDITS[id]` lists credits in the same order as the frames.
- The video slide renders `<video>` with two `<source>` children (WebM, then MP4). Playback failure is
  detected on the last `<source>` (a `<video>` `error` event does not fire for source errors), and
  falls back to the existing unavailable state.
- When a demonstration fails while the device is offline and has never loaded it, the slide shows a
  new message, `media.offlineFirst` ("Connect to the internet once to load this demonstration."), in
  all six languages. It does not show the generic unavailable state.

### Service worker (`sw.js`)

- `media/*` is removed from `PRECACHE`. The app shell (HTML, CSS, JS, icons) stays versioned as today.
- New cache `gymquest-media` (fixed name). It is excluded from the old-cache cleanup in `activate`
  (the cleanup currently deletes every `gymquest-*` cache except the current one).
- Fetch for same-origin `/media/` paths is cache-first in `gymquest-media`. On a miss, the full file is
  fetched without a `Range` header, stored if the status is 200, then served. A request with a `Range`
  header is answered with `206 Partial Content`, sliced from the cached body (iPhone Safari loads
  video in ranges).
- Migration: on `activate`, media entries found in older `gymquest-v*` caches are copied into
  `gymquest-media` before those caches are deleted, so existing users download nothing again.

## Delivery in batches

Each batch is its own release (cache version bump) after owner approval on a private review page.
The page shows 6 frames per candidate, plus source, licence and file sizes.

| Batch | Content |
|---|---|
| 0 | Media cache, `<source>` WebM + MP4, offline-first message, MP4 copies of the 11 existing videos |
| 1 | The 6 exercises with no media: dumbbell pullover, cable pullover, single-arm dumbbell / cable triceps extension, Romanian deadlift, adductor machine |
| 2 | The 18 text-only exercises (leg curl, calf raise, band chest press, band pulldown, band row, dumbbell row, pike push-up, band shoulder press, hammer curl, diamond push-up, band biceps curl, bodyweight squat, split squat, step-up, glute bridge, hip thrust, single-leg glute bridge, dead bug) |
| 3 | Videos for the 13 photo-only exercises (lateral raise, cable curl, pec deck, lat pulldown, hack squat, dips, cable row, leg press, push-up, plank, burpee, front raise, abductor machine) |

## Testing

- **Headless Chrome suite** (`tests/media/`). For every library exercise: the gallery item count
  equals the credits count; the poster and every image load; the video reaches
  `readyState >= 2` with WebM and, forced, with MP4. A demonstration opened once still loads offline.
  An exercise never opened while offline shows `media.offlineFirst`. After a cache-version bump, no
  `media/` request reaches the server. A ranged request returns `206` from the service worker. No page
  errors and no missing translations.
- **Owner acceptance on iPhone** (Safari cannot be emulated): open a few exercises from each batch,
  play the video, then reopen one offline.
- `README.md` "Demonstrations" section and `media/CREDITS.md` are updated with each batch.

## Out of scope

Media for the user's own custom exercises (they can already attach their own), new exercises, and
changes to the exercise texts.
