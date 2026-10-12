#!/usr/bin/env bash
# GymQuest demonstration media: every file is produced the same way.
#   process.sh video  <input> <exercise-id> <start-s> <end-s> [poster-s]  -> <id>.webm, <id>.mp4, <id>-poster.jpg
#   process.sh mp4    <input> <exercise-id>                              -> <id>.mp4 (MP4 copy of an existing video)
#   process.sh photo  <input> <name>                                     -> <name>.jpg (max 1200 px, no metadata)
#   process.sh frames <input> <out-dir> [start-s end-s]                  -> frame-1.jpg … frame-6.jpg (for review)
# Output goes to $GQ_MEDIA_OUT (default: the repository's media/ folder). Fails if a file exceeds 4 MB.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${GQ_MEDIA_OUT:-$HERE/../../media}"
MAX_BYTES=4194304
SCALE="scale=-2:trunc(min(480\,ih)/2)*2,fps=30"

die() { echo "process.sh: $*" >&2; exit 1; }
check_size() {
  local n; n=$(stat -c %s "$1")
  [ "$n" -le "$MAX_BYTES" ] || die "$1 is $n bytes (limit $MAX_BYTES)"
  echo "$1 $n bytes"
}
duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
# MP4 bitrate in kbit/s: at most 900, lower for long clips so the file stays under ~3.6 MB.
mp4_kbps() { awk -v d="$1" 'BEGIN { k = int(3.6 * 8 * 1024 / (d > 0 ? d : 1)); print (k > 900 ? 900 : (k < 150 ? 150 : k)) }'; }

enc_webm() {   # <out> <ffmpeg input args…>
  local out="$1"; shift
  ffmpeg -nostdin -v error -y "$@" -an -vf "$SCALE" -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p "$out"
  check_size "$out"
}
enc_mp4() {    # <out> <kbps> <ffmpeg input args…>
  local out="$1" kbps="$2"; shift 2
  ffmpeg -nostdin -v error -y "$@" -an -vf "$SCALE" -c:v libopenh264 -b:v "${kbps}k" -pix_fmt yuv420p -movflags +faststart "$out"
  check_size "$out"
}

case "${1:-}" in
  video)
    [ $# -ge 5 ] || die "usage: video <input> <id> <start-s> <end-s> [poster-s]"
    in="$2"; id="$3"; s="$4"; e="$5"
    ps="${6:-$(awk -v a="$s" -v b="$e" 'BEGIN { print (a + b) / 2 }')}"
    mkdir -p "$OUT"
    enc_webm "$OUT/$id.webm" -ss "$s" -to "$e" -i "$in"
    enc_mp4 "$OUT/$id.mp4" "$(mp4_kbps "$(awk -v a="$s" -v b="$e" 'BEGIN { print b - a }')")" -ss "$s" -to "$e" -i "$in"
    ffmpeg -nostdin -v error -y -ss "$ps" -i "$in" -frames:v 1 -vf "scale=min(960\,iw):-2" -q:v 4 "$OUT/$id-poster.jpg"
    check_size "$OUT/$id-poster.jpg"
    ;;
  mp4)
    [ $# -eq 3 ] || die "usage: mp4 <input> <id>"
    mkdir -p "$OUT"
    enc_mp4 "$OUT/$3.mp4" "$(mp4_kbps "$(duration "$2")")" -i "$2"
    ;;
  photo)
    [ $# -eq 3 ] || die "usage: photo <input> <name>"
    mkdir -p "$OUT"
    magick "$2" -auto-orient -strip -resize '1200x1200>' -quality 82 "$OUT/$3.jpg"
    check_size "$OUT/$3.jpg"
    ;;
  frames)
    [ $# -ge 3 ] || die "usage: frames <input> <out-dir> [start-s end-s]"
    in="$2"; dir="$3"; s="${4:-0}"; e="${5:-$(duration "$2")}"
    mkdir -p "$dir"
    for i in 1 2 3 4 5 6; do
      t=$(awk -v a="$s" -v b="$e" -v i="$i" 'BEGIN { print a + (i - 0.5) * (b - a) / 6 }')
      ffmpeg -nostdin -v error -y -ss "$t" -i "$in" -frames:v 1 -vf "scale=480:-2" -q:v 5 "$dir/frame-$i.jpg"
    done
    echo "$dir: 6 frames"
    ;;
  *)
    die "usage: video | mp4 | photo | frames (see the header of this file)"
    ;;
esac
