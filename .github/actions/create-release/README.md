# Create Convco Release

## Purpose

This action automates the process of creating a new release based on Conventional Commits. It handles versioning and changelog generation, ensuring that releases are consistent and well-documented. This is particularly useful for maintaining a clear project history and facilitating smooth deployments.

## Inputs

- **github-token**: GitHub token for creating the release. (Required)

## Usage Example
```yaml
name: Create Release

on:
  push:
    branches:
      - main

jobs:
  create_release:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Create Release
      uses: TroyAlford/basis/.github/actions/create-release@main
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Versioning

Specify the versioning strategy for this action, if applicable.

## Contributing

If you want to contribute to this action, please follow the contribution guidelines in the main repository.
