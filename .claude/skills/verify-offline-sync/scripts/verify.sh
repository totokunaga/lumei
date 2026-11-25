#!/usr/bin/env bash
# Model-checks Lumei's offline sync (model/LumeiSync.tla) with TLC.
#
#   verify.sh                 check the code's fingerprints, then every run
#   verify.sh --mutants       also prove each property can fail (model mutants)
#   verify.sh --update-lock   record the current fingerprints as confirmed
#
# Exit codes: 0 all as expected; 1 a property broke that isn't a known
# finding, or TLC failed; 2 a known finding no longer reproduces (update the
# skill); 3 the model passed but covered code changed since coverage.lock.
set -euo pipefail

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar"

here=$(cd "$(dirname "$0")" && pwd)
skill=$(dirname "$here")
spec="$skill/model/LumeiSync.tla"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/lumei-formal"
jar="$cache/tla2tools-${TLA_VERSION}.jar"

mode=check
case "${1:-}" in
  --mutants) mode=mutants ;;
  --update-lock) mode=lock ;;
  '') ;;
  *) echo "usage: $0 [--mutants | --update-lock]" >&2; exit 64 ;;
esac

if [ "$mode" = lock ]; then
  "$here/fingerprint.sh" > "$here/coverage.lock"
  echo "Recorded $(wc -l < "$here/coverage.lock" | tr -d ' ') fingerprints in $here/coverage.lock"
  exit 0
fi

command -v java > /dev/null || { echo "Java 11 or later is needed (e.g. brew install --cask temurin)." >&2; exit 1; }
if [ ! -f "$jar" ]; then
  mkdir -p "$cache"
  echo "Fetching TLA+ tools v$TLA_VERSION into $cache"
  curl -fsSL -o "$jar.part" "$TLA_URL"
  mv "$jar.part" "$jar"
fi
echo "$TLA_SHA256  $jar" | shasum -a 256 -c --status || { echo "Checksum mismatch: $jar" >&2; exit 1; }

tmp=${TMPDIR:-/tmp}; out=$(mktemp -d "${tmp%/}/lumei-sync-tlc.XXXXXX")
echo "TLC output: $out"

# --- 1. Has the covered code changed since the model was last confirmed? ---
drift=0
"$here/fingerprint.sh" > "$out/fingerprints" || true
if ! diff -q "$here/coverage.lock" "$out/fingerprints" > /dev/null; then
  drift=1
  echo
  echo "DRIFT: covered code changed since coverage.lock (old -> new):"
  diff "$here/coverage.lock" "$out/fingerprints" | sed -n 's/^[<>] /  /p' || true
  echo "  Compare each changed function with the model before trusting a pass."
fi

# --- 2. Runs. Each: name|seed categories|pull reads one snapshot|invariants|properties|expect ---
# Scenario "edit": two default categories (c1, c2) and one expense (e1).
# Scenario "create": one default category (c1); c2 can be created.
COMMON_INV="TypeOK UsedCategoryKept SyncedRowsExist NoChangeLost"
COMMON_PROP="ExpenseDeletionWins DeletionHonored"
runs=(
  "as-coded/edit|{\"c1\", \"c2\"}|FALSE|$COMMON_INV|$COMMON_PROP|pass"
  "as-coded/create|{\"c1\"}|FALSE|$COMMON_INV|$COMMON_PROP|pass"
  "one-snapshot-pull/edit|{\"c1\", \"c2\"}|TRUE|$COMMON_INV Converged|$COMMON_PROP|pass"
  "one-snapshot-pull/create|{\"c1\"}|TRUE|$COMMON_INV Converged|$COMMON_PROP|pass"
  "F1 pull skips a change|{\"c1\"}|FALSE|Converged||Converged"
  "F2 deleted category comes back active|{\"c1\", \"c2\"}|FALSE||CategoryDeletionUndoneOnlyForExpense|CategoryDeletionUndoneOnlyForExpense"
)

# write_cfg FILE SEEDS PULL INVARIANTS PROPERTIES
write_cfg() {
  {
    echo "CONSTANTS"
    echo "    Devices = {d1, d2}"
    echo "    Cats = {\"c1\", \"c2\"}"
    echo "    Exps = {\"e1\"}"
    echo "    SeedCats = $2"
    echo "    MaxClock = 4"
    echo "    MaxSeq = 6"
    echo "    PullOneSnapshot = $3"
    echo "SPECIFICATION Spec"
    echo "CONSTRAINT StateBound"
    echo "SYMMETRY DeviceSymmetry"
    echo "CHECK_DEADLOCK FALSE"
    if [ -n "$4" ]; then echo "INVARIANTS $4"; fi
    if [ -n "$5" ]; then echo "PROPERTIES $5"; fi
  } > "$1"
}

# tlc DIR: runs TLC on DIR/LumeiSync.tla with DIR/run.cfg, from DIR (TLC
# misreads a config path outside the spec's folder), logging to DIR/tlc.out.
# Prints "pass", "violated <name>", or "error".
tlc() {
  local dir=$1 log=$1/tlc.out
  (cd "$dir" && java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto \
    -metadir "$dir/states" -config run.cfg LumeiSync.tla > "$log" 2>&1) || true
  if grep -q "^Model checking completed. No error has been found." "$log"; then
    echo pass
  elif v=$(grep -oE "^Error: (Invariant|Action property|Temporal properties) [A-Za-z]* ?(is )?violated" "$log" | head -1); [ -n "$v" ]; then
    echo "violated $(echo "$v" | awk '{print $(NF-2)}')"
  else
    echo error
  fi
}

# steps LOG: the TLC action names of the counterexample, in order.
steps() { grep -oE "^State [0-9]+: <[A-Za-z]+" "$1" | sed 's/.*<//' | paste -sd' ' -; }

status=0
i=0
for run in "${runs[@]}"; do
  IFS='|' read -r name seeds pull inv prop expect <<< "$run"
  i=$((i + 1))
  dir="$out/run$i"; log="$dir/tlc.out"
  mkdir -p "$dir"; cp "$spec" "$dir/LumeiSync.tla"
  write_cfg "$dir/run.cfg" "$seeds" "$pull" "$inv" "$prop"
  result=$(tlc "$dir")
  states=$(grep -oE "[0-9,]+ distinct states found" "$log" | tail -1 || true)
  if [ "$expect" = pass ] && [ "$result" = pass ]; then
    echo "PASS     $name ($states)"
  elif [ "$expect" != pass ] && [ "$result" = "violated $expect" ]; then
    echo "KNOWN    $name: $expect breaks, as recorded in SKILL.md"
    echo "         steps: $(steps "$log")"
    echo "         trace: $log"
  elif [ "$expect" != pass ] && [ "$result" = pass ]; then
    echo "FIXED?   $name: $expect no longer breaks. Confirm the fix, then update SKILL.md and verify.sh."
    if [ "$status" -eq 0 ]; then status=2; fi
  else
    echo "FAIL     $name: $result"
    if [ "$result" != error ]; then echo "         steps: $(steps "$log")"; fi
    echo "         trace: $log"
    status=1
  fi
done

# --- 3. Mutants: each breaks the model the way a code change could, and
# must be caught. Each runs with the one-snapshot pull, so F1 can't hide it.
# Each: name|sed expression on LumeiSync.tla|seed categories|property ---
if [ "$mode" = mutants ]; then
  mutants=(
    "reviveCategory removed|s/IN  ReviveCategory(S1, r, row)/IN  S1/|{\"c1\", \"c2\"}|UsedCategoryKept"
    "keepUsedCategory removed|s/Save(S, r, KeepUsedCategory(S, r, row))/Save(S, r, row)/|{\"c1\", \"c2\"}|UsedCategoryKept"
    "Wins ignores a stored deletion|s/IF st.del THEN FALSE/IF FALSE THEN FALSE/|{\"c1\", \"c2\"}|ExpenseDeletionWins"
    "push answer ignores local_rev|s/sent\[d\]\[r\] # 0 \/\\\\ sent\[d\]\[r\] = rev\[d\]\[r\]/sent[d][r] # 0/|{\"c1\", \"c2\"}|NoChangeLost"
    "pull overwrites pending rows|s/^Keep(d, r) == .*/Keep(d, r) == FALSE/|{\"c1\", \"c2\"}|NoChangeLost"
    "API drops the push but answers|s/srv' = ApplyAll(srv, d, ApplyOrder(d, Outgoing(d)))/srv' = srv/|{\"c1\"}|SyncedRowsExist"
    "applyOrder removed|s/Sorted(d, R \\\\ dels) \\\\o Sorted(d, dels)/Sorted(d, R)/|{\"c1\", \"c2\"}|DeletionHonored"
  )
  echo
  echo "Mutants (each must be caught):"
  j=0
  for m in "${mutants[@]}"; do
    IFS='|' read -r name expr seeds want <<< "$m"
    j=$((j + 1))
    dir="$out/mutant$j"; mkdir -p "$dir"
    sed "$expr" "$spec" > "$dir/LumeiSync.tla"
    if cmp -s "$spec" "$dir/LumeiSync.tla"; then
      echo "STALE    $name: the sed no longer matches the model; update it"
      status=1
      continue
    fi
    # Check only the property the mutant targets, so each property is shown
    # to fail on its own.
    case "$want" in
      ExpenseDeletionWins|DeletionHonored) write_cfg "$dir/run.cfg" "$seeds" TRUE "" "$want" ;;
      *) write_cfg "$dir/run.cfg" "$seeds" TRUE "$want" "" ;;
    esac
    result=$(tlc "$dir")
    if [ "$result" = "violated $want" ]; then
      echo "CAUGHT   $name -> $want"
    else
      echo "MISSED   $name: expected $want, got $result ($dir/tlc.out)"
      status=1
    fi
  done
fi

if [ "$status" -eq 0 ] && [ "$drift" -eq 1 ]; then
  status=3
fi
echo
case "$status" in
  0) echo "OK: every run as expected." ;;
  1) echo "BROKEN: see FAIL/MISSED above. Read the trace with /statechart." ;;
  2) echo "CHANGED: a known finding no longer reproduces." ;;
  3) echo "DRIFT: the model passed, but covered code changed; confirm the model still matches it." ;;
esac
exit "$status"
