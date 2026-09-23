import type { BuildArtifact, BunPlugin } from 'bun'
import type { FSWatcher } from 'chokidar'
import * as path from 'node:path'
import { pluginGlobals, pluginSASS } from '../../bun-plugins'
import { transformJsxDev } from './utilities/transformJsxDev'

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

/** The builder options. */
interface BuilderOptions {
  /**
   * Build for live development: keep React external and mapped onto browser
   * globals, and rewrite the JSX dev runtime for the globals build. When
   * `false`, dependencies are bundled from the installed graph.
   */
  development?: boolean,
  /** The callback to call when the build is rebuilt. */
  onRebuild?: (outputs: BuildOutput[]) => void | Promise<void>,
  /** The root directory of the project. */
  root?: string,
  /** Whether to watch entrypoints and rebuild on change. */
  watch?: boolean,
}

/** A builder for compiling React code from source. */
/* eslint-disable no-console */
/* TODO: add a proper logger */
export class Builder {
  #build: Promise<BuildOutput[]> = Promise.resolve([])
  #development: boolean
  #entrypoints: [string, string][] = []
  #onRebuild: BuilderOptions['onRebuild']
  #root: string
  #watch: boolean
  #watcher: FSWatcher | null = null

  constructor({
    development = true,
    onRebuild,
    root = process.cwd(),
    watch = true,
  }: BuilderOptions = {}) {
    this.#development = development
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
      // Only rebuild for TypeScript/JavaScript files
      if (!/\.(tsx?|jsx?)$/.test(changedPath)) return

      clearTimeout(rebuildTimeout)

      rebuildTimeout = setTimeout(() => {
        console.log(`[HMR] File changed: ${changedPath}`)
        this.rebuild().catch((error: unknown) => {
          console.error('[HMR] Rebuild failed:', error)
        })
        rebuildTimeout = null
      }, 100)
    }

    this.#watcher
      .on('change', handleChange)
      .on('add', handleChange)
      .on('error', error => {
        console.error('[HMR] Watcher error:', error)
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
    if (development) {
      plugins.unshift(pluginGlobals({
        'react': 'window.React',
        'react-dom': 'window.ReactDOM',
        'react-dom/client': 'window.ReactDOM',
      }))
    }

    this.#build = Bun.build({
      define: {
        'Bun.env.NODE_ENV': JSON.stringify(Bun.env.NODE_ENV ?? 'production'),
      },
      entrypoints: this.#entrypoints.map(([, file]) => (
        path.isAbsolute(file) ? file : path.join(this.#root, file)
      )),
      /*
       * Development keeps React external and mapped to browser globals so the
       * UMD builds served through the module proxy are reused. Production
       * bundles the installed dependency graph, so no CDN is required.
       */
      external: development ? ['react', 'react-dom'] : [],
      minify: development
        ? { identifiers: false, syntax: true, whitespace: true }
        : true,
      plugins,
      sourcemap: 'external',
    }).then(async build => {
      if (!build.success) {
        const details = build.logs.map(log => log.message).join('\n')
        throw new Error(details.length > 0 ? details : 'Build failed')
      }

      const outputs = build.outputs
        .filter(o => o.kind === 'entry-point')
        .map<BuildOutput>((output, index) => {
          if (development) {
            const outputText = output.text.bind(output)
            output.text = () => outputText().then(transformJsxDev)
          }
          return ({
            name: this.#entrypoints[index][0],
            output,
          })
        })

      await this.#onRebuild?.(outputs)
      return outputs
    }).catch((error: unknown) => {
      // Surface build failures to callers instead of resolving with no output.
      console.error('[basis] build failed:', error)
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
