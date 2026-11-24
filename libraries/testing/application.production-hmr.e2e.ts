import { afterAll, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
 * Write a minimal production application with a stateful class component and
 * the ordinary Basis serve plugin stack, including vendor resolution.
 * @returns The fixture directory.
 */
function fixture(): string {
  const directory = tempDirectory('basis-production-hmr-')
  created.push(directory)
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  writeFileSync(join(directory, 'bunfig.toml'), '[serve.static]\nplugins = ["basis/serve"]\n')
  writeFileSync(join(directory, 'serve.ts'), `
import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}

new Server().root(import.meta.dir).main('./Application.tsx').title('Production HMR').start({ hmr: true })
  `.trim())

  const componentModule = JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))
  writeFileSync(join(directory, 'Application.tsx'), `
import { Component } from ${componentModule}
import * as React from 'react'

export class Application extends Component {
  static displayName = "Application"
  state = { count: 0 }
  componentDidMount() {
    super.componentDidMount()
    globalThis.__basisHydrated = true
  }
  increment() { this.setState({ count: this.state.count + 1 }) }
  content() {
    return <div>
      <h1>Application {this.state.count}</h1>
      <button onClick={() => this.increment()}>increment</button>
    </div>
  }
}
  `.trim())
  return directory
}

test('keeps production React and hot-replaces a mounted class component', async () => {
  const directory = fixture()
  const app = await useApplication({
    cwd: directory,
    development: false,
    entry: './serve.ts',
  })

  try {
    const html = await Bun.fetch(app.url).then(response => response.text())
    expect(html).toContain('<h1>Application <!-- -->0</h1>')

    const source = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(match => match[1])[0]
    expect(source).toBeDefined()
    const bundle = await Bun.fetch(new URL(source, app.url)).then(response => response.text())
    expect(bundle).not.toContain('react-refresh')
    expect(bundle).not.toContain('jsxDEV')
    expect(bundle).not.toContain('react.production')
    expect(bundle).toContain('__basisVendor')
    expect(bundle).toContain('Application.tsx:Application')
    expect(html.indexOf('/assets/vendor/vendor.js')).toBeGreaterThan(-1)
    expect(html.indexOf(source)).toBeGreaterThan(html.indexOf('/assets/vendor/vendor.js'))

    let hydrated = false
    const errors: string[] = []

    await app.visit('/', {
      init: page => {
        page.on('console', message => {
          if (message.type() === 'error') errors.push(message.text())
        })
        page.on('pageerror', error => { errors.push(error.message) })
      },
    }, async page => {
      await page.waitForSelector('h1')
      await page.waitForFunction(() => (globalThis as { __basisHydrated?: boolean }).__basisHydrated === true)
      hydrated = true
      expect(await page.textContent('h1')).toBe('Application 0')

      await page.click('button')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Application 1')

      await page.evaluate(() => {
        (globalThis as { __basisHMRSurvived?: string }).__basisHMRSurvived = 'yes'
      })

      const original = readFileSync(join(directory, 'Application.tsx'), 'utf8')
      writeFileSync(
        join(directory, 'Application.tsx'),
        original.replace('Application {this.state.count}', 'Application Updated {this.state.count}'),
      )

      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application Updated 1',
        undefined,
        { timeout: 30_000 },
      )

      // A full reload would clear the marker and reset the class state to zero.
      expect(await page.evaluate(() => (globalThis as { __basisHMRSurvived?: string }).__basisHMRSurvived)).toBe('yes')

      await page.click('button')
      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application Updated 2',
        undefined,
        { timeout: 30_000 },
      )
    })

    expect(hydrated).toBe(true)
    expect(errors.filter(error => /hydrat|refresh|jsxdev/i.test(error))).toEqual([])
  } finally {
    await app.stop()
  }
}, 30_000)
