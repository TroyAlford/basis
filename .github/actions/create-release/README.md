# Create Release

## Purpose

This action creates a GitHub release with automatically generated release notes. It's designed to work in conjunction with the `determine-version` action, creating releases only when needed and with the correct version number.

## Inputs

- **github-token**: GitHub token for creating the release (Required)
- **version**: The version to release (Required)

## Requirements

The action is self-contained: it does **not** install a toolchain. `gh` is
preinstalled on GitHub-hosted runners, and the action runs in the checked-out
repository, so check the repository out first. The tag is created by
`gh release create` if it does not already exist.

## Usage Example
```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      # The action only needs `bun` and `git` on PATH; no dependencies.
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2

      # First determine if a release is needed
      - name: Determine Version
        id: version
        uses: TroyAlford/basis/.github/actions/determine-version@v4.0.0

      # Then create the release if needed
      - name: Create Release
        if: steps.version.outputs.release-needed == 'true'
        uses: TroyAlford/basis/.github/actions/create-release@v4.0.0
        with:
          github-token: ${{ github.token }}
          version: ${{ steps.version.outputs.next-version }}
```

## Release Notes

Release notes are automatically generated using GitHub's built-in release notes generation, which creates a changelog based on merged pull requests and their labels.

## Integration

This action is typically used as part of a release workflow, alongside:
- determine-version: To decide if a release is needed
- Package publishing actions: To publish updated packages after release
