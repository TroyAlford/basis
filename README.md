# Project Overview

This monorepo provides a suite of development tools and utilities designed specifically for the Bun ecosystem.

## Workspaces

### [@basis/workspaces](./libraries/workspaces)
CLI tools and utilities for managing monorepo workspaces. Features include:
- Workspace discovery and management
- Dependency tracking
- Build system with license handling
- Change detection

### [@basis/eslint-plugin](./libraries/eslint-plugin)
Custom ESLint rules for maintaining code quality:
- Type import organization
- Object formatting rules
- Additional TypeScript-specific rules

### [@basis/bun-plugins](./libraries/bun-plugins)
Build plugins for the Bun runtime:
- SASS/SCSS compilation
- Global variable injection
- Asset handling

### [@basis/utilities](./libraries/utilities)
Common utility functions:
- Formatting helpers
- Type utilities
- Development tools

## Development

This project uses Bun for package management and building. To get started:

```bash
# Install dependencies
bun install

# Build all packages
bun ws build-all

# Run tests
bun test
```
