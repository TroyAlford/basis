# Knip Dead-Code Check

## Purpose

Runs [knip](https://knip.dev) dead-code analysis as a repository-level quality
check. Basis owns the knip version, the invocation, and a conservative default
config so consuming repositories do not each re-declare a knip dependency, a
version pin, or the CI wiring.

The check analyzes the whole repository (it is not diff-scoped). Repositories
that need a baseline for pre-existing findings can commit a `knip.json`, or pass
`config` explicitly. The action starts advisory-friendly: set
`fail-on-findings: 'false'` while a repository establishes its baseline, then
promote the check to required by leaving it at the default `true`.

## Inputs

- **config**: Path to a repository-specific knip config, relative to the working
  directory. Defaults to an existing repository config (`knip.json`,
  `knip.jsonc`, `knip.ts`, `knip.js`, `knip.config.ts`, `knip.config.js`), else
  the Basis default bundled with this action. (Optional)
- **args**: Additional space-separated arguments passed to knip. (Optional)
- **version**: knip version to run. Pinned by Basis. (Optional)
- **working-directory**: Directory to analyze, relative to the repository root.
  (Optional)
- **fail-on-findings**: When `true`, findings fail the job. Set `false` for an
  advisory rollout. (Optional, default `true`)

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
        uses: TroyAlford/basis/.github/actions/asdf-setup@v3.23.1

      - name: Knip dead-code check
        uses: TroyAlford/basis/.github/actions/knip@v3.23.1
        with:
          fail-on-findings: 'false' # advisory during rollout
```

Pin the action to a released Basis tag, as with the other Basis actions.

## Notes

- Requires `bun`/`bunx` on `PATH`; it does not add knip to the repository's
  dependencies.
- Uses knip's `knip-bun` binary so it runs without a system `node`.
- For a repository that must be reviewed against the shared dead-code policy
  rather than run as a CI gate, see the review-harness work tracked separately.
