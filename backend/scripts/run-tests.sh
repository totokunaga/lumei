#!/usr/bin/env sh
#
# Run the Go test suite with coverage, excluding the packages listed in
# test/excluded.txt. Invoked identically from the `test` service in
# docker-compose.tool.yml and the GitHub Actions test workflow.
#
# Environment variables:
#   TEST_FLAGS     Extra flags passed through to `go test` (e.g. "-run TestX").
#   EXCLUDE_FILE   Path to the exclusion list (default: test/excluded.txt).
#
# Must be run from the module root (where go.mod and test/excluded.txt live).
set -eu

EXCLUDE_FILE="${EXCLUDE_FILE:-./test/excluded.txt}"
TEST_FLAGS="${TEST_FLAGS:-}"

# Install gotestsum only when it is not already available, so CI images that
# pre-install it are not forced to reinstall on every run. `go install` drops
# the binary in $(go env GOPATH)/bin (falling back to $(go env GOBIN)); ensure
# that directory is on PATH so the invocation below resolves even when the
# image or developer shell hasn't already added it.
if ! command -v gotestsum >/dev/null 2>&1; then
  go install gotest.tools/gotestsum@v1.13.0
  GOBIN=$(go env GOBIN)
  PATH="${GOBIN:-$(go env GOPATH)/bin}:${PATH}"
fi

# Build the package list from `go list`, dropping any package whose import path
# contains a pattern from the exclude file. Comment (#) and blank lines are
# ignored. An empty pattern set means "exclude nothing" rather than the
# `grep -vF ""` footgun of excluding everything.
EXCLUDE_PATTERNS=""
if [ -f "${EXCLUDE_FILE}" ]; then
  EXCLUDE_PATTERNS=$(grep -v -e '^#' -e '^[[:space:]]*$' "${EXCLUDE_FILE}" || true)
fi

if [ -n "${EXCLUDE_PATTERNS}" ]; then
  ALL_PKGS=$(go list ./... | grep -vF "${EXCLUDE_PATTERNS}")
  # The complement: packages dropped from the run, reported as "skipped" below.
  SKIPPED_PKGS=$(go list ./... | grep -F "${EXCLUDE_PATTERNS}" || true)
else
  ALL_PKGS=$(go list ./...)
  SKIPPED_PKGS=""
fi

PACKAGES=$(echo "${ALL_PKGS}" | tr '\n' ' ')
COVERPKGS=$(echo "${ALL_PKGS}" | paste -sd, -)

# Run the tests. gotestsum is piped into sed, but POSIX sh has no `pipefail`,
# so the pipeline's exit status is sed's (always 0) — a test failure would be
# masked and `make test` would exit 0. Capture gotestsum's real status through
# a temp file, then bail out before the coverage report so failures propagate.
# `set +e` inside the group is required: the left side of the pipe runs in a
# subshell that inherits errexit, which would abort it on a gotestsum failure
# before the status is recorded. It is scoped to that subshell and does not
# leak to the rest of the script.
TEST_STATUS_FILE=$(mktemp)
trap 'rm -f "${TEST_STATUS_FILE}"' EXIT

# shellcheck disable=SC2086 # TEST_FLAGS is intentionally word-split into flags.
{ set +e; gotestsum --packages="${PACKAGES}" -- \
    ${TEST_FLAGS} \
    -timeout 10m \
    -cover -coverpkg="${COVERPKGS}" -coverprofile=coverage.out \
    -race -shuffle=on 2>&1; echo "$?" >"${TEST_STATUS_FILE}"; } |
  sed "s/(coverage: \([0-9.]*%\) of statements in .*)/(coverage: \1 of coverpkg)/"

TEST_EXIT=$(cat "${TEST_STATUS_FILE}")
if [ "${TEST_EXIT}" -ne 0 ]; then
  echo "Tests failed (gotestsum exit ${TEST_EXIT}); skipping coverage report." >&2
  exit "${TEST_EXIT}"
fi

# Report true per-package coverage from the merged profile.
#
# The gotestsum lines above show "of coverpkg" (each test's reach across ALL
# instrumented packages) because -coverpkg widens the denominator to the whole
# module. To recover each package's own coverage we aggregate coverage.out by
# package. Under -coverpkg every block appears once per test binary, so blocks
# are first deduplicated by taking the max hit count per file:range — the same
# "mode: set" merge `go tool cover` performs — before summing statements.
MODULE=$(go list -m)
TAB=$(printf '\t')
echo ""
echo "Coverage per package:"
{
  awk -F'[: ] *' -v module="${MODULE}" -v skipped="${SKIPPED_PKGS}" '
    NR == 1 { next }                      # skip the "mode:" header
    {
      key = $1 ":" $2                      # file:startline.col,endline.col
      stmts[key] = $(NF - 1)               # statement count for the block
      if ($NF > max[key]) max[key] = $NF   # merge duplicate blocks by max hits
      file[key] = $1
    }
    END {
      # Aggregate the per-file coverage into per-package coverage. The file path
      # is the import path of the package plus the file name, so drop the last
      # segment to get the package import path. The module prefix is stripped
      # from the package name for display, so the table is relative to the module.
      for (k in stmts) {
        path = file[k]
        n = split(path, seg, "/")
        pkg = seg[1]
        for (i = 2; i < n; i++) pkg = pkg "/" seg[i]   # drop the trailing file
        total[pkg] += stmts[k]
        if (max[k] > 0) covered[pkg] += stmts[k]
        gtotal += stmts[k]
        if (max[k] > 0) gcovered += stmts[k]
      }

      # Each row is emitted with three leading sort columns — group, coverage,
      # name — that cut strips before display. Group 0 = skipped, 1 = tested
      # packages (sorted by coverage ascending, then name), 2 = TOTAL, so
      # skipped packages appear first and TOTAL stays last.
      for (p in total) {
        short = p; sub("^" module "/?", "", short); if (short == "") short = "."
        cov = covered[p] / total[p] * 100
        printf "1\t%015.6f\t%s\t%6.1f%%\t%s\n", cov, short, cov, short
      }

      # Excluded packages carry no profile data; list them as skipped so the
      # table reflects the full module, not just the tested subset.
      ns = split(skipped, sk, "\n")
      for (i = 1; i <= ns; i++) {
        if (sk[i] == "") continue
        short = sk[i]; sub("^" module "/?", "", short); if (short == "") short = "."
        printf "0\t%015.6f\t%s\t%8s\t%s\n", 0, short, "∅", short
      }

      # Print a TOTAL row with the overall coverage percentage, which is the
      # sum of covered statements across all packages divided by the sum of
      # total statements across all packages. The sort order ensures this row
      # is last, so the table can be drawn with a separator above it.
      if (gtotal > 0) printf "2\t%015.6f\t%s\t%6.1f%%\tTOTAL\n", 100, "TOTAL", gcovered / gtotal * 100
    }
  ' coverage.out | sort -t"${TAB}" -k1,1n -k2,2n -k3,3 | cut -f4- |
    # Draw a rule before the TOTAL row (sort guarantees it is last), sized to
    # the widest line so the separator spans the whole table.
    awk '
      { rows[NR] = $0; if (length($0) > w) w = length($0) }
      END {
        sep = ""; for (i = 0; i < w; i++) sep = sep "-"
        for (i = 1; i <= NR; i++) {
          if (rows[i] ~ /\tTOTAL$/) print sep
          print rows[i]
        }
      }
    '
}
