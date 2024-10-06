# ASDF Setup & Install

## Purpose

This action sets up the ASDF version manager and installs the necessary plugins and tools specified in the `.tool-versions` file. It also determines the package manager used in the project and caches dependencies to speed up subsequent builds. This action is intended to replace tools like `setup-node` or `setup-bun`, allowing you to control the version of your core packages idiomatically within your repo.

## What is ASDF?

ASDF is a version manager that allows you to manage multiple runtime versions of various tools in a single place. It supports a wide range of plugins, enabling you to manage versions of programming languages, package managers, and other tools.

## Usage
```yaml
name: Setup and Install

on:
  push:
    branches:
      - main

jobs:
  setup_and_install:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v3

    - name: ASDF Setup & Install
      uses: TroyAlford/basis/.github/actions/asdf-setup@main
```

## Steps

1. **Checkout Code**: Uses the `actions/checkout` action to clone the repository.
2. **Setup ASDF**: Uses the `asdf-vm/actions/setup` action to set up ASDF.
3. **Install ASDF Plugins & Tools**: Installs plugins and tools listed in `.tool-versions`.
4. **Determine Package Manager**: Identifies the package manager and lock file used in the project.
5. **Cache Dependencies**: Caches the `node_modules` directory based on the lock file.
6. **Install Dependencies**: Installs project dependencies using the identified package manager.

## Notes

- If you want to use this action solely for CI, it will automatically handle your package manager setup.
- If you also use ASDF locally, you'll need a `.tool-versions` file specifying the tools you want to use. The action will honor those tool versions.
- The intent of this action is to replace tools like `setup-node` or `setup-bun` by delegating those responsibilities to ASDF, allowing you to control the version of your core packages idiomatically within your repo.
- It supports `npm`, `yarn`, and `bun` as package managers, defaulting to `npm` if none is specified.
