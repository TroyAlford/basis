# ESLint Plugin

## Overview

The `eslint-plugin` workspace provides a comprehensive set of ESLint rules designed to enforce a consistent coding style across your projects. This plugin is intended to be used as a base configuration that can be easily integrated into your projects by installing the `TroyAlford/basis` package at a specific tagged version. The rules focus on maintaining code quality, readability, and consistency, with an emphasis on modern JavaScript and TypeScript practices.

## Usage

To use this ESLint plugin in your project, follow these steps:

1. **Install the Plugin**: Add `TroyAlford/basis` to your project's dependencies at a specific tagged version.

   ```bash
   npm install TroyAlford/basis@<tag>
   ```

2. **Create a Root-Level ESLint Configuration**: In your project's root directory, create a file named `eslint.config.mjs` that references the plugin.

   ```javascript
   import eslintPlugin from './node_modules/TroyAlford/basis/libraries/eslint-plugin/dist/index.mjs'

   export default eslintPlugin
   ```

3. **Customize the Configuration**: You can override the base rules provided by the plugin to suit your project's specific needs. Here's an example of how to extend and customize the configuration:

   ```javascript
   import eslintPlugin from './node_modules/TroyAlford/basis/libraries/eslint-plugin/dist/index.mjs'

   export default {
     ...eslintPlugin,
     rules: {
       ...eslintPlugin.rules,
       'no-console': 'warn', // Override the rule to allow console statements with a warning
       'quotes': ['error', 'double'], // Change the quotes rule to enforce double quotes
       'semi': ['error', 'always'], // Enforce the use of semicolons
     },
   }
   ```

## Style and Rules

The plugin enforces a solid set of base rules that emphasize:

- **Consistency**: Ensures consistent use of syntax and formatting across the codebase.
- **Readability**: Promotes code that is easy to read and understand.
- **Modern Practices**: Encourages the use of modern JavaScript and TypeScript features.

For a detailed list of all the rules and their configurations, refer to the source code in the [index.ts](./index.ts).

This setup allows you to maintain a high standard of code quality while providing the flexibility to adapt the rules to your specific project requirements.
