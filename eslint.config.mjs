import { createConfig } from './consumer/eslint'

export default createConfig({
  overrides: [
    { ignores: ['libraries/stylelint-plugin/syntax/**', 'tmp/**'] },
  ],
})
