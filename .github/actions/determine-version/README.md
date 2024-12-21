# Determine Version

## Purpose

This action analyzes conventional commits to determine if a new version is needed and what that version should be. It's designed to be used as a prerequisite step before creating releases or publishing packages, ensuring consistent versioning across all release-related tasks.

## Outputs

- **release-needed**: Whether a new release should be created (`true`/`false`)
- **current-version**: The current version from git tags (e.g. `v1.2.3`)
- **next-version**: The computed next version (same as current if no release needed)

## Usage Example
```yaml
jobs:
  check_version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Determine Version
        id: version
        uses: ./.github/actions/determine-version

      # Use the outputs in subsequent steps
      - name: Use Version Info
        run: |
          echo "Release needed: ${{ steps.version.outputs.release-needed }}"
          echo "Current version: ${{ steps.version.outputs.current-version }}"
          echo "Next version: ${{ steps.version.outputs.next-version }}"
```

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
