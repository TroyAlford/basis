#!/usr/bin/env bash
#
# Reduce a workflow's `needs` results into one reliable required status.
#
# A job that ran in this workflow run must have succeeded. A job that was
# skipped is accepted only when one of these is true:
#
# - the exact-head impact decision records the suite as unaffected; or
# - this is an `edited` event and the exact head SHA already has a completed,
#   non-skipped successful check for the suite outside this run.
#
# Everything else fails closed: failure, cancellation, timeout, a missing check,
# a neutral conclusion, absent or tampered impact evidence, or a needed suite
# that was skipped. The gate never fakes check success.
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
IMPACT_DECISION="${IMPACT_DECISION:-}"
IMPACT_HASH="${IMPACT_HASH:-}"
EVENT_ACTION="${EVENT_ACTION:-}"
REQUIRE_IMPACT="${REQUIRE_IMPACT:-false}"

jq -e 'type == "object"' <<<"$NEEDS" >/dev/null || fail "NEEDS must be a JSON object"
[[ "$(jq 'length' <<<"$NEEDS")" -gt 0 ]] || fail "NEEDS must declare at least one job"
jq -e 'type == "object"' <<<"$CHECK_NAMES" >/dev/null || fail "CHECK_NAMES must be a JSON object"
[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || fail "HEAD_SHA must be a full commit SHA"
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || fail "RUN_ID must be numeric"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "REPO must be owner/name"
[[ "$REUSE_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || fail "REUSE_TIMEOUT_SECONDS must be an integer"
[[ "$REUSE_POLL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail "REUSE_POLL_SECONDS must be a number"
[[ "$REQUIRE_IMPACT" == "true" || "$REQUIRE_IMPACT" == "false" ]] || fail "REQUIRE_IMPACT must be true or false"

# A job that ran in this run must have succeeded. `skipped` is resolved below;
# every other conclusion fails immediately.
failed="$(jq -r 'to_entries[] | select(.value.result != "success" and .value.result != "skipped") | .key' <<<"$NEEDS")"
if [[ -n "$failed" ]]; then
  fail "required jobs did not pass: ${failed//$'\n'/, }"
fi

# Validate deliberately-omitted evidence before accepting any skip.
if [[ "$REQUIRE_IMPACT" == "true" ]]; then
  [[ -n "$IMPACT_DECISION" ]] || fail "an impact decision is required but missing"
  jq -e 'has("impact")' <<<"$NEEDS" >/dev/null || fail "the impact job must be a dependency of the required gate"
fi

if [[ -n "$IMPACT_DECISION" ]]; then
  jq -e '
    type == "object"
    and .version == 1
    and (.headSha | type == "string")
    and (.mergeBase | type == "string")
    and (.policyHash | type == "string")
    and (.suites | type == "object")
    and (.changedFiles | type == "array")
  ' <<<"$IMPACT_DECISION" >/dev/null || fail "impact decision has an invalid schema"

  decision_head="$(jq -r '.headSha' <<<"$IMPACT_DECISION")"
  [[ "$decision_head" == "$HEAD_SHA" ]] || fail "impact decision is for ${decision_head}, not ${HEAD_SHA}"
  jq -e '.mergeBase | test("^[0-9a-f]{40}([0-9a-f]{24})?$")' <<<"$IMPACT_DECISION" >/dev/null \
    || fail "impact decision has an invalid merge base"
  jq -e '.policyHash | test("^[0-9a-f]{64}$")' <<<"$IMPACT_DECISION" >/dev/null \
    || fail "impact decision has an invalid policy hash"
  [[ -n "$IMPACT_HASH" ]] || fail "impact hash is required with an impact decision"

  canonical="$(jq -S -c . <<<"$IMPACT_DECISION")"
  actual_hash="$(printf '%s' "$canonical" | sha256sum | cut -d' ' -f1)"
  [[ "$actual_hash" == "$IMPACT_HASH" ]] || fail "impact decision hash mismatch"
fi

# A suite entry must be a boolean with a non-empty reason. Sets `impact_needed`
# in the caller; the caller decides how to report an invalid entry.
impact_suite_needed() {
  local key="$1"
  jq -e --arg key "$key" '
    .suites[$key]
    | type == "object"
      and (.needed | type == "boolean")
      and (.reason | type == "string" and length > 0)
  ' <<<"$IMPACT_DECISION" >/dev/null || return 1
  impact_needed="$(jq -r --arg key "$key" '.suites[$key].needed' <<<"$IMPACT_DECISION")"
  return 0
}

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
while IFS=$'\t' read -r job result; do
  [[ -n "$job" ]] || continue

  if [[ "$job" == "impact" ]]; then
    [[ "$result" == "success" ]] || fail "impact job did not succeed (${result})"
    continue
  fi

  if [[ "$result" == "success" ]]; then
    continue
  fi

  # A valid exact-head impact decision can intentionally exclude a suite.
  if [[ -n "$IMPACT_DECISION" ]]; then
    impact_suite_needed "$job" || fail "impact decision has no valid entry for ${job}"
    if [[ "$impact_needed" == "false" ]]; then
      echo "${job}: intentionally excluded by the impact decision"
      continue
    fi
  fi

  # A title-only edit reuses the completed suite results for the same head SHA.
  if [[ "$EVENT_ACTION" == "edited" ]]; then
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
    continue
  fi

  if [[ -n "$IMPACT_DECISION" ]]; then
    fail "${job}: needed by the impact decision but was skipped"
  fi
  fail "${job}: skipped without an impact decision or an edited-event reuse"
done < <(jq -r 'to_entries[] | [.key, (.value.result // "missing")] | @tsv' <<<"$NEEDS")

echo "All required jobs passed, were intentionally excluded, or reused a successful check on ${HEAD_SHA}."
