import type { BunPlugin } from 'bun'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

/** One vendor entrypoint to build into a browser chunk. */
export interface VendorEntry {
  /** Entry module, resolved relative to {@link VendorBuildOptions.root}. */
  entrypoint: string,
  /**
   * Exact module specifiers to replace with browser globals while building.
   *
   * Use this for packages shared by several vendor chunks, such as React, so a
   * chunk consumes the global loaded by an earlier chunk instead of bundling a
   * second copy.
   */
  globals?: Readonly<Record<string, string>>,
  /** Stable chunk name; the emitted file is `<name>.js`. */
  name: string,
  /** Additional Bun plugins for this entrypoint only. */
  plugins?: readonly BunPlugin[],
}

/** Options for {@link buildVendor}. */
export interface VendorBuildOptions {
  /** Entrypoints to build, in order. */
  entries: readonly VendorEntry[],
  /**
   * Directory to write chunks to, resolved relative to {@link VendorBuildOptions.root}.
   * Defaults to `dist/vendor`.
   */
  outdir?: string,
  /** Root used to resolve relative entrypoints and `outdir`. Defaults to the working directory. */
  root?: string,
}

/** Options for discovering client vendor dependencies. */
export interface DiscoverVendorOptions {
  /** Absolute application entrypoint. */
  entrypoint: string,
  /** Additional build plugins needed to parse the application source. */
  plugins?: readonly BunPlugin[],
  /** Root used to resolve relative applications and paths. Defaults to the working directory. */
  root?: string,
}

/** Options for building the automatic vendor bundle. */
export interface VendorBundleOptions {
  /** Directory to write the bundle to, resolved relative to {@link VendorBundleOptions.root}. */
  outdir?: string,
  /** Root used to resolve relative paths. Defaults to the working directory. */
  root?: string,
  /** Client bare import specifiers discovered from the application graph. */
  specifiers: readonly string[],
}

/** One emitted source map for a vendor artifact. */
export interface VendorSourceMap {
  /** Byte size of the source map. */
  bytes: number,
  /** Absolute path to the source map. */
  file: string,
  /** SHA-256 of the source map bytes. */
  hash: string,
  /** Versioned source map URL. */
  url: string,
}

/** One built vendor artifact. */
export interface VendorAsset {
  /** Byte size of the emitted file. */
  bytes: number,
  /** Absolute path to the emitted file. */
  file: string,
  /** SHA-256 of the emitted bytes, used as the content version. */
  hash: string,
  /** Stable chunk name. */
  name: string,
  /** Linked source map, when emitted. */
  sourceMap?: VendorSourceMap,
  /** Versioned browser URL, including the content hash. */
  url: string,
}

/** The result of {@link buildVendor}. */
export interface VendorBuild {
  /** Artifacts in entry order. */
  assets: readonly VendorAsset[],
  /** Artifact lookup by chunk name. */
  byName: Readonly<Record<string, VendorAsset>>,
}

/**
 * Escape one module name for a regular expression.
 * @param name - The module specifier.
 * @returns The escaped source.
 */
function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Map exact module specifiers to browser globals while building a vendor chunk.
 * @param globals - Module specifiers and their global expressions.
 * @returns The Bun plugin.
 */
function exactGlobals(globals: Readonly<Record<string, string>>): BunPlugin {
  const filter = new RegExp(`^(${Object.keys(globals).map(escapeRegExp).join('|')})$`)
  return {
    name: 'basis-vendor-globals',
    setup(build) {
      build.onResolve({ filter }, args => ({ namespace: 'basis-vendor-globals', path: args.path }))
      build.onLoad({ filter: /.*/, namespace: 'basis-vendor-globals' }, args => {
        const global = globals[args.path]
        return global ? { contents: `module.exports = ${global}`, loader: 'js' } : null
      })
    },
  }
}

/**
 * Discover the bare imports the client application resolves into `node_modules`.
 *
 * Workspace and application source is traversed; a package under `node_modules`
 * becomes a vendor specifier and is not traversed by the discovery build.
 * @param options - The application entrypoint and optional build plugins.
 * @returns The sorted client vendor specifiers.
 */
export async function discoverVendorSpecifiers(options: DiscoverVendorOptions): Promise<string[]> {
  const root = path.resolve(options.root ?? process.cwd())
  const entrypoint = path.isAbsolute(options.entrypoint)
    ? options.entrypoint
    : path.resolve(root, options.entrypoint)
  const specifiers = new Set<string>()
  const discovery: BunPlugin = {
    name: 'basis-vendor-discovery',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        const specifier = args.path
        if (
          specifier.length === 0
          || specifier.startsWith('.')
          || specifier.startsWith('/')
          || specifier.startsWith('node:')
          || specifier.startsWith('bun:')
          || specifier === 'basis'
          || specifier.startsWith('basis/')
        ) {
          return undefined
        }

        let resolved: string
        try {
          resolved = Bun.resolveSync(specifier, path.dirname(args.importer))
        } catch {
          return undefined
        }
        if (!resolved.includes(`${path.sep}node_modules${path.sep}`)) return undefined

        specifiers.add(specifier)
        return { external: true, path: specifier }
      })
    },
  }

  const build = await Bun.build({
    define: {
      'Bun.env.NODE_ENV': JSON.stringify(Bun.env.NODE_ENV ?? 'production'),
      'process.env.NODE_ENV': JSON.stringify(Bun.env.NODE_ENV ?? 'production'),
    },
    entrypoints: [entrypoint],
    format: 'iife',
    plugins: [...(options.plugins ?? []), discovery],
    target: 'browser',
    write: false,
  } as unknown as Bun.BuildConfig)

  if (!build.success) {
    const details = build.logs.map(log => log.message).join('\n')
    throw new Error(`vendor discovery failed: ${details.length > 0 ? details : 'build failed'}`)
  }

  return [...specifiers].sort()
}

/**
 * Build the automatic vendor bundle from discovered client specifiers.
 *
 * The bundle exposes each module namespace on `globalThis.__basisVendor`; the
 * vendor plugin resolves the application's matching imports to those globals.
 * @param options - The discovered specifiers and optional output directory.
 * @returns The built vendor artifact set.
 */
export async function buildVendorBundle(options: VendorBundleOptions): Promise<VendorBuild> {
  const root = path.resolve(options.root ?? process.cwd())
  const directory = path.join(root, '.basis')
  await mkdir(directory, { recursive: true })

  const specifiers = [...new Set(options.specifiers)].sort()
  const imports = specifiers.map((specifier, index) => (
    `import * as vendor${index} from ${JSON.stringify(specifier)}`
  ))
  const assignments = specifiers.map((specifier, index) => (
    `vendor[${JSON.stringify(specifier)}] = { ...vendor${index}, __esModule: true }`
  ))
  const entrypoint = path.join(directory, 'vendor-entry.ts')
  await writeFile(entrypoint, [
    ...imports,
    'const vendor = globalThis.__basisVendor ??= {}',
    ...assignments,
    '',
  ].join('\n'))

  return buildVendor({
    entries: [{ entrypoint, name: 'vendor' }],
    outdir: options.outdir,
    root,
  })
}

/**
 * Build deterministic, separately cacheable vendor chunks.
 *
 * Each entrypoint is built in isolation into a stable `<name>.js` file, then
 * hashed from the emitted bytes. Rebuilding unchanged content therefore keeps
 * its URL, while changing one chunk invalidates only that chunk's version.
 * @param options - The entrypoints and optional output directory.
 * @returns The built artifacts and a name-indexed lookup.
 */
export async function buildVendor(options: VendorBuildOptions): Promise<VendorBuild> {
  const root = path.resolve(options.root ?? process.cwd())
  const outdirOption = options.outdir ?? 'dist/vendor'
  const outdir = path.isAbsolute(outdirOption) ? outdirOption : path.resolve(root, outdirOption)
  const assets: VendorAsset[] = []
  const names = new Set<string>()

  await mkdir(outdir, { recursive: true })

  for (const entry of options.entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name) || entry.name.includes('..')) {
      throw new Error(`Invalid vendor chunk name: ${JSON.stringify(entry.name)}`)
    }
    if (names.has(entry.name)) throw new Error(`Duplicate vendor chunk name: ${entry.name}`)
    names.add(entry.name)

    const entrypoint = path.isAbsolute(entry.entrypoint)
      ? entry.entrypoint
      : path.resolve(root, entry.entrypoint)
    const plugins: BunPlugin[] = []
    if (entry.globals && Object.keys(entry.globals).length > 0) plugins.push(exactGlobals(entry.globals))
    if (entry.plugins) plugins.push(...entry.plugins)

    const build = await Bun.build({
      define: {
        'Bun.env.NODE_ENV': '"production"',
        'process.env.NODE_ENV': '"production"',
      },
      entrypoints: [entrypoint],
      format: 'iife',
      minify: true,
      naming: { entry: `${entry.name}.js` },
      outdir,
      plugins,
      sourcemap: 'linked',
      target: 'browser',
    })

    if (!build.success) {
      const details = build.logs.map(log => log.message).join('\n')
      throw new Error(`vendor/${entry.name} failed: ${details.length > 0 ? details : 'build failed'}`)
    }

    const output = build.outputs.find(candidate => candidate.kind === 'entry-point')
    if (!output) throw new Error(`vendor/${entry.name} emitted no entry-point output`)

    const bytes = new Uint8Array(await output.arrayBuffer())
    const hash = createHash('sha256').update(bytes).digest('hex')
    const mapOutput = build.outputs.find(candidate => (
      candidate.kind === 'sourcemap' || candidate.path === `${output.path}.map`
    ))
    let sourceMap: VendorSourceMap | undefined
    if (mapOutput) {
      const mapBytes = new Uint8Array(await mapOutput.arrayBuffer())
      const mapHash = createHash('sha256').update(mapBytes).digest('hex')
      sourceMap = {
        bytes: mapBytes.byteLength,
        file: mapOutput.path,
        hash: mapHash,
        url: `/assets/vendor/${entry.name}.js.map?v=${mapHash}`,
      }
    }
    assets.push({
      bytes: bytes.byteLength,
      file: output.path,
      hash,
      name: entry.name,
      sourceMap,
      url: `/assets/vendor/${entry.name}.js?v=${hash}`,
    })
  }

  return {
    assets,
    byName: Object.fromEntries(assets.map(asset => [asset.name, asset])),
  }
}
