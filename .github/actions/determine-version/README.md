# Determine Version

## Purpose

This action analyzes conventional commits to determine if a new version is needed and what that version should be. It's designed to be used as a prerequisite step before creating releases or publishing packages, ensuring consistent versioning across all release-related tasks.

## Outputs

- **release-needed**: Whether a new release should be created (`true`/`false`)
- **current-version**: The current version from git tags (e.g. `v1.2.3`)
- **next-version**: The computed next version (same as current if no release needed)

## Requirements

The action is self-contained: it does **not** install a toolchain. Ensure `bun`
(>= 1.4) and `git` are on `PATH` first, and check out full history **and tags**
(`actions/checkout` with `fetch-depth: 0`). It only runs the copied TypeScript
with `bun`, so no `node_modules` are required.

## Usage Example
```yaml
jobs:
  check_version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      # Any Bun setup works; this action only needs `bun` on PATH.
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2

      - name: Determine Version
        id: version
        uses: TroyAlford/basis/.github/actions/determine-version@main

      # Use the outputs in subsequent steps
      - name: Use Version Info
        run: |
          echo "Release needed: ${{ steps.version.outputs.release-needed }}"
          echo "Current version: ${{ steps.version.outputs.current-version }}"
          echo "Next version: ${{ steps.version.outputs.next-version }}"
```

> **Self-reference vs. consumers.** The example above lives in Basis and uses
> `@main`, so it never lags the latest action. Repositories *consuming* Basis
> should pin a released tag (or a commit SHA) instead — or call the reusable
> [`release.yml`](../../workflows/release.yml) workflow, which the caller pins.

## Version Calculation Rules

Versions are calculated based on conventional commits since the last release:
- Major version bump (breaking changes):
  - Commits with `!` after the type
  - Commits containing "BREAKING CHANGE" in title or body
- Minor version bump:
  - `feat`: New features
  - `perf`: Performance improvements
- Patch version bump:
  - `fix`: Bug fixes
  - `refactor`: Code refactoring
  - `style`: Style changes
  - `revert`: Reverted changes
  - `chore`: Maintenance tasks

Other commit types (`docs`, `test`, `ci`, `build`) don't trigger version bumps. 
