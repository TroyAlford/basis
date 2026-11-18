import { createConfig } from './consumer/eslint'

export default [
  { ignores: ['**/.basis/**'] },
  ...createConfig(),
  /*
   * Internal SQL formatter and lint helpers are documented by their signatures;
   * the public rule entry points carry their own JSDoc.
   */
  {
    files: [
      'libraries/eslint-plugin/rules/sql/**',
      'libraries/eslint-plugin/rules/sql*.ts',
    ],
    rules: {
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
]
