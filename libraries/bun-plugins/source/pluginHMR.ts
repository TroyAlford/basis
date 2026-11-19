import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { BunPlugin, JavaScriptLoader } from 'bun'
import * as path from 'node:path'

/**
 * Production HMR plugin for Basis applications.
 *
 * React Fast Refresh is development-only: the production `react-refresh` entry
 * throws on import, and production React does not expose the internals refresh
 * needs. Bun still enables HMR for the HTML route, so this plugin takes over the
 * client transform in production:
 *
 * - JSX is compiled to the production `react/jsx-runtime` before Bun sees it, so
 *   Bun does not inject `jsxDEV` or React Refresh.
 * - Top-level class components are registered under stable ids so a module
 *   replacement keeps the component type (and mounted instance state).
 * - Style modules and component modules self-accept; every other module falls
 *   back to Bun's full reload.
 */
const REGISTER = '__basisHMRRegister'
const RUNTIME = 'basis/react/hmr'
const STYLE_MODULE = /\.styles\.[jt]sx?$/

const LOADER_BY_EXTENSION: Record<string, JavaScriptLoader> = {
  js: 'js',
  jsx: 'jsx',
  ts: 'ts',
  tsx: 'tsx',
}

/** A source edit positioned by absolute offsets. */
interface Edit {
  /** End offset. */
  readonly end: number,
  /** Start offset. */
  readonly start: number,
  /** The replacement text. */
  readonly text: string,
}

/** A transpiler per loader, reused across modules. */
const transpilers = new Map<JavaScriptLoader, Bun.Transpiler>()

/**
 * The Bun transpiler for one loader, configured for the production React JSX
 * runtime without importing Bun's development-only refresh transform.
 * @param loader - The source loader.
 * @returns The cached transpiler.
 */
function transpilerFor(loader: JavaScriptLoader): Bun.Transpiler {
  const cached = transpilers.get(loader)
  if (cached) return cached

  const transpiler = new Bun.Transpiler({
    autoImportJSX: true,
    loader,
    tsconfig: {
      compilerOptions: {
        jsx: 'react-jsx',
        jsxImportSource: 'react',
      },
    },
  })
  transpilers.set(loader, transpiler)
  return transpiler
}

/**
 * The registration statements inserted after one class declaration.
 * @param name - The class binding name.
 * @param id - The stable component id.
 * @param unstable - Whether the class declares runtime-private members.
 * @returns The source text for the registration boundary.
 */
function registrationSource(name: string, id: string, unstable: boolean): string {
  return [
    `\n${name} = ${REGISTER}(${JSON.stringify(id)}, ${name}${unstable ? ', true' : ''});`,
    `\nif (${name}.displayName == null) ${name}.displayName = ${JSON.stringify(name)};`,
  ].join('')
}

/**
 * Apply non-overlapping source edits from the end backwards so earlier offsets
 * remain valid.
 * @param source - The original source.
 * @param edits - The edits to apply.
 * @returns The edited source.
 */
function applyEdits(source: string, edits: readonly Edit[]): string {
  let result = source
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  }
  return result
}

/**
 * Rewrite a module for production HMR.
 *
 * The transform always pre-compiles JSX to the production runtime, even when the
 * module declares no components, so Bun's dev server never sees JSX and never
 * injects its development-only refresh transform. Modules with class components
 * are registered; style modules self-accept so their stylesheet reconciles in
 * place.
 * @param source - The module source.
 * @param filePath - Absolute path to the module.
 * @param cwd - Working directory used to derive stable component ids.
 * @returns The rewritten module, or `null` when Bun should handle it unchanged.
 */
export function transformProductionModule(
  source: string,
  filePath: string,
  cwd: string,
): { contents: string, loader: JavaScriptLoader } | null {
  const extension = path.extname(filePath).slice(1)
  const loader = LOADER_BY_EXTENSION[extension] ?? 'js'
  const isStyle = STYLE_MODULE.test(filePath)
  const isJsx = extension === 'jsx' || extension === 'tsx'

  const ast = parse(source, {
    plugins: ['jsx', 'typescript'],
    sourceType: 'module',
  })

  const id = path.relative(cwd, filePath).split(path.sep).join('/')
  const processed = new Set<string>()
  const edits: Edit[] = []

  traverse(ast, {
    ClassDeclaration(path_) {
      const { node, parentPath } = path_
      if (!node.id) return

      const atProgramScope = parentPath?.isProgram()
        || ((parentPath?.isExportNamedDeclaration() || parentPath?.isExportDefaultDeclaration())
          && parentPath.parentPath?.isProgram())
      if (!atProgramScope) return

      const name = node.id.name
      if (processed.has(name)) return
      processed.add(name)

      /*
       * Private class members carry a per-class brand. A new class's private
       * methods cannot run against an instance of the old class, so those
       * components cannot be merged in place. Registration marks them unstable:
       * the runtime returns the new class and React remounts that subtree.
       */
      const unstable = node.body.body.some(member => (
        'key' in member && member.key?.type === 'PrivateName'
      ))
      const registration = registrationSource(name, `${id}:${name}`, unstable)

      if (parentPath?.isExportDefaultDeclaration()) {
        /*
         * `export default class App` exports the class value, not a live binding,
         * so assigning the stable class back to `App` would leave the default
         * export pointing at the newly evaluated class. Drop the `export default`
         * prefix, then re-export the stable binding after registration.
         */
        edits.push({ end: node.start ?? 0, start: parentPath.node.start ?? 0, text: '' })
        edits.push({
          end: node.end ?? 0,
          start: node.end ?? 0,
          text: `${registration}\nexport default ${name};`,
        })
        return
      }

      if (parentPath?.isExportNamedDeclaration()) {
        /*
         * Named class exports are live bindings; insert the registration after
         * the export declaration so the binding and the export both update.
         */
        const end = parentPath.node.end ?? node.end ?? 0
        edits.push({ end, start: end, text: registration })
        return
      }

      const end = node.end ?? 0
      edits.push({ end, start: end, text: registration })
    },
  })

  const hasClasses = processed.size > 0
  if (!hasClasses && !isStyle && !isJsx) return null

  let rewritten = applyEdits(source, edits)
  if (hasClasses) {
    rewritten = `import { register as ${REGISTER} } from ${JSON.stringify(RUNTIME)};\n${rewritten}`
  }

  if (hasClasses || isStyle) {
    rewritten += '\nif (import.meta.hot) import.meta.hot.accept();\n'
  }

  /*
   * Bun.Transpiler resolves `import.meta.hot` against its own build context and
   * dead-code-eliminates it when it is not running the dev server. Shield every
   * occurrence while TypeScript/JSX is stripped, then restore it so the accept
   * boundary survives the production build.
   */
  const hot = `__BASIS_IMPORT_META_HOT_${Math.random().toString(36).slice(2)}__`
  const contents = transpilerFor(loader)
    .transformSync(rewritten.replaceAll('import.meta.hot', hot))
    .replaceAll(hot, 'import.meta.hot')

  return { contents, loader: 'js' }
}

/**
 * Options for the production HMR plugin.
 */
export interface PluginHMROptions {
  /**
   * Run the class-component HMR transform outside production. Vendor-backed
   * preview deployments use this to keep class state with a production React
   * vendor build instead of React Refresh.
   */
  force?: boolean,
}

/**
 * A Bun plugin that replaces React Fast Refresh with Basis's production class
 * component HMR. It is inert outside the browser target, or outside production
 * mode unless {@link PluginHMROptions.force} is set.
 * @param options - Plugin options.
 * @param options.force - Run the transform outside production.
 * @returns The plugin.
 */
export const pluginHMR = ({ force = false }: PluginHMROptions = {}): BunPlugin => ({
  name: 'basis-production-hmr',
  setup(build) {
    if (build.config.target !== 'browser') return
    if (!force && process.env.NODE_ENV !== 'production') return

    build.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
      if (args.path.includes('node_modules') || /\.d\.[jt]s$/.test(args.path)) return undefined

      const source = await Bun.file(args.path).text()
      return transformProductionModule(source, args.path, process.cwd()) ?? undefined
    })
  },
})
