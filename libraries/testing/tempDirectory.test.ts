import { run } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { tempDirectory, tempRoot } from './tempDirectory'

const modulePath = join(import.meta.dir, 'tempDirectory.ts')

describe('project temp directory', () => {
  test('the preload points os.tmpdir() at ./.basis/tmp', () => {
    expect(tmpdir()).toBe(join(process.cwd(), '.basis', 'tmp'))
    expect(tmpdir()).toBe(tempRoot())
  })

  test('tempDirectory creates a deterministic directory under that root', () => {
    const directory = tempDirectory('named')

    expect(directory).toBe(join(tempRoot(), 'named'))
    expect(existsSync(directory)).toBe(true)
    expect(tempDirectory('named')).toBe(join(tempRoot(), 'named-2'))
  })

  test('captures a plain os.tmpdir() write, not just tempDirectory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'plain-'))

    expect(dirname(directory)).toBe(tmpdir())
  })

  test('cleanup removes the root and restores the temp environment', () => {
    const base = tempDirectory('cleanup-base')
    const script = `
      import { existsSync, mkdtempSync } from 'node:fs'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { cleanupTempDirectories, isolateTempDirectories, tempDirectory } from ${JSON.stringify(modulePath)}
      const before = process.env.TMPDIR
      const root = isolateTempDirectories()
      const directory = tempDirectory('probe')
      const plain = mkdtempSync(join(tmpdir(), 'plain-'))
      const result = {
        deterministic: directory === join(root, 'probe'),
        nested: plain.startsWith(root + '/'),
        root: root === join(process.cwd(), '.basis', 'tmp'),
      }
      cleanupTempDirectories()
      result.restored = process.env.TMPDIR === before
      result.rootGone = !existsSync(root)
      console.log(JSON.stringify(result))
    `
    const result = run('bun', ['-e', script], {
      cwd: base,
      env: process.env as Record<string, string>,
    })
    const line = result.stdout.trim().split('\n').pop() ?? ''

    expect(JSON.parse(line)).toEqual({
      deterministic: true,
      nested: true,
      restored: true,
      root: true,
      rootGone: true,
    })
  })
})
