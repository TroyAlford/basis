import { createConfig } from './consumer/eslint'

export default [
  { ignores: ['**/.basis/**', 'libraries/linter-css/syntax/**', 'tmp/**'] },
  ...createConfig(),
  /*
   * Internal SQL formatter and lint helpers are documented by their signatures;
   * the public rule entry points carry their own JSDoc.
   */
  {
    files: [
      'libraries/linter-typescript/rules/sql/**',
      'libraries/linter-typescript/rules/sql*.ts',
    ],
    rules: {
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
]
