import pluginStylistic from '@stylistic/eslint-plugin'
import pluginImportNewlines from 'eslint-plugin-import-newlines'
import pluginJSDoc from 'eslint-plugin-jsdoc'
import pluginPerfectionist from 'eslint-plugin-perfectionist'
import pluginImportSort from 'eslint-plugin-simple-import-sort'
import pluginSortDestructureKeys from 'eslint-plugin-sort-destructure-keys'
import pluginTypescript from 'typescript-eslint'
import pluginBasis from './rules'

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
  '@typescript-eslint': pluginTypescript.plugin,
  'perfectionist': pluginPerfectionist,
  'simple-import-sort': pluginImportSort,
  'sort-destructure-keys': pluginSortDestructureKeys,
}
