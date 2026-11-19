import type { BunPlugin } from 'bun'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
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
   * Defaults to `assets/vendor`.
   */
  outdir?: string,
  /** Root used to resolve relative entrypoints and `outdir`. Defaults to the working directory. */
  root?: string,
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
  const outdirOption = options.outdir ?? 'assets/vendor'
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
    assets.push({
      bytes: bytes.byteLength,
      file: output.path,
      hash,
      name: entry.name,
      url: `/assets/vendor/${entry.name}.js?v=${hash}`,
    })
  }

  return {
    assets,
    byName: Object.fromEntries(assets.map(asset => [asset.name, asset])),
  }
}
