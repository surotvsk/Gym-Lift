# Demonstration media tests

Real headless Google Chrome over the DevTools protocol (helpers from `tests/sync/lib.js`), a local
static server on port 8126, and copies of the app built from the working tree. No accounts and no
network beyond `127.0.0.1`.

```bash
node tests/media/run.js                 # all scenarios
node tests/media/run.js "gallery"       # one scenario (regex)
bash tests/media/process-test.sh        # tools/media/process.sh output checks
```

Results: `$GQ_WORK/media-results.json` (default `/tmp/gq-media-work`). The suite uses Google Chrome
(not Chromium) because it needs H.264 for the MP4 checks.
