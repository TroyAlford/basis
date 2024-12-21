# Create Release

## Purpose

This action creates a GitHub release with automatically generated release notes. It's designed to work in conjunction with the `determine-version` action, creating releases only when needed and with the correct version number.

## Inputs

- **github-token**: GitHub token for creating the release (Required)
- **version**: The version to release (Required)

## Usage Example
```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      
      # First determine if a release is needed
      - name: Determine Version
        id: version
        uses: ./.github/actions/determine-version

      # Then create the release if needed
      - name: Create Release
        if: steps.version.outputs.release-needed == 'true'
        uses: ./.github/actions/create-release
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          version: ${{ steps.version.outputs.next-version }}
```

## Release Notes

Release notes are automatically generated using GitHub's built-in release notes generation, which creates a changelog based on merged pull requests and their labels.

## Integration

This action is typically used as part of a release workflow, alongside:
- determine-version: To decide if a release is needed
- Package publishing actions: To publish updated packages after release
