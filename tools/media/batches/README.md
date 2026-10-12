# Demonstration batches

One file per batch (`batch-N.json`). It records where every demonstration came from, the trim used and
the owner's decision, so any file in `media/` can be re-made with `tools/media/process.sh`.

Workflow: `tools/media/commons.js` (search) → download originals **outside** the repo →
`tools/media/process.sh frames` → `tools/media/review.js` (private review page) → owner decision →
`tools/media/process.sh video|photo` → data entries in `script.js` → `node tests/media/run.js`.

```json
{
  "batch": 1,
  "exercises": [
    {
      "id": "romanian-deadlift",
      "candidates": [
        {
          "kind": "video",
          "page": "https://commons.wikimedia.org/wiki/File:…",
          "file": "/tmp/gq-originals/rdl.webm",
          "creator": "…", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
          "trim": { "start": 3.2, "end": 9.8, "poster": 6.0 },
          "framesDir": "/tmp/gq-review/romanian-deadlift-1",
          "note": "barbell, side view, one clean rep"
        }
      ],
      "decision": null
    }
  ]
}
```

`decision` is set from the owner's reply. It is `{ "use": <candidate index>, "approvedOn": "YYYY-MM-DD" }`, or
`{ "use": null, "reason": "…" }` when no correct, legally usable match was found.
