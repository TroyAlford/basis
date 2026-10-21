# Required Gate

A portable composite action that turns a workflow's `needs` context into one trustworthy required status.

It exists because the common `contains(needs.*.result, 'failure')` check is not a gate: it treats `skipped`, `cancelled`, and missing work as success. That is harmless while a PR is a Draft, but it becomes a false green the moment a Draft is promoted.

## Semantics

The action passes only when one of these is true for every dependency:

- the job ran in **this** workflow run and its result is `success`; or
- the job was `skipped`, and the exact head SHA already has a completed, non-skipped `success` check run for the same job outside this run.

It fails on `failure`, `cancelled`, `timed_out`, a missing job result, a missing prior check, a `neutral` conclusion, or a check that never completes before the reuse timeout. Prior `skipped` results are ignored, so an earlier title-only pass can never stand in for a code run.

The head SHA is a required input. The action never asks "did this pass at some point"; it asks "did this job pass for this exact commit". Check runs from the current run are excluded by `details_url`, so a partially finished run cannot reuse itself.

## Usage

```yaml
required:
  name: Required
  if: ${{ always() && !github.event.pull_request.draft }}
  needs: [quality, test, visual]
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
        # Only needed when a dependency sets `name:`.
        check-names: |
          {"quality":"Quality","test":"Test","visual":"Visual"}
```

Pin a released Basis tag; `main` is for Basis's own workflows.

## Inputs

- **github-token** (required): a token with `checks: read`.
- **needs** (required): `${{ toJSON(needs) }}`.
- **head-sha** (required): the exact commit to validate. For pull requests use `${{ github.event.pull_request.head.sha }}`.
- **check-names** (optional): JSON object mapping a job id to its check-run name. Defaults to the job id.
- **reuse-timeout-seconds** (optional, default `2400`): how long to wait for an in-flight check before failing a skipped job.
- **reuse-poll-seconds** (optional, default `15`): polling interval.

## Requirements and limits

- The calling job must declare every mandatory check in `needs`. The action cannot see a job it was not given; that job is absent, not skipped.
- A skipped job is only safe when the caller deliberately skipped it and a prior success exists for the exact head SHA. A misconfigured `if` that skips a code job on a ready event can reuse an old success, so keep the caller's draft/title gates explicit and tested.
- The check-run name is the job id unless `check-names` maps it. For matrix jobs, each matrix value is a separate check-run name; map the names explicitly or do not skip the matrix job. Check names must be unique across workflows, because the lookup is by name on the head SHA.
- A renamed job changes its check-run name. Pass `check-names` or keep the job id as the check name, and update branch protection when the required context changes.
- The token needs `checks: read`. Reading check runs is enough; the action never writes statuses.
- The action is a reducer, not an event policy. The caller decides which events run the gate. Use it with a draft-gated workflow so a Draft event skips the gate rather than posting a green `Required` status.
- On a fork pull request the caller's token may be read-only. This action only reads checks, so that is sufficient.
- The reuse timeout is one overall deadline for all skipped jobs in the calling job, not a fresh timeout per job.

## Local tests

```bash
bun test .github/ci/required-gate.test.ts
```

The tests run the real `run.sh` against a fake `gh` on `PATH`, covering success, failure, cancellation, skip reuse, stale/neutral/missing results, current-run exclusion, name mapping, and in-flight timeouts.
