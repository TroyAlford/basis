# Project Overview

This monorepo is designed to provide a comprehensive suite of tools and components for developing React and TypeScript (TSX) applications. The focus is on lightweight, efficient solutions that integrate seamlessly within the Bun ecosystem, avoiding the need for heavy or expensive packages.

## Workspaces

### [React Components](https://github.com/TroyAlford/basis/tree/main/libraries/react)

This workspace includes a collection of class-based React components that serve as building blocks for creating user interfaces. These components are designed to be flexible and reusable, providing a solid foundation for application development.

### [Server](https://github.com/TroyAlford/basis/tree/main/libraries/server)

The server workspace offers a robust server-side solution using Bun. It supports API handling, asset management, and server-side rendering, making it easy to build and deploy scalable web applications.

### [Git Utilities](https://github.com/TroyAlford/basis/tree/main/libraries/github)

This workspace provides tools for interacting with Git repositories, including operations like cloning, pulling, committing, and pushing changes. It simplifies version control management within your projects.

### [Utilities](https://github.com/TroyAlford/basis/tree/main/libraries/utilities)

A set of utility functions that address common development needs, such as data manipulation, URI parsing, and class name management. These utilities are designed to enhance productivity and code quality.

### [GitHub Actions](https://github.com/TroyAlford/basis/tree/main/.github)

Under the `.github` directory, this repository provides a set of reusable GitHub Actions designed to automate common workflows. These actions can be used to streamline CI/CD processes, automate testing, and manage deployments. They are built to be flexible and easily integrated into various projects, enhancing the efficiency of your development pipeline.

#### Usage Example

To use these GitHub Actions in your own repository, you can reference them in your workflow files. Here's an example of how you might set up a workflow to use one of these actions:
