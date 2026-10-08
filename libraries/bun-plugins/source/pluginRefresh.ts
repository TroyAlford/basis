import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { BunPlugin, Loader } from 'bun'
import * as path from 'node:path'

/**
 * Bun's dev server only emits React Fast Refresh registrations for function
 * components, so class components (which is all of Basis) have no refresh
 * family and fall back to a full reload. This plugin registers every class
 * with the React Refresh runtime Bun already drives, and marks the module
 * self-accepting so the update is applied in place.
 *
 * `register` resolves to the same runtime Bun's client uses, so Bun's own
 * `performReactRefresh` applies the update; the plugin does not drive refresh.
 */
const REGISTER = 'register'
const RUNTIME = 'react-refresh/runtime'

const LOADER_BY_EXTENSION: Record<string, Loader> = {
  js: 'js',
  jsx: 'jsx',
  ts: 'ts',
  tsx: 'tsx',
}

/**
 * The names of every **top-level** named class declaration in a module, in
 * source order. Nested classes and class expressions are skipped: they are not
 * module-scope bindings, so a registration statement at module scope could not
 * reference them.
 * @param source - The module source.
 * @returns The class names.
 */
export function classNames(source: string): string[] {
  const names: string[] = []
  const ast = parse(source, {
    plugins: ['jsx', 'typescript'],
    sourceType: 'module',
  })

  traverse(ast, {
    ClassDeclaration(nodePath) {
      const { node, parentPath } = nodePath
      if (!node.id) return
      const atProgramScope = parentPath?.isProgram()
        || ((parentPath?.isExportNamedDeclaration() || parentPath?.isExportDefaultDeclaration())
          && parentPath.parentPath?.isProgram())
      if (atProgramScope) names.push(node.id.name)
    },
  })

  return names
}

/**
 * A Bun plugin that adds class-component React Fast Refresh registration.
 * @returns The plugin.
 */
export const pluginRefresh = (): BunPlugin => ({
  name: 'basis-refresh',
  setup(build) {
    if (build.config.target !== 'browser') return

    build.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
      if (args.path.includes('node_modules') || /\.d\.[jt]s$/.test(args.path)) return undefined

      const source = await Bun.file(args.path).text()
      const names = classNames(source)
      if (names.length === 0) return undefined

      const id = path.relative(process.cwd(), args.path).split(path.sep).join('/')
      const registrations = names
        .map(name => `  ${REGISTER}(${name}, ${JSON.stringify(`${id}:${name}`)});`)
        .join('\n')

      const contents = [
        `import { ${REGISTER} } from ${JSON.stringify(RUNTIME)};`,
        source,
        `\nif (typeof ${REGISTER} === 'function') {`,
        registrations,
        '}',
        'if (import.meta.hot) import.meta.hot.accept();',
      ].join('\n')

      return { contents, loader: LOADER_BY_EXTENSION[path.extname(args.path).slice(1)] ?? 'js' }
    })
  },
})
