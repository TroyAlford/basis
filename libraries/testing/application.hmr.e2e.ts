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
    "import { appendFileSync } from 'node:fs'",
    `import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}`,
    '',
    "import { join } from 'node:path'",
    "appendFileSync(process.env.BASIS_APP_ACTIVITY ?? join(import.meta.dir, 'activity.log'), `${process.pid}\n`)",
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
  const preload = JSON.stringify(join(repoRoot, 'libraries', 'testing', 'bun.ts'))
  writeFileSync(join(directory, 'bunfig.toml'), `[test]\npreload = [${preload}]\n`)
  writeFileSync(join(directory, 'verify.e2e.ts'), [
    "import { expect, test } from 'bun:test'",
    `import { useApplication } from ${JSON.stringify(join(import.meta.dir, 'application.ts'))}`,
    '',
    "test('serves the current source', async () => {",
    '  const app = await useApplication({',
    "    cwd: import.meta.dir, entry: './serve.ts',",
    '    persistent: true, timeoutMs: 120_000,',
    '  })',
    "  await app.visit('/', async page => {",
    "    await page.waitForSelector('h1')",
    "    expect(await page.textContent('h1')).toBe(process.env.EXPECTED)",
    '  })',
    '}, 120_000)',
  ].join('\n'))
  return directory
}

/**
 * Run the fixture's child test in a separate Bun invocation.
 * @param directory - Fixture directory.
 * @param expected - Expected h1 text.
 * @returns The child exit code and output.
 */
async function runChild(directory: string, expected: string): Promise<{ code: number, output: string }> {
  const proc = Bun.spawn([process.execPath, 'test', './verify.e2e.ts'], {
    cwd: directory,
    env: {
      ...process.env,
      BASIS_APPLICATION_FIXTURE_EPHEMERAL: '0',
      BASIS_APPLICATION_FIXTURE_ROOT: join(directory, 'fixture'),
      BASIS_APP_ACTIVITY: join(directory, 'activity.log'),
      BASIS_SNAPSHOT_FIXTURE_EPHEMERAL: '1',
      EXPECTED: expected,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const output = await new Response(proc.stdout).text() + await new Response(proc.stderr).text()
  return { code: await proc.exited, output }
}

test('persists a server across invocations and serves edited source', async () => {
  const directory = fixture()
  const applicationFile = join(directory, 'Application.tsx')
  const source = readFileSync(applicationFile, 'utf8')
  const activity = join(directory, 'activity.log')
  try {
    const first = await runChild(directory, 'Application')
    expect(first.code).toBe(0)
    const firstBoots = readFileSync(activity, 'utf8').trim().split('\n').filter(Boolean)
    expect(firstBoots).toHaveLength(1)

    writeFileSync(applicationFile, source.replace('Application</h1>', 'Application Updated</h1>'))
    const second = await runChild(directory, 'Application Updated')
    expect(second.code).toBe(0)
    const secondBoots = readFileSync(activity, 'utf8').trim().split('\n').filter(Boolean)
    expect(secondBoots).toHaveLength(1)
    const pid = Number(secondBoots[0])
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // The detached process may already be gone.
      }
    }
  } finally {
    writeFileSync(applicationFile, source)
  }
}, 120_000)

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
      writeFileSync(
        join(directory, 'Application.tsx'),
        source.replace('Application</h1>', 'Application Recovered</h1>'),
      )
      await page.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Application Recovered',
        undefined,
        { timeout: 30_000 },
      )
      writeFileSync(join(directory, 'Application.tsx'), source)
    })
  } finally {
    await app.stop()
  }
}, 120_000)
