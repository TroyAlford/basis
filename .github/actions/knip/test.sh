#!/usr/bin/env bash
#
# Lightweight self-test for the shared knip action logic (`run.sh`). Exercises
# the exit-code and config-discovery behaviors directly; no test framework.
#
# Usage: bash .github/actions/knip/test.sh

set -uo pipefail

ACTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$ACTION_DIR/../../.." && pwd)"
RUN="$ACTION_DIR/run.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

failures=0

pass() { printf 'ok - %s\n' "$1"; }
fail() {
  printf 'not ok - %s\n' "$1" >&2
  failures=$((failures + 1))
}

# A project knip reports: one referenced entry file and one unused file.
make_fixture() {
  local dir="$1"
  mkdir -p "$dir/src"
  # asdf/mise are directory-scoped. The fixtures live under a temp dir, so give
  # them the repository's tool pin; otherwise the `bun` shim fails with
  # "No version is set for command bun" when the test runs from a temp dir.
  if [ -f "$REPO_ROOT/.tool-versions" ]; then
    cp "$REPO_ROOT/.tool-versions" "$dir/.tool-versions"
  fi
  cat > "$dir/package.json" <<'JSON'
{ "name": "knip-selftest", "private": true, "type": "module", "main": "src/index.ts" }
JSON
  printf 'export const used = 1\n' > "$dir/src/index.ts"
  printf 'export const unused = 1\n' > "$dir/src/unused.ts"
}

# check <slug> <expected-exit> <dir> [ENV=VALUE ...]
check() {
  local slug="$1" expected="$2" dir="$3"
  shift 3
  ( cd "$dir" && env KNIP_ACTION_PATH="$ACTION_DIR" "$@" bash "$RUN" >"$WORKDIR/$slug.log" 2>&1 )
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass "$slug (exit $actual)"
  else
    fail "$slug (expected exit $expected, got $actual)"
    sed 's/^/    /' "$WORKDIR/$slug.log" >&2
  fi
}

make_fixture "$WORKDIR/plain"
check advisory-findings 0 "$WORKDIR/plain" KNIP_FAIL_ON_FINDINGS=false
check required-findings 1 "$WORKDIR/plain" KNIP_FAIL_ON_FINDINGS=true
check advisory-broken-config 2 "$WORKDIR/plain" \
  KNIP_FAIL_ON_FINDINGS=false KNIP_CONFIG="$WORKDIR/does-not-exist.json"

make_fixture "$WORKDIR/dot-knip"
printf '{ "ignore": ["src/unused.ts"] }\n' > "$WORKDIR/dot-knip/.knip.json"
check dot-knip-respected 0 "$WORKDIR/dot-knip" KNIP_FAIL_ON_FINDINGS=true

make_fixture "$WORKDIR/pkg-knip"
cat > "$WORKDIR/pkg-knip/package.json" <<'JSON'
{
  "name": "knip-selftest",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "knip": { "ignore": ["src/unused.ts"] }
}
JSON
check package-knip-respected 0 "$WORKDIR/pkg-knip" KNIP_FAIL_ON_FINDINGS=true

if [ "$failures" -ne 0 ]; then
  printf '\n%d knip action self-test case(s) failed\n' "$failures" >&2
  exit 1
fi

printf '\nAll knip action self-test cases passed\n'
