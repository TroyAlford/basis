# GitHub Actions Overview

This directory contains a collection of reusable GitHub Actions designed to automate and streamline various workflows. These actions are built to be flexible and easily integrated into different projects, enhancing the efficiency of your development pipeline.

These actions are provided to create reusable pieces of a standard GitHub repository setup. They assume the following:

- **ASDF for Tooling Management**: You are using ASDF to manage core tooling versions such as npm, yarn, bun, python, etc. This allows for consistent environment setups across different development and CI environments.
  
- **Conventional Commits with Squash-and-Merge Strategy**: You are using the Conventional Commits specification, with a squash-and-merge strategy for pull requests. This means each merged PR results in a single squashed commit, with the PR title forming part of the commit message. This approach helps maintain a clean and understandable commit history. If you're not familiar with setting up this strategy in GitHub, you may want to configure your repository settings to enforce squash merging and ensure PR titles are formatted according to Conventional Commits.

## Available Actions

Every action here is **self-contained**: none references a sibling action with a
local `./` path (which would resolve against the *caller's* checkout). They can
therefore be referenced by full path from any repository:

```yaml
uses: TroyAlford/basis/.github/actions/<name>@<ref>
```

Actions that need a toolchain (for example `bun`) say so in their own README and
leave setup to the calling workflow.

1. **ASDF Setup & Install**
   - Description: Sets up the ASDF version manager and installs necessary plugins and tools specified in the `.tool-versions` file. It also determines the package manager used in the project and caches dependencies.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/asdf-setup)

2. **Check Convco PR Title**
   - Description: Checks if the PR title follows the Conventional Commits specification.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/enforce-convco)

3. **Determine Version**
   - Description: Computes the next semantic version from conventional commits since the last tag. Needs `bun` + `git` on PATH and full history.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/determine-version)

4. **Create Convco Release**
   - Description: Creates a GitHub release at the given version with generated notes. Needs `gh` (preinstalled on hosted runners).
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/create-release)

5. **Knip Dead-Code Check**
   - Description: Runs the Basis-owned knip dead-code analysis, using the shared version pin and default config instead of each repository declaring its own.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/knip)

## Usage

To use these actions in your workflows, reference them in your `.yml` files as shown in the individual action documentation.

## Contributing

Contributions are welcome! Please refer to the contribution guidelines in the main repository for more information.
