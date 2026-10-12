#!/usr/bin/env bash
# Checks tools/media/process.sh: codecs, size cap, no audio, max 480 px, faststart MP4, stripped photos.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$REPO/tools/media/process.sh"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
fail=0
ok() { echo "  PASS $1"; }
no() { echo "  FAIL $1"; fail=1; }
probe() { ffprobe -v error -select_streams "$2" -show_entries "$3" -of csv=p=0 "$1" | head -1; }

GQ_MEDIA_OUT="$OUT" bash "$T" video "$REPO/media/lunges.webm" t-lunge 2 8 >/dev/null
[ "$(probe "$OUT/t-lunge.webm" v:0 stream=codec_name)" = vp9 ] && ok "webm is VP9" || no "webm is VP9"
[ "$(probe "$OUT/t-lunge.mp4" v:0 stream=codec_name)" = h264 ] && ok "mp4 is H.264" || no "mp4 is H.264"
for f in t-lunge.webm t-lunge.mp4; do
  [ -z "$(probe "$OUT/$f" a stream=codec_name)" ] && ok "$f has no audio" || no "$f has no audio"
  h=$(probe "$OUT/$f" v:0 stream=height); [ "$h" -le 480 ] && ok "$f height $h <= 480" || no "$f height $h <= 480"
  s=$(stat -c %s "$OUT/$f"); [ "$s" -le 4194304 ] && ok "$f $s bytes <= 4 MB" || no "$f $s bytes <= 4 MB"
done
python3 - "$OUT/t-lunge.mp4" <<'EOF' && ok "mp4 has moov before mdat (faststart)" || no "mp4 has moov before mdat (faststart)"
import sys; b = open(sys.argv[1], 'rb').read(); sys.exit(0 if 0 <= b.find(b'moov') < b.find(b'mdat') else 1)
EOF
[ -s "$OUT/t-lunge-poster.jpg" ] && ok "poster written" || no "poster written"

GQ_MEDIA_OUT="$OUT" bash "$T" mp4 "$REPO/media/incline-dumbbell-press.webm" t-long >/dev/null
s=$(stat -c %s "$OUT/t-long.mp4"); [ "$s" -le 4194304 ] && ok "94 s clip MP4 fits the cap ($s bytes)" || no "94 s clip MP4 fits the cap ($s bytes)"

magick -size 3000x2000 xc:gray -set comment "camera data" "$OUT/in.jpg"
GQ_MEDIA_OUT="$OUT" bash "$T" photo "$OUT/in.jpg" t-photo >/dev/null
dims=$(magick identify -format '%w %h' "$OUT/t-photo.jpg"); [ "$dims" = "1200 800" ] && ok "photo resized to 1200x800" || no "photo resized ($dims)"
[ -z "$(magick identify -format '%c' "$OUT/t-photo.jpg")" ] && ok "photo metadata stripped" || no "photo metadata stripped"

bash "$T" frames "$REPO/media/lunges.webm" "$OUT/frames" 2 8 >/dev/null
[ "$(ls "$OUT/frames" | grep -c '^frame-[1-6]\.jpg$')" = 6 ] && ok "6 review frames" || no "6 review frames"

if bash "$T" bogus 2>/dev/null; then no "unknown command rejected"; else ok "unknown command rejected"; fi
exit $fail
