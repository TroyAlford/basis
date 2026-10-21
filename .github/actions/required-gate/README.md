# Required Gate

A portable composite action that turns a workflow's `needs` context into one trustworthy required status.

It exists because the common `contains(needs.*.result, 'failure')` check is not a gate: it treats `skipped`, `cancelled`, and missing work as success. That is harmless while a PR is a Draft, but it becomes a false green the moment a Draft is promoted.

## Semantics

Every dependency must satisfy one of these:

- the job ran in **this** workflow run and its result is `success`; or
- the job was `skipped`, and the exact-head impact decision records the suite as `needed: false` with a reason; or
- the job was `skipped` on an `edited` event, and the exact head SHA already has a completed, non-skipped `success` check run for the same job outside this run.

It fails on `failure`, `cancelled`, `timed_out`, a missing job result, a missing prior check, a `neutral` conclusion, absent or invalid impact evidence, a tampered decision hash, a needed suite that was skipped, or a check that never completes before the reuse timeout. Prior `skipped` results are ignored, so an earlier title-only pass can never stand in for a code run.

The head SHA is a required input. The action never asks "did this pass at some point"; it asks "did this job pass, or was it deliberately excluded, for this exact commit". Check runs from the current run are excluded by `details_url`, so a partially finished run cannot reuse itself.

## Impact evidence

The optional `impact-decision` input is the JSON produced by the [change-impact](../change-impact/README.md) preflight. When supplied, the gate validates:

- schema version `1`, a `suites` object, and a `changedFiles` array;
- `headSha` exactly equal to `head-sha`;
- a full commit `mergeBase` and a SHA-256 `policyHash`;
- a canonical decision hash equal to `impact-hash`.

A skipped suite is accepted without a prior check only when its decision entry is a boolean `needed: false` with a non-empty reason. A suite the decision marks as `needed: true` must have succeeded in this run, or be an `edited` event reusing a prior success on the same SHA. A failed job always fails, even if the decision says the suite was unaffected.

Set `require-impact: 'true'` for an impact-aware gate. The `impact` job must then be present in `needs` and must have succeeded; a skipped or failed preflight fails closed.

The preflight must read the policy from the merge base and run from a pinned action, not from pull-request code. The decision is evidence that the suite was deliberately excluded; it is not a forged success status.

## Usage

```yaml
required:
  name: Required
  if: ${{ always() && !github.event.pull_request.draft }}
  needs: [impact, quality, docs, test, integration, visual]
  runs-on: ubuntu-latest
  permissions:
    checks: read
    contents: read
  steps:
    - uses: TroyAlford/basis/.github/actions/required-gate@<released-tag>
      with:
        github-token: ${{ github.token }}
        needs: ${{ toJSON(needs) }}
        head-sha: ${{ github.event.pull_request.head.sha }}
        impact-decision: ${{ needs.impact.outputs.decision }}
        impact-hash: ${{ needs.impact.outputs.decision-hash }}
        event-action: ${{ github.event.action }}
        require-impact: 'true'
        # Only needed when a dependency sets `name:`.
        check-names: |
          {"quality":"Quality","docs":"Docs","test":"Test","integration":"Integration","visual":"Visual"}
```

Pin a released Basis tag; `main` is for Basis's own workflows.

## Inputs

- **github-token** (required): a token with `checks: read`.
- **needs** (required): `${{ toJSON(needs) }}`.
- **head-sha** (required): the exact commit to validate. For pull requests use `${{ github.event.pull_request.head.sha }}`.
- **check-names** (optional): JSON object mapping a job id to its check-run name. Defaults to the job id.
- **impact-decision** (optional): exact-head impact decision JSON.
- **impact-hash** (optional, required with a decision): canonical decision SHA-256.
- **event-action** (optional): `github.event.action`; only `edited` permits prior-check reuse.
- **require-impact** (optional, default `false`): require a decision and a successful `impact` dependency.
- **reuse-timeout-seconds** (optional, default `2400`): how long to wait for an in-flight check before failing a skipped job.
- **reuse-poll-seconds** (optional, default `15`): polling interval.

## Requirements and limits

- The calling job must declare every mandatory check in `needs`. The action cannot see a job it was not given; that job is absent, not skipped.
- The action cannot prove a decision was not fabricated by a compromised workflow. The practical boundary is: a pinned preflight action, a base-branch policy, and a `pull_request` workflow whose definition comes from the base branch. Never run this gate from `pull_request_target` over checked-out PR code.
- A decision must cover every dependency that skipped. A suite that ran successfully does not need a decision entry.
- The check-run name is the job id unless `check-names` maps it. For matrix jobs, each matrix value is a separate check-run name; map the names explicitly or do not skip the matrix job. Check names must be unique across workflows, because the lookup is by name on the head SHA.
- A renamed job changes its check-run name. Pass `check-names` or keep the job id as the check name, and update branch protection when the required context changes.
- The token needs `checks: read`. Reading check runs is enough; the action never writes statuses.
- The runner needs `bash`, `jq` and `sha256sum` on `PATH`. GitHub-hosted runners provide all three; a self-hosted runner must install them.
- The action is a reducer, not an event policy. The caller decides which events run the gate. Use it with a draft-gated workflow so a Draft event skips the gate rather than posting a green `Required` status.
- On a fork pull request the caller's token may be read-only. This action only reads checks, so that is sufficient.
- The reuse timeout is one overall deadline for all skipped jobs in the calling job, not a fresh timeout per job.

## Local tests

```bash
bun test ./.github/ci/required-gate.test.ts
```

The tests run the real `run.sh` against a fake `gh` on `PATH`, covering success, failure, cancellation, skip reuse, stale/neutral/missing results, current-run exclusion, name mapping, in-flight timeouts, intentional impact exclusion, needed-suite skips, head/hash tampering, malformed evidence, and a missing preflight.
