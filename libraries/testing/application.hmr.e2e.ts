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
 * Write a minimal Basis application that exercises the native Bun dev server.
 * @returns The fixture directory.
 */
function fixture(): string {
  const directory = tempDirectory('basis-application-hmr-')
  created.push(directory)
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  writeFileSync(join(directory, 'serve.ts'), `
import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}

new Server().root(import.meta.dir).main('./Application.tsx').title('HMR').start()
  `.trim())
  const componentModule = JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))
  writeFileSync(join(directory, 'Application.tsx'), `
import { Component } from ${componentModule}
import * as React from 'react'

export class Application extends Component {
  static displayName = "Application"
  componentDidMount() {
    super.componentDidMount()
    globalThis.__basisHydrated = true
  }
  content() {
    return <h1>Application</h1>
  }
}
  `.trim())
  return directory
}

test('serves updated browser source through native HMR without restarting', async () => {
  const directory = fixture()
  const app = await useApplication({
    cwd: directory,
    development: true,
    entry: './serve.ts',
  })

  try {
    const html = await Bun.fetch(app.url).then(response => response.text())
    expect(html).toContain('<h1>Application</h1>')
    expect(html).toContain('id="basis-bootstrap"')

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
      expect(await page.textContent('h1')).toBe('Application')
      const source = readFileSync(join(directory, 'Application.tsx'), 'utf8')
      writeFileSync(join(directory, 'Application.tsx'), source.replace('Application</h1>', 'Application Updated</h1>'))
      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application Updated',
        undefined,
        { timeout: 30_000 },
      )
    })

    expect(hydrated).toBe(true)
    expect(errors.filter(error => /hydrat/i.test(error))).toEqual([])
  } finally {
    await app.stop()
  }
}, 30_000)
