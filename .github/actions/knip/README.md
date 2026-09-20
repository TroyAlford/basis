# Knip Dead-Code Check

## Purpose

Runs [knip](https://knip.dev) dead-code analysis as a repository-level quality
check. Basis owns the knip version, the invocation, and a conservative default
config so consuming repositories do not each re-declare a knip dependency, a
version pin, or the CI wiring.

The check analyzes the whole repository (it is not diff-scoped). Repositories
that need a baseline for pre-existing findings can commit a knip config; the
action lets knip discover its own config rather than overriding it. The action
starts advisory-friendly: set `fail-on-findings: 'false'` while a repository
establishes its baseline, then promote the check to required by leaving it at
the default `true`.

## Inputs

- **config**: Path to a repository-specific knip config, relative to the working
  directory. When omitted, knip's own config discovery is used (see below).
  (Optional)
- **args**: Additional space-separated arguments passed to knip. (Optional)
- **version**: knip version to run. Pinned by Basis. (Optional)
- **working-directory**: Directory to analyze, relative to the repository root.
  (Optional)
- **fail-on-findings**: When `true`, findings fail the job. Set `false` for an
  advisory rollout. (Optional, default `true`)

## Config resolution

1. An explicit `config` input is always used.
2. Otherwise, if the repository has a config, it is left to knip's native
   discovery: `knip.json`, `knip.jsonc`, `knip.ts`, `knip.js`,
   `knip.config.ts`, `knip.config.js`, `.knip.json`, `.knip.jsonc`, or a `knip`
   field in `package.json`.
3. Otherwise the conservative Basis default bundled with this action is used
   (`ignoreExportsUsedInFile: true`).

## Exit behavior

- **Required mode** (`fail-on-findings: 'true'`, the default): knip's exit code
  is the job's exit code. Findings (exit 1) fail the job.
- **Advisory mode** (`fail-on-findings: 'false'`): the action passes knip's
  `--no-exit-code`, which suppresses the findings exit (1) but keeps a
  configuration/input/internal failure (exit 2) fatal. A broken knip invocation
  can therefore never masquerade as a clean advisory run.

## Usage

Run it after the toolchain is installed (for example with `asdf-setup`), which
provides `bun`/`bunx` on `PATH`:

```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up toolchain and install dependencies
        uses: TroyAlford/basis/.github/actions/asdf-setup@v3.24.0

      - name: Knip dead-code check
        uses: TroyAlford/basis/.github/actions/knip@v3.24.0
        with:
          fail-on-findings: 'false' # advisory during rollout
```

Pin the action to a released Basis tag, as with the other Basis actions.

## Self-test

The action logic lives in `run.sh`; `.github/actions/knip/test.sh` exercises that
same script directly (no test framework) and asserts:

- advisory + findings → success;
- required + findings → failure;
- advisory + broken config → failure (exit 2);
- `.knip.json` is respected;
- `package.json#knip` is respected.

Run it locally with `bash .github/actions/knip/test.sh`; Basis CI runs it as part
of the `knip` job.

## Notes

- Requires `bun`/`bunx` on `PATH`; it does not add knip to the repository's
  dependencies.
- Uses knip's `knip-bun` binary so it runs without a system `node`.
- For a repository that must be reviewed against the shared dead-code policy
  rather than run as a CI gate, see the review-harness work tracked separately.
