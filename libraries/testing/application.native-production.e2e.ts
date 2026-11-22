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
 * Write a minimal native-production application. Server.start derives
 * `development: false` from NODE_ENV=production.
 * @param label - Fixture label used in the temporary directory name.
 * @returns The fixture directory.
 */
function fixture(label: string): string {
  const directory = tempDirectory(`basis-native-production-${label}-`)
  created.push(directory)
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  writeFileSync(join(directory, 'bunfig.toml'), '[serve.static]\nplugins = ["basis/serve"]\n')
  writeFileSync(join(directory, 'serve.ts'), `
import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}

new Server().root(import.meta.dir).main('./Application.tsx').title('Native Production').start()
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
      <h1>Native {this.state.count}</h1>
      <button onClick={() => this.increment()}>increment</button>
    </div>
  }
}
  `.trim())
  return directory
}

/*
 * Regression coverage for native production serving through the existing
 * vendor resolver. The fixture still forces Bun.serve({ development: false });
 * Server.start must sequence vendor readiness and serve the vendor script as
 * an external absolute URL so Bun does not try to resolve it as a file.
 */
test('serves an application directly from source with development disabled', async () => {
  const directory = fixture('baseline')
  const started = performance.now()
  const app = await useApplication({
    cwd: directory,
    development: false,
    entry: './serve.ts',
    timeoutMs: 10_000,
  })
  const startupMs = performance.now() - started

  try {
    const health = await Bun.fetch(`${app.url}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok' })

    const compilationStarted = performance.now()
    const html = await Bun.fetch(app.url).then(response => response.text())
    const firstRequestMs = performance.now() - compilationStarted
    expect(html).toContain('<h1>Native <!-- -->0</h1>')
    const source = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(match => match[1])[0]
    expect(source).toBeDefined()
    expect(html).toMatch(/src="http:\/\/127\.0\.0\.1:\d+\/assets\/vendor\/vendor\.js"/)
    expect(html.indexOf('/assets/vendor/vendor.js')).toBeGreaterThan(-1)
    expect(html.indexOf(source ?? '')).toBeGreaterThan(html.indexOf('/assets/vendor/vendor.js'))

    const bundle = await Bun.fetch(new URL(source ?? '/', app.url)).then(response => response.text())
    expect(bundle).not.toContain('react-refresh')
    expect(bundle).not.toContain('jsxDEV')
    expect(bundle).toContain('__basisVendor')
    expect(await Bun.fetch(app.url).then(response => response.text())).toBe(html)
    expect(await Bun.fetch(new URL(source ?? '/', app.url)).then(response => response.text())).toBe(bundle)

    let hydrated = false
    const sockets: string[] = []
    const developmentRequests: string[] = []
    const errors: string[] = []
    await app.visit('/', {
      init: page => {
        page.on('websocket', socket => { sockets.push(socket.url()) })
        page.on('request', request => {
          if (request.url().includes('/_bun/')) developmentRequests.push(request.url())
        })
        page.on('console', message => {
          if (message.type() === 'error') errors.push(message.text())
        })
        page.on('pageerror', error => { errors.push(error.message) })
      },
    }, async page => {
      await page.waitForSelector('h1')
      await page.waitForFunction(() => (globalThis as { __basisHydrated?: boolean }).__basisHydrated === true)
      hydrated = true
      expect(await page.textContent('h1')).toBe('Native 0')
      await page.click('button')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Native 1')
    })

    expect(hydrated).toBe(true)
    expect(sockets).toEqual([])
    expect(developmentRequests).toEqual([])
    expect(errors.filter(error => /hydrat|refresh|jsxdev/i.test(error))).toEqual([])

    process.stdout.write(
      `[native-production] startup=${startupMs.toFixed(1)}ms ` +
      `first-request=${firstRequestMs.toFixed(1)}ms ` +
      `sockets=${sockets.length} dev-requests=${developmentRequests.length}\n`,
    )
  } finally {
    await app.stop()
  }
}, 60_000)

test('does not apply source edits until the native production server restarts', async () => {
  const directory = fixture('restart')
  const first = await useApplication({
    cwd: directory,
    development: false,
    entry: './serve.ts',
    env: { NATIVE_PHASE: 'first' },
    timeoutMs: 10_000,
  })

  try {
    const html = await Bun.fetch(first.url).then(response => response.text())
    const source = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(match => match[1])[0]
    expect(source).toBeDefined()
    const originalBundle = await Bun.fetch(new URL(source ?? '/', first.url)).then(response => response.text())

    let hydrated = false
    await first.visit('/', async page => {
      await page.waitForSelector('h1')
      await page.waitForFunction(() => (globalThis as { __basisHydrated?: boolean }).__basisHydrated === true)
      hydrated = true
      await page.evaluate(() => {
        (globalThis as { __nativeSurvived?: string }).__nativeSurvived = 'yes'
      })

      const original = readFileSync(join(directory, 'Application.tsx'), 'utf8')
      writeFileSync(
        join(directory, 'Application.tsx'),
        original.replace('Native {this.state.count}', 'Native Updated {this.state.count}'),
      )
      await Bun.sleep(500)

      expect(await page.textContent('h1')).toBe('Native 0')
      const freshHtml = await Bun.fetch(first.url).then(response => response.text())
      expect(freshHtml).toContain('<h1>Native <!-- -->0</h1>')
      expect(await page.evaluate(() => (globalThis as { __nativeSurvived?: string }).__nativeSurvived)).toBe('yes')
    })
    expect(hydrated).toBe(true)
    expect(await Bun.fetch(new URL(source ?? '/', first.url)).then(response => response.text())).toBe(originalBundle)
  } finally {
    await first.stop()
  }

  const second = await useApplication({
    cwd: directory,
    development: false,
    entry: './serve.ts',
    env: { NATIVE_PHASE: 'second' },
    timeoutMs: 10_000,
  })
  try {
    const html = await Bun.fetch(second.url).then(response => response.text())
    expect(html).toContain('<h1>Native Updated <!-- -->0</h1>')
  } finally {
    await second.stop()
  }
}, 30_000)
