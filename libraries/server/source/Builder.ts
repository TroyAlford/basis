import type { BuildArtifact } from 'bun'
import type { FSWatcher } from 'chokidar'
import { watch } from 'chokidar'
import * as path from 'node:path'
import { pluginGlobals, pluginSASS } from '@basis/bun-plugins'
import { transformJsxDev } from './utilities/transformJsxDev'

interface BuildOutput {
  name: string,
  output: BuildArtifact,
}

interface BuilderOptions {
  onRebuild?: (outputs: BuildOutput[]) => void | Promise<void>,
  root?: string,
}

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

  private async setupWatcher() {
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

    const handleChange = async (changedPath: string) => {
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

  async rebuild() {
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
          pluginSASS(this.#root),
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

  async add(name: string, filePath: string) {
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.#root, filePath)

    this.#entrypoints.push([name, absolute])
    // Don't rebuild immediately - just track the entrypoint
    return this
  }

  async initialBuild() {
    await this.rebuild()
    await this.setupWatcher() // Only set up the watcher after initial build
    return this.#build
  }

  async stop() {
    if (this.#watcher) {
      await this.#watcher.close()
      this.#watcher = null
    }
  }

  getOutputs() {
    return this.#build
  }
}
