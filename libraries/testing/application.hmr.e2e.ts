import { afterAll, expect, test } from 'bun:test'
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useApplication } from './application'
import { tempDirectory } from './temp'

const repoRoot = join(import.meta.dir, '..', '..')
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
  writeFileSync(join(directory, 'serve.ts'), [
    `import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}`,
    '',
    "new Server().root(import.meta.dir).main('./main.tsx').title('HMR').start()",
  ].join('\n'))
  writeFileSync(join(directory, 'main.tsx'), [
    "import * as React from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { Application } from './Application'",
    '',
    "createRoot(document.getElementById('root')).render(<Application />)",
  ].join('\n'))
  writeFileSync(join(directory, 'Application.tsx'), [
    `import { Component } from ${JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))}`,
    "import * as React from 'react'",
    '',
    'export class Application extends Component {',
    '  static displayName = "Application"',
    '  content() {',
    '    return <h1>Application</h1>',
    '  }',
    '}',
  ].join('\n'))
  return directory
}

test('serves updated browser source through native HMR without restarting', async () => {
  const directory = fixture()
  const app = await useApplication({
    cwd: directory,
    development: true,
    entry: './serve.ts',
    persistent: false,
    timeoutMs: 120_000,
  })

  try {
    await app.visit('/', async page => {
      await page.waitForSelector('h1')
      expect(await page.textContent('h1')).toBe('Application')
      const source = readFileSync(join(directory, 'Application.tsx'), 'utf8')
      writeFileSync(join(directory, 'Application.tsx'), source.replace('Application</h1>', 'Application Updated</h1>'))
      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application Updated',
        undefined,
        { timeout: 30_000 },
      )
      writeFileSync(join(directory, 'Application.tsx'), source)
      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application',
        undefined,
        { timeout: 30_000 },
      )
    })
  } finally {
    await app.stop()
  }
}, 120_000)
