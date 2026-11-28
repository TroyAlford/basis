# TypeScript linter

## Overview

The TypeScript linter provides a comprehensive set of rules designed to enforce a consistent coding style across your projects. This plugin is an internal workspace, consumed through the Basis repository as `basis/eslint`; it is not published as a standalone package. The rules focus on maintaining code quality, readability, and consistency, with an emphasis on modern JavaScript and TypeScript practices. This is a flat-config ESLint\@9+ configuration that is highly opinionated.

## Installation

The plugin is an internal workspace. Consumers use `basis/eslint` from the Basis repository pinned to a Git tag; there is no standalone package install and no package publish step.

The plugin ships as TypeScript source; there is no separate JavaScript build.

## Usage

Create a root-level `eslint.config.mjs` that re-exports the Basis policy:

```ts
import basis from 'basis/eslint'

export default basis
```

To customize the policy, use the `createConfig` factory:

```ts
import { createConfig } from 'basis/eslint'

export default createConfig({
  overrides: [
    {
      rules: {
        'no-console': 'warn',
        'quotes': ['error', 'double'],
        'semi': ['error', 'always'],
      },
    },
  ],
})
```

## Style and Rules

The plugin enforces a solid set of base rules that emphasize:

- **Consistency**: Ensures consistent use of syntax and formatting across the codebase.
- **Readability**: Promotes code that is easy to read and understand.
- **Modern Practices**: Encourages the use of modern JavaScript and TypeScript features.
- **Basis architecture**: `@basis/component-architecture` requires application components to extend the Basis `Component` or `Editor` hierarchy, and rejects React hooks, function component types and wrappers, JSX-used functions, and bare `React.Component` subclasses. The same rule backs `basis compliance`.

For a detailed list of all the rules and their configurations, refer to the source code in the [index.ts](./index.ts).

This setup allows you to maintain a high standard of code quality while providing the flexibility to adapt the rules to your specific project requirements.

## Ignored Directories

This ESLint configuration automatically ignores files in the following directories:

- `node_modules`
- `.cache`
- `build`
- `dist`

This includes any such directories nested inside monorepo workspaces, ensuring that ESLint does not process files that are typically generated or external dependencies.
