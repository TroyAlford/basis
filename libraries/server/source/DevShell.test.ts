import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { devShellDirectory, renderDevShell, writeDevShell } from './DevShell'

const shellDir = '/tmp/basis-shell'

describe('devShellDirectory', () => {
  test('is deterministic for the same seed and distinct for others', () => {
    expect(devShellDirectory('app:/srv/app/index.tsx')).toBe(devShellDirectory('app:/srv/app/index.tsx'))
    expect(devShellDirectory('app:/srv/app/index.tsx')).not.toBe(devShellDirectory('app:/srv/other/index.tsx'))
    expect(isAbsolute(devShellDirectory('app'))).toBe(true)
  })
})

describe('renderDevShell', () => {
  test('renders a root mount point and a relative module script per entrypoint', () => {
    const entrypoints = ['/srv/app/index.tsx', '/srv/app/secondary.tsx']
    const html = renderDevShell({ directory: shellDir, entrypoints, title: 'My App' })

    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('<title>My App</title>')

    const sources = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(match => match[1])
    expect(sources).toHaveLength(2)
    for (const [index, source] of sources.entries()) {
      // The script src must resolve back to its entrypoint from the shell's directory.
      expect(join(shellDir, source)).toBe(entrypoints[index])
    }
  })

  test('prefixes bare relative script sources with ./', () => {
    const html = renderDevShell({ directory: shellDir, entrypoints: [join(shellDir, 'entry.ts')], title: 't' })

    expect(html).toContain('src="./entry.ts"')
  })

  test('never emits a bare filesystem separator in a URL', () => {
    const html = renderDevShell({ directory: shellDir, entrypoints: ['/srv/app/index.tsx'], title: 't' })

    expect(html).not.toContain('\\')
  })
})

describe('writeDevShell', () => {
  test('writes index.html into the shell directory and returns its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'basis-dev-shell-'))

    try {
      const entrypoint = join(dir, 'entry.ts')
      const file = writeDevShell({ directory: dir, entrypoints: [entrypoint], title: 'Written' })
      const html = await Bun.file(file).text()

      expect(file).toBe(join(dir, 'index.html'))
      expect(relative(dir, file)).toBe('index.html')
      expect(html).toContain('<title>Written</title>')
      expect(html).toContain('src="./entry.ts"')
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
