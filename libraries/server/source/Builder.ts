import type { BuildArtifact } from 'bun'
import type { FSWatcher } from 'chokidar'
import { watch } from 'chokidar'
import * as path from 'node:path'
import { pluginGlobals, pluginSASS } from '@basis/bun-plugins'
import { transformJsxDev } from './utilities/transformJsxDev'

/** A build output. */
interface BuildOutput {
  /** The name of the entrypoint. */
  name: string,
  /** The build artifact. */
  output: BuildArtifact,
}

/** The builder options. */
interface BuilderOptions {
  /** The callback to call when the build is rebuilt. */
  onRebuild?: (outputs: BuildOutput[]) => void | Promise<void>,
  /** The root directory of the project. */
  root?: string,
}

/** A builder for live-compiling React code from source.. */
/* eslint-disable no-console */
/* TODO: add a proper logger */
export class Builder {
  #build: Promise<BuildOutput[]>
  #entrypoints: [string, string][] = []
  #onRebuild: BuilderOptions['onRebuild']
  #root: string
  #watcher: FSWatcher | null = null

  constructor({ onRebuild, root = process.cwd() }: BuilderOptions = {}) {
    this.#root = root
    this.#onRebuild = onRebuild
  }

  /**
   * Sets up a watcher for the entrypoints.
   * @returns void
   */
  private async setupWatcher(): Promise<void> {
    if (this.#watcher) {
      await this.#watcher.close()
    }

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

      rebuildTimeout = setTimeout(async () => {
        console.log(`[HMR] File changed: ${changedPath}`)
        await this.rebuild()
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

    try {
      this.#build = Bun.build({
        define: {
          'Bun.env.NODE_ENV': JSON.stringify(Bun.env.NODE_ENV ?? 'production'),
        },
        entrypoints: this.#entrypoints.map(([, file]) => (
          path.isAbsolute(file) ? file : path.join(this.#root, file)
        )),
        external: ['react', 'react-dom'],
        minify: {
          identifiers: false,
          syntax: true,
          whitespace: true,
        },
        plugins: [
          pluginGlobals({
            'react': 'window.React',
            'react-dom': 'window.ReactDOM',
            'react-dom/client': 'window.ReactDOM',
          }),
          pluginSASS(),
        ],
        sourcemap: 'external',
      }).then(async build => {
        const outputs = build.outputs
          .filter(o => o.kind === 'entry-point')
          .map<BuildOutput>((output, index) => {
            const outputText = output.text.bind(output)
            output.text = () => outputText().then(transformJsxDev)
            return ({
              name: this.#entrypoints[index][0],
              output,
            })
          })

        await this.#onRebuild?.(outputs)
        return outputs
      })

      return this.#build
    } catch (error) {
      console.error('[HMR] Build failed:', error)
      return []
    }
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
    await this.rebuild()
    await this.setupWatcher() // Only set up the watcher after initial build
    return this.#build
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
