# Check Convco PR Title

## Purpose

This action checks if the PR title follows the Conventional Commits specification, ensuring consistency and clarity in commit messages. This helps maintain a clean and understandable commit history, which is crucial for effective collaboration and project management.

## Inputs

- **github-token**: GitHub token with permissions to comment on PRs. (Required)

## Usage Example
```yml
name: Check PR Title

on:
  pull_request:
    types: [opened, edited, reopened]

jobs:
  check_pr_title:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Check PR Title
      uses: TroyAlford/basis/.github/actions/enforce-convco@main
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
```

