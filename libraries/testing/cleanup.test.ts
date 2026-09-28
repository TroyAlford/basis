import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneDirectory, pruneSnapshots } from './cleanup'

/**
 * Build a throwaway snapshot directory populated with the given filenames.
 * @param names - The filenames to create.
 * @returns The directory path.
 */
function snapshotDir(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'basis-snapshots-'))
  for (const name of names) writeFileSync(join(dir, name), name)
  return dir
}

/**
 * List the sorted filenames in a directory.
 * @param dir - The directory to read.
 * @returns The sorted filenames.
 */
const entries = (dir: string): string[] => readdirSync(dir).sort()

describe('testing/cleanup', () => {
  test('removes snapshots that were not touched', () => {
    const dir = snapshotDir('kept-1.png', 'orphan-1.png', 'orphan-2.png')

    const removed = pruneDirectory(dir, new Set([join(dir, 'kept-1.png')]))

    expect(removed.sort()).toEqual([join(dir, 'orphan-1.png'), join(dir, 'orphan-2.png')])
    expect(entries(dir)).toEqual(['kept-1.png'])
    rmSync(dir, { force: true, recursive: true })
  })

  test('keeps transient actual and diff artifacts', () => {
    const dir = snapshotDir(
      'kept-1.actual.png',
      'kept-1.diff.png',
      'kept-1.png',
      'orphan-1.actual.png',
    )

    pruneDirectory(dir, new Set([join(dir, 'kept-1.png')]))

    expect(entries(dir)).toEqual([
      'kept-1.actual.png',
      'kept-1.diff.png',
      'kept-1.png',
      'orphan-1.actual.png',
    ])
    rmSync(dir, { force: true, recursive: true })
  })

  test('ignores a missing directory', () => {
    expect(pruneDirectory(join(tmpdir(), 'basis-snapshots-missing'), new Set())).toEqual([])
  })

  test('never deletes a committed baseline unless updating', () => {
    const dir = snapshotDir('kept-1.png', 'orphan-1.png')
    const seen = new Set([join(dir, 'kept-1.png')])

    const removed = pruneSnapshots({ directories: [dir], seen, updating: false })

    expect(removed).toEqual([])
    expect(entries(dir)).toEqual(['kept-1.png', 'orphan-1.png'])
    rmSync(dir, { force: true, recursive: true })
  })

  test('prunes orphaned baselines only when updating', () => {
    const dir = snapshotDir('kept-1.png', 'orphan-1.png')
    const seen = new Set([join(dir, 'kept-1.png')])

    const removed = pruneSnapshots({ directories: [dir], seen, updating: true })

    expect(removed).toEqual([join(dir, 'orphan-1.png')])
    expect(entries(dir)).toEqual(['kept-1.png'])
    rmSync(dir, { force: true, recursive: true })
  })
})
