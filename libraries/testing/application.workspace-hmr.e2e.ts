import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useApplication } from './application'
import { tempDirectory } from './tempDirectory'

const repoRoot = join(import.meta.dir, '..', '..')
const basisLink = join(repoRoot, 'node_modules', 'basis')
if (!existsSync(basisLink)) symlinkSync(repoRoot, basisLink, 'dir')
const created: string[] = []

afterAll(() => {
  for (const directory of created) rmSync(directory, { force: true, recursive: true })
})

/**
 * Write a workspace consumer fixture whose first-party component is resolved
 * through a node_modules symlink, as a real Bun workspace does.
 * @returns The fixture directory.
 */
function fixture(): string {
  const directory = tempDirectory('basis-workspace-hmr-')
  created.push(directory)

  const modules = join(directory, 'node_modules')
  mkdirSync(modules, { recursive: true })
  for (const name of readdirSync(join(repoRoot, 'node_modules'))) {
    if (name === '.bin' || name === 'widget') continue
    symlinkSync(join(repoRoot, 'node_modules', name), join(modules, name), 'dir')
  }
  if (!existsSync(join(modules, 'basis'))) symlinkSync(repoRoot, join(modules, 'basis'), 'dir')

  const widget = join(directory, 'packages', 'widget')
  mkdirSync(widget, { recursive: true })
  writeFileSync(join(widget, 'package.json'), JSON.stringify({
    main: 'index.tsx',
    name: 'widget',
    private: true,
    type: 'module',
  }))
  writeFileSync(join(widget, 'index.tsx'), `
import { Component } from ${JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))}
import * as React from 'react'

export class Widget extends Component {
  static displayName = 'Widget'
  state = { count: 0 }
  increment() { this.setState({ count: this.state.count + 1 }) }
  content() {
    return (
      <div data-testid="widget">
        <span>Widget {this.state.count}</span>
        <button onClick={() => this.increment()}>widget+</button>
      </div>
    )
  }
}
  `.trim())
  symlinkSync(widget, join(modules, 'widget'), 'dir')

  writeFileSync(join(directory, 'bunfig.toml'), '[serve.static]\nplugins = ["basis/serve"]\n')
  writeFileSync(join(directory, 'serve.ts'), `
import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}

new Server().root(import.meta.dir).main('./Application.tsx').title('Workspace HMR').start({ hmr: true })
  `.trim())

  const componentModule = JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))
  writeFileSync(join(directory, 'Application.tsx'), `
import { Component } from ${componentModule}
import * as React from 'react'
import { Widget } from 'widget'

export class Application extends Component {
  static displayName = 'Application'
  componentDidMount() {
    super.componentDidMount()
    globalThis.__basisHydrated = true
  }
  content() {
    return <main><h1>Workspace</h1><Widget /></main>
  }
}
  `.trim())
  return directory
}

test('transforms and hot-replaces first-party workspace JSX behind a node_modules symlink', async () => {
  const directory = fixture()
  const app = await useApplication({ cwd: directory, development: false, entry: './serve.ts' })

  try {
    const html = await Bun.fetch(app.url).then(response => response.text())
    expect(html).toContain('Widget <!-- -->0')

    const source = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(match => match[1])[0]
    expect(source).toBeDefined()
    const bundle = await Bun.fetch(new URL(source, app.url)).then(response => response.text())
    expect(bundle).not.toContain('jsxDEV')
    expect(bundle).not.toContain('react-refresh')
    expect(bundle).toContain('widget/index.tsx:Widget')
    expect(bundle).not.toContain('node_modules/widget/index.tsx')

    await app.visit('/', async page => {
      await page.waitForFunction(() => (globalThis as { __basisHydrated?: boolean }).__basisHydrated === true)
      await page.click('[data-testid="widget"] button')
      await page.waitForFunction(
        () => document.querySelector('[data-testid="widget"] span')?.textContent === 'Widget 1',
      )

      await page.evaluate(() => {
        (globalThis as { __basisHMRSurvived?: string }).__basisHMRSurvived = 'yes'
      })

      const widgetFile = join(directory, 'packages', 'widget', 'index.tsx')
      const original = readFileSync(widgetFile, 'utf8')
      writeFileSync(widgetFile, original.replace('Widget {this.state.count}', 'Widget Updated {this.state.count}'))

      await page.waitForFunction(
        () => document.querySelector('[data-testid="widget"] span')?.textContent === 'Widget Updated 1',
        undefined,
        { timeout: 30_000 },
      )

      expect(await page.evaluate(() => (globalThis as { __basisHMRSurvived?: string }).__basisHMRSurvived)).toBe('yes')
    })
  } finally {
    await app.stop()
  }
}, 60_000)
