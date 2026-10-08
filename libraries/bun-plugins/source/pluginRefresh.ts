import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { BunPlugin, Loader } from 'bun'
import * as path from 'node:path'

/**
 * Bun's dev server only emits React Fast Refresh registrations for function
 * components, so class components (which is all of Basis) have no refresh
 * family and fall back to a full reload. This plugin registers every top-level
 * class with the React Refresh runtime Bun already drives, and marks the
 * module self-accepting so the update is applied in place.
 *
 * Style modules (`*.styles.ts`) export no classes; they are only marked
 * self-accepting, so an edit re-runs their `style()` call and reconciles the
 * stylesheet in place instead of bubbling to a component and reloading.
 *
 * `register` resolves to the same runtime Bun's client uses, so Bun's own
 * `performReactRefresh` applies the update; the plugin does not drive refresh.
 */
const REGISTER = 'register'
const RUNTIME = 'react-refresh/runtime'
const STYLE_MODULE = /\.styles\.[jt]sx?$/

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
 * Rewrite one module so Bun hot-updates it in place: register its top-level
 * class components with React Refresh and mark the module self-accepting.
 * @param source - The module source.
 * @param filePath - Absolute path to the module.
 * @param cwd - Working directory used to derive stable component ids.
 * @returns The rewritten module, or `null` when it needs no changes.
 */
export function transformModule(
  source: string,
  filePath: string,
  cwd: string,
): { contents: string, loader: Loader } | null {
  const names = classNames(source)
  const isStyle = STYLE_MODULE.test(filePath)
  if (names.length === 0 && !isStyle) return null

  const lines: string[] = []
  if (names.length > 0) lines.push(`import { ${REGISTER} } from ${JSON.stringify(RUNTIME)};`)
  lines.push(source)

  if (names.length > 0) {
    const id = path.relative(cwd, filePath).split(path.sep).join('/')
    lines.push(`\nif (typeof ${REGISTER} === 'function') {`)
    lines.push(...names.map(name => `  ${REGISTER}(${name}, ${JSON.stringify(`${id}:${name}`)});`))
    lines.push('}')
  }

  lines.push('if (import.meta.hot) import.meta.hot.accept();')

  return {
    contents: lines.join('\n'),
    loader: LOADER_BY_EXTENSION[path.extname(filePath).slice(1)] ?? 'js',
  }
}

/**
 * A Bun plugin that adds class-component React Fast Refresh registration and
 * self-accepting style modules.
 * @returns The plugin.
 */
export const pluginRefresh = (): BunPlugin => ({
  name: 'basis-refresh',
  setup(build) {
    if (build.config.target !== 'browser') return
    /*
     * React Fast Refresh is development-only. Bun's HTML bundler exposes no
     * development flag on the build config, so key on NODE_ENV: a production
     * bundle must never include the refresh runtime — it throws on import.
     */
    if (process.env.NODE_ENV === 'production') return

    build.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
      if (args.path.includes('node_modules') || /\.d\.[jt]s$/.test(args.path)) return undefined

      const source = await Bun.file(args.path).text()
      return transformModule(source, args.path, process.cwd()) ?? undefined
    })
  },
})
