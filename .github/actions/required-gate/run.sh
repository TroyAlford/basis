#!/usr/bin/env bash
#
# Reduce a workflow's `needs` results into one reliable required status.
#
# A job that ran in this workflow run must have succeeded. A job that was
# skipped (for example because this event only validated a title) may pass only
# by reusing a completed, non-skipped successful check on the exact head SHA,
# excluding the current run's own results. Everything else fails closed:
# failure, cancellation, timeout, a missing check, a neutral conclusion, or a
# check that never leaves the in-flight state.
#
# The check-run name is the job id unless CHECK_NAMES maps it to the job's
# `name:` value. Branch protection should require the calling job's name (for
# example `Required`), not each dependency.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

: "${NEEDS:?NEEDS is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${RUN_ID:?RUN_ID is required}"

REUSE_TIMEOUT_SECONDS="${REUSE_TIMEOUT_SECONDS:-2400}"
REUSE_POLL_SECONDS="${REUSE_POLL_SECONDS:-15}"
CHECK_NAMES="${CHECK_NAMES:-{\}}"

jq -e 'type == "object"' <<<"$NEEDS" >/dev/null || fail "NEEDS must be a JSON object"
[[ "$(jq 'length' <<<"$NEEDS")" -gt 0 ]] || fail "NEEDS must declare at least one job"
jq -e 'type == "object"' <<<"$CHECK_NAMES" >/dev/null || fail "CHECK_NAMES must be a JSON object"
[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || fail "HEAD_SHA must be a full commit SHA"
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || fail "RUN_ID must be numeric"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "REPO must be owner/name"
[[ "$REUSE_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || fail "REUSE_TIMEOUT_SECONDS must be an integer"
[[ "$REUSE_POLL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail "REUSE_POLL_SECONDS must be a number"

# A job that ran in this run must have succeeded. `skipped` is resolved below;
# every other conclusion fails immediately.
failed="$(jq -r 'to_entries[] | select(.value.result != "success" and .value.result != "skipped") | .key' <<<"$NEEDS")"
if [[ -n "$failed" ]]; then
  fail "required jobs did not pass: ${failed//$'\n'/, }"
fi

# Fetch every check run on the exact head SHA as one JSON array of pages.
check_runs_json() {
  gh api --paginate --slurp "repos/${REPO}/commits/${HEAD_SHA}/check-runs?per_page=100"
}

# Latest completed, non-skipped conclusion for a check name, excluding this run.
latest_conclusion() {
  local name="$1"
  check_runs_json \
    | jq -r --arg name "$name" --arg run_id "$RUN_ID" '
        [.[].check_runs[]
          | select(.name == $name)
          | select((((.details_url // "") | contains("/runs/" + $run_id + "/")) | not))
          | select(.status == "completed")
          | select(.conclusion != "skipped")]
        | sort_by(.completed_at)
        | last
        | .conclusion // "missing"'
}

# Number of in-flight checks for a name, excluding this run.
pending_count() {
  local name="$1"
  check_runs_json \
    | jq -r --arg name "$name" --arg run_id "$RUN_ID" '
        [.[].check_runs[]
          | select(.name == $name)
          | select((((.details_url // "") | contains("/runs/" + $run_id + "/")) | not))
          | select(.status != "completed")]
        | length'
}

deadline=$((SECONDS + REUSE_TIMEOUT_SECONDS))
while IFS= read -r job; do
  [[ -n "$job" ]] || continue
  check_name="$(jq -r --arg key "$job" '.[$key] // $key' <<<"$CHECK_NAMES")"
  [[ -n "$check_name" ]] || fail "no check name configured for ${job}"

  while [[ "$(pending_count "$check_name")" -gt 0 ]]; do
    if (( SECONDS >= deadline )); then
      fail "${job}: still in flight after ${REUSE_TIMEOUT_SECONDS}s; no completed check to reuse on ${HEAD_SHA}"
    fi
    echo "${job}: waiting for an in-flight ${check_name} check on ${HEAD_SHA}"
    sleep "$REUSE_POLL_SECONDS"
  done

  conclusion="$(latest_conclusion "$check_name")"
  case "$conclusion" in
    success)
      echo "${job}: reusing a successful ${check_name} check on ${HEAD_SHA}"
      ;;
    *)
      fail "${job}: no successful ${check_name} check on ${HEAD_SHA} (${conclusion})"
      ;;
  esac
done < <(jq -r 'to_entries[] | select(.value.result == "skipped") | .key' <<<"$NEEDS")

echo "All required jobs passed, or reused a successful check on ${HEAD_SHA}."
