#!/usr/bin/env bash
# GymQuest — skopíruje appku do www/ pre Android (Capacitor). Web (GitHub Pages) sa nemení.
# Do appky patrí len to, čo beží v telefóne: stránka, skript, štýly, knižnice, písma, ikony,
# MP4 ukážky a obrázky. WebM kópie, service worker, testy a nástroje nie.
#   bash tools/android/build-www.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf www
mkdir -p www/media www/vendor www/fonts

cp index.html script.js style.css community-config.js manifest.json \
   icon-192.png icon-512.png apple-touch-icon.png www/
cp -r vendor/. www/vendor/
cp -r fonts/. www/fonts/
find media -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) \
  -exec cp {} www/media/ \;

echo "www/: $(du -sh www | cut -f1)"
