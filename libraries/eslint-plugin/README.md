# ESLint Plugin

## Overview

The `@basis/eslint-plugin` workspace provides a comprehensive set of ESLint rules designed to enforce a consistent coding style across your projects. This plugin is intended to be used as a base configuration that can be easily integrated into your projects by installing the `@basis/eslint-plugin` package via JSR. The rules focus on maintaining code quality, readability, and consistency, with an emphasis on modern JavaScript and TypeScript practices. This is a flat-config ESLint\@9+ configuration that is highly opinionated.

## Usage

`@basis/eslint-plugin` is internal. Consumers use the public `basis/eslint` surface, which resolves the plugin from source.

```js
// eslint.config.mjs
export { default } from 'basis/eslint'
```

Extend the shared policy through the factory rather than replacing it:

```js
import { createConfig } from 'basis/eslint'

export default createConfig({
  overrides: [
    { files: ['src/vendor/**'], rules: { 'no-console': 'off' } },
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
