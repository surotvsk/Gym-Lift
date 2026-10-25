#!/usr/bin/env bash
# GymQuest Android — všetky testy, ktoré bežia bez telefónu (headless Chrome + falošný Capacitor).
#   bash tests/android/run-all.sh
# Výsledok: riadok na test a celkový súčet; exit 1, ak niečo zlyhalo.
cd "$(dirname "$0")/../.."
fail=0
for f in tests/android/build-www.js tests/android/native-*.js; do
  line=$(node "$f" 2>&1 | tail -1)
  printf '%-36s %s\n' "$f" "$line"
  case "$line" in *" 0 failed"*) ;; *) fail=1 ;; esac
done
exit $fail
