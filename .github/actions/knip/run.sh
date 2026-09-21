#!/usr/bin/env bash
#
# Shared knip invocation used by the `knip` composite action and its self-test.
# Keeping the logic here (rather than inline in action.yml) lets `.github/actions/knip/test.sh`
# exercise the exact same code paths.
#
# Environment:
#   KNIP_VERSION            knip version to run (default: 6.37.0)
#   KNIP_CONFIG             explicit config path; empty means auto-discover
#   KNIP_ARGS               extra space-separated knip arguments
#   KNIP_FAIL_ON_FINDINGS   'true' (default) or 'false' for an advisory rollout
#   KNIP_ACTION_PATH        action directory; defaults to this script's directory

set -uo pipefail

KNIP_ACTION_PATH="${KNIP_ACTION_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
KNIP_VERSION="${KNIP_VERSION:-6.37.0}"
KNIP_CONFIG="${KNIP_CONFIG:-}"
KNIP_ARGS="${KNIP_ARGS:-}"
KNIP_FAIL_ON_FINDINGS="${KNIP_FAIL_ON_FINDINGS:-true}"

args=(--no-progress)

if [ -n "$KNIP_CONFIG" ]; then
  # An explicit config always wins.
  args+=(--config "$KNIP_CONFIG")
else
  # Leave an existing repository config to knip's own discovery: it knows every
  # supported location (`knip.json`, `knip.jsonc`, `knip.ts`, `knip.js`,
  # `knip.config.ts`, `knip.config.js`, `.knip.json`, `.knip.jsonc`, and
  # `package.json#knip`). Only fall back to the shared Basis default when the
  # repository has none, so passing `--config` never silently overrides a
  # legitimate repo config.
  repo_config=false
  for candidate in knip.json knip.jsonc knip.ts knip.js knip.config.ts knip.config.js .knip.json .knip.jsonc; do
    if [ -f "$candidate" ]; then
      repo_config=true
      break
    fi
  done
  if [ "$repo_config" != true ] && [ -f package.json ]; then
    if [ "$(bun -e 'console.log("knip" in require("./package.json"))' 2>/dev/null)" = 'true' ]; then
      repo_config=true
    fi
  fi
  if [ "$repo_config" != true ]; then
    args+=(--config "$KNIP_ACTION_PATH/knip.json")
  fi
fi

# Advisory mode suppresses the findings exit (1) with knip's own flag, while
# exit 2 (configuration/input/internal failure) stays fatal.
if [ "$KNIP_FAIL_ON_FINDINGS" != 'true' ]; then
  echo "::notice title=Basis knip::Advisory mode: findings are reported but will not fail this job."
  args+=(--no-exit-code)
fi

if [ -n "$KNIP_ARGS" ]; then
  # Deliberate word-splitting: `args` is a space-separated argument list.
  # shellcheck disable=SC2206
  extra=($KNIP_ARGS)
  args+=("${extra[@]}")
fi

echo "Running knip@${KNIP_VERSION}: knip-bun ${args[*]}"
bun x --package "knip@${KNIP_VERSION}" knip-bun "${args[@]}"
exit $?
