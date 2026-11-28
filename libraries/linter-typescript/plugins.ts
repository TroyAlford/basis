import pluginStylistic from '@stylistic/eslint-plugin'
import type { ESLint } from 'eslint'
import pluginImportNewlines from 'eslint-plugin-import-newlines'
import pluginJSDoc from 'eslint-plugin-jsdoc'
import pluginImportSort from 'eslint-plugin-simple-import-sort'
import pluginSortDestructureKeys from 'eslint-plugin-sort-destructure-keys'
import pluginBasis from './rules/registry'

/**
 * The plugin registry shared by the full Basis ESLint policy and the focused
 * `basis compliance` configuration.
 *
 * Both entry points register the same plugins so inline `eslint-disable`
 * directives remain meaningful whichever policy runs. Only the enabled rule set
 * differs.
 */
export const plugins = {
  '@basis': pluginBasis,
  '@import-newlines': pluginImportNewlines,
  '@jsdoc': pluginJSDoc,
  '@stylistic': pluginStylistic,
  '@stylistic/js': pluginStylistic,
  '@stylistic/jsx': pluginStylistic,
  '@stylistic/ts': pluginStylistic,
  '@typescript-eslint': {} as ESLint.Plugin,
  'simple-import-sort': pluginImportSort,
  'sort-destructure-keys': pluginSortDestructureKeys,
}
