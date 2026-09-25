import type { BuildArtifact, BunPlugin } from 'bun'
import type { FSWatcher } from 'chokidar'
import * as path from 'node:path'
import { pluginSASS } from '../../bun-plugins'
import type { ILogger } from '../../utilities'
import { Logger } from '../../utilities'

/** A build output. */
interface BuildOutput {
  /** The name of the entrypoint. */
  name: string,
  /** The build artifact. */
  output: BuildArtifact,
}

/**
 * Normalizes a thrown build failure into an `Error` with a useful message.
 * @param error The thrown build error.
 * @returns A normalized error.
 */
const buildError = (error: unknown): Error => {
  if (error instanceof AggregateError) {
    const details = error.errors
      .map(inner => (inner instanceof Error ? inner.message : String(inner)))
      .join('\n')
    return new Error(details.length > 0 ? details : error.message)
  }

  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Extensions that can change a build. Source, styles, and the assets Bun emits
 * as separate outputs all qualify; anything else in a watched directory is
 * ignored. `node_modules` and `.d.ts` files are excluded by the watcher itself.
 */
const BUILDABLE_EXTENSIONS = new Set([
  'cjs', 'css', 'cts', 'eot', 'gif', 'htm', 'html', 'ico', 'jpeg', 'jpg', 'js',
  'json', 'jsx', 'less', 'mjs', 'mts', 'otf', 'png', 'sass', 'scss', 'svg', 'ts',
  'tsx', 'ttf', 'webp', 'woff', 'woff2',
])

/**
 * Bun's `BuildConfig.format` union carries interleaved JSDoc, which the native
 * TypeScript build this repository runs in CI parses as `"esm"` alone and so
 * rejects `'iife'` at the call site. Spell the option here instead, then assert
 * the config back to `Bun.BuildConfig`; `BuildConfig` remains assignable to this
 * broader shape, so the assertion is sound either way it is parsed.
 */
interface BrowserBuildConfig extends Omit<Bun.BuildConfig, 'format'> {
  format?: 'cjs' | 'esm' | 'iife',
}

/** The builder options. */
interface BuilderOptions {
  /**
   * Run the live-development build/watch workflow. Development compiles from
   * source, rebuilds on change, and broadcasts HMR; dependencies are bundled in
   * both modes, so no CDN or browser globals are required.
   * Defaults to `NODE_ENV !== 'production'`.
   */
  development?: boolean,
  /** Log sink for build/HMR lifecycle output; defaults to a standard logger. */
  logger?: ILogger,
  /** The callback to call when the build is rebuilt. */
  onRebuild?: (outputs: BuildOutput[]) => void | Promise<void>,
  /** The root directory of the project. */
  root?: string,
  /** Whether to watch entrypoints and rebuild on change. */
  watch?: boolean,
}

/** A builder for compiling React code from source. */
export class Builder {
  #build: Promise<BuildOutput[]> = Promise.resolve([])
  #development: boolean
  #entrypoints: [string, string][] = []
  #logger: ILogger
  #onRebuild: BuilderOptions['onRebuild']
  #root: string
  #watch: boolean
  #watcher: FSWatcher | null = null

  constructor({
    development = true,
    logger,
    onRebuild,
    root = process.cwd(),
    watch = true,
  }: BuilderOptions = {}) {
    this.#development = development
    this.#logger = logger ?? new Logger()
    this.#onRebuild = onRebuild
    this.#root = root
    this.#watch = watch
  }

  /**
   * Whether a rebuild watcher is currently active.
   * @returns `true` when a watcher is running.
   */
  get watching(): boolean {
    return this.#watcher !== null
  }

  /**
   * Sets up a watcher for the entrypoints.
   * @returns void
   */
  private async setupWatcher(): Promise<void> {
    if (this.#watcher) {
      await this.#watcher.close()
    }

    // Load the watcher lazily so production runs never pull in chokidar.
    const { watch } = await import('chokidar')

    // Watch only the source directories of our entrypoints
    const entrypointDirs = new Set(
      this.#entrypoints.map(([, file]) => path.dirname(file)),
    )

    this.#watcher = watch(Array.from(entrypointDirs), {
      ignoreInitial: true,
      ignored: [
        /(^|[/\\])\../, // dot files
        '**/node_modules/**',
        '**/*.d.ts',
      ],
      persistent: true,
    })

    let rebuildTimeout: Timer | null = null

    const handleChange = async (changedPath: string): Promise<void> => {
      if (!BUILDABLE_EXTENSIONS.has(path.extname(changedPath).slice(1).toLowerCase())) return

      clearTimeout(rebuildTimeout)

      rebuildTimeout = setTimeout(() => {
        this.#logger.info(`[HMR] File changed: ${changedPath}`)
        this.rebuild().catch((error: unknown) => {
          this.#logger.error('[HMR] Rebuild failed:', String(error))
        })
        rebuildTimeout = null
      }, 100)
    }

    this.#watcher
      .on('change', handleChange)
      .on('add', handleChange)
      .on('error', error => {
        this.#logger.error('[HMR] Watcher error:', String(error))
      })

    /*
     * Resolve after the initial scan completes. Otherwise a caller that awaits
     * the initial build can write a file before the watcher is live, and
     * `ignoreInitial` folds that change into the discarded initial scan.
     */
    await new Promise<void>(resolve => {
      this.#watcher?.once('ready', () => resolve())
    })
  }

  /**
   * Rebuilds the build.
   * @returns The build outputs.
   */
  async rebuild(): Promise<BuildOutput[]> {
    if (!this.#entrypoints.length) return []

    const development = this.#development
    const plugins: BunPlugin[] = [pluginSASS()]

    const config: BrowserBuildConfig = {
      define: {
        'Bun.env.NODE_ENV': JSON.stringify(Bun.env.NODE_ENV ?? 'production'),
      },
      entrypoints: this.#entrypoints.map(([, file]) => (
        path.isAbsolute(file) ? file : path.join(this.#root, file)
      )),
      /*
       * Dependencies are bundled in both modes, so development needs no CDN or
       * browser globals; development only trades stronger minification for
       * readable output and keeps the watcher.
       */
      external: [],
      /*
       * The SPA shell loads entrypoints as classic `<script defer>` tags, so the
       * bundle must be classic-script compatible. `iife` guarantees that even
       * when an entrypoint exports a binding (the default `esm` format would end
       * with `export{…}`, a syntax error in a classic script) and keeps every
       * module-local name off `window`.
       */
      format: 'iife',
      minify: development
        ? { identifiers: false, syntax: true, whitespace: true }
        : true,
      plugins,
      /*
       * Imported assets (images, fonts, …) are emitted as separate files. Reference
       * them at the absolute `/scripts/` base so the URLs the bundle embeds resolve
       * to the same route `handleScripts` serves them from.
       */
      publicPath: '/scripts/',
      sourcemap: 'external',
      target: 'browser',
    }

    this.#build = Bun.build(config as Bun.BuildConfig).then(async build => {
      if (!build.success) {
        const details = build.logs.map(log => log.message).join('\n')
        throw new Error(details.length > 0 ? details : 'Build failed')
      }

      /*
       * Entrypoints keep their logical route name (`index.js`, `hmr.js`); every
       * other output — bundler-emitted assets and sourcemaps — is served under
       * its own file name. Bun lists entry-point outputs first, in entrypoint
       * order.
       */
      const entries = build.outputs.filter(output => output.kind === 'entry-point')
      const extras = build.outputs.filter(output => output.kind !== 'entry-point')
      const outputs = [
        ...entries.map<BuildOutput>((output, index) => ({
          name: this.#entrypoints[index]?.[0] ?? path.basename(output.path),
          output,
        })),
        ...extras.map<BuildOutput>(output => ({
          name: path.basename(output.path),
          output,
        })),
      ]

      await this.#onRebuild?.(outputs)
      return outputs
    }).catch((error: unknown) => {
      // Surface build failures to callers instead of resolving with no output.
      this.#logger.error('[basis] build failed:', String(error))
      throw buildError(error)
    })

    return this.#build
  }

  /**
   * Adds an entrypoint to the builder.
   * @param name - The name of the entrypoint.
   * @param filePath - The path to the entrypoint.
   * @returns The builder.
   */
  async add(name: string, filePath: string): Promise<Builder> {
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.#root, filePath)

    this.#entrypoints.push([name, absolute])
    // Don't rebuild immediately - just track the entrypoint
    return this
  }

  /**
   * Performs an initial build.
   * @returns The build outputs.
   */
  async initialBuild(): Promise<BuildOutput[]> {
    const build = this.rebuild()
    /*
     * Establish the watcher even if the initial build fails, so development can
     * recover after the source is fixed. Production never watches.
     */
    if (this.#watch) await this.setupWatcher()
    return build
  }

  /**
   * Stops the watcher.
   * @returns void
   */
  async stop(): Promise<void> {
    if (this.#watcher) {
      await this.#watcher.close()
      this.#watcher = null
    }
  }

  /**
   * Gets the build outputs.
   * @returns The build outputs.
   */
  getOutputs(): Promise<BuildOutput[]> {
    return this.#build
  }
}
