import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { cleanupTempDirectories, tempDirectory } from './temp'

describe('tempDirectory', () => {
  test('nests every directory under one run-scoped root', () => {
    const first = tempDirectory('one')
    const second = tempDirectory('two')

    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(dirname(first)).toBe(dirname(second))
  })

  test('removes the root and every child, and recreates it on demand', () => {
    const directory = tempDirectory('cleanup')
    const root = dirname(directory)

    cleanupTempDirectories()

    expect(existsSync(root)).toBe(false)
    expect(existsSync(directory)).toBe(false)

    const recreated = tempDirectory('again')
    expect(existsSync(recreated)).toBe(true)
    expect(dirname(recreated)).not.toBe(root)
  })

  test('removes a base directory it created once empty', () => {
    const base = join(tmpdir(), `basis-base-${process.pid}-${Date.now()}`)
    const directory = tempDirectory('seeded', base)

    expect(existsSync(directory)).toBe(true)

    cleanupTempDirectories()

    expect(existsSync(base)).toBe(false)
  })
})
