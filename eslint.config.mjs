import { createConfig } from './consumer/eslint'

export default [
  ...createConfig(),
  /*
   * Internal formatter helpers are documented by their types and signatures;
   * the public rule entry point and the formatter boundary carry full JSDoc.
   */
  {
    files: ['libraries/eslint-plugin/rules/sql/**'],
    rules: {
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
]
