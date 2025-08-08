import type { BunPlugin } from 'bun'

export const pluginHMR = (): BunPlugin => ({
  name: 'plugin-hmr',
  setup(build) {
    build.onLoad({ filter: /[.][tj]sx?$/ }, async ({ path }) => ({
      contents: `if (import.meta.hot) import.meta.hot.accept();\n${await Bun.file(path).text()}`,
      loader: 'ts',
    }))
  },
})
