import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { tempDirectory } from './temp'

const modulePath = join(import.meta.dir, 'temp.ts')

describe('isolated temp directory', () => {
  test('the preload points os.tmpdir() at a run-scoped root', () => {
    expect(basename(tmpdir()).startsWith('basis-run-')).toBe(true)
  })

  test('tempDirectory creates a named directory under that root', () => {
    const directory = tempDirectory('named')

    expect(existsSync(directory)).toBe(true)
    expect(dirname(directory)).toBe(tmpdir())
    expect(basename(directory).startsWith('named-')).toBe(true)
  })

  test('captures a plain os.tmpdir() write, not just tempDirectory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'plain-'))

    expect(dirname(directory)).toBe(tmpdir())
    expect(existsSync(directory)).toBe(true)
  })

  test('cleanup removes the root and restores the temp environment', () => {
    const script = `
      import { existsSync, mkdtempSync } from 'node:fs'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { cleanupTempDirectories, isolateTempDirectories } from ${JSON.stringify(modulePath)}
      const before = process.env.TMPDIR
      const root = isolateTempDirectories()
      const directory = mkdtempSync(join(tmpdir(), 'probe-'))
      const nested = directory.startsWith(root + '/')
      cleanupTempDirectories()
      console.log(JSON.stringify({
        nested,
        restored: process.env.TMPDIR === before,
        rootGone: !existsSync(root),
      }))
    `
    const result = Bun.spawnSync(['bun', '-e', script], { env: process.env })
    const line = result.stdout.toString().trim().split('\n').pop() ?? ''

    expect(JSON.parse(line)).toEqual({ nested: true, restored: true, rootGone: true })
  })
})
