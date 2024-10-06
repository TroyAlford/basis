# GitHub Actions Overview

This directory contains a collection of reusable GitHub Actions designed to automate and streamline various workflows. These actions are built to be flexible and easily integrated into different projects, enhancing the efficiency of your development pipeline.

These actions are provided to create reusable pieces of a standard GitHub repository setup. They assume the following:

- **ASDF for Tooling Management**: You are using ASDF to manage core tooling versions such as npm, yarn, bun, python, etc. This allows for consistent environment setups across different development and CI environments.
  
- **Conventional Commits with Squash-and-Merge Strategy**: You are using the Conventional Commits specification, with a squash-and-merge strategy for pull requests. This means each merged PR results in a single squashed commit, with the PR title forming part of the commit message. This approach helps maintain a clean and understandable commit history. If you're not familiar with setting up this strategy in GitHub, you may want to configure your repository settings to enforce squash merging and ensure PR titles are formatted according to Conventional Commits.

## Available Actions

1. **ASDF Setup & Install**
   - Description: Sets up the ASDF version manager and installs necessary plugins and tools specified in the `.tool-versions` file. It also determines the package manager used in the project and caches dependencies.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/asdf-setup)

2. **Check Convco PR Title**
   - Description: Checks if the PR title follows the Conventional Commits specification.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/enforce-convco)

3. **Create Convco Release**
   - Description: Creates a new release based on Conventional Commits.
   - [More Details](https://github.com/TroyAlford/basis/tree/main/.github/actions/create-release)

## Usage

To use these actions in your workflows, reference them in your `.yml` files as shown in the individual action documentation.

## Contributing

Contributions are welcome! Please refer to the contribution guidelines in the main repository for more information.
