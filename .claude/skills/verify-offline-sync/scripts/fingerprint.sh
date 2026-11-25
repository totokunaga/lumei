#!/usr/bin/env bash
# Prints "<path> <name> <sha256>" for every function in coverage.txt, hashing
# the function's text as it is in the working tree. A function runs from its
# `func <name>(` / `func (...) <name>(` (Go) or `const <name> =` (TS) line to
# the next line that starts in column 0 (a `}` there is included; a `)` that
# closes a Go signature doesn't end it). Fails if a function can't be found.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
status=0
while read -r path name; do
  case "$path" in ''|'#'*) continue ;; esac
  file="$repo/$path"
  text=$(awk -v name="$name" '
    BEGIN { go = "^func (\\([^)]*\\) )?" name "[[(]"; ts = "^(export )?const " name " = " }
    !inside && ($0 ~ go || $0 ~ ts) { inside = 1; print; next }
    inside && /^[^ \t)]/ { if ($0 ~ /^}/) print; exit }
    inside { print }
  ' "$file" 2>/dev/null || true)
  if [ -z "$text" ]; then
    echo "$path $name MISSING"
    status=1
    continue
  fi
  echo "$path $name $(printf '%s\n' "$text" | shasum -a 256 | cut -c1-16)"
done < "$here/coverage.txt"
exit "$status"
