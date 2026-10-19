import { createConfig } from './consumer/eslint'

export default createConfig({
  overrides: [
    { ignores: ['libraries/linter-css/syntax/**', 'tmp/**'] },
  ],
})
