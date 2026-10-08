import { describe, expect, test } from 'bun:test'
import { watch } from 'chokidar'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WATCH_IGNORED } from './Builder'

describe('WATCH_IGNORED', () => {
  test('matches a dot entry by its basename, never an ancestor', () => {
    const dot = WATCH_IGNORED[0] as RegExp

    /*
     * A checkout under a hidden directory is still watched: the hidden segment
     * is an ancestor, not the entry being evaluated, so it must not match.
     */
    expect(dot.test('/home/me/.work/project/source/index.ts')).toBe(false)
    expect(dot.test('/home/me/.ai/agent/worktrees/project/source/index.ts')).toBe(false)

    // Dot entries inside the tree are still ignored, as dot files.
    expect(dot.test('/home/me/project/source/.env')).toBe(true)
    expect(dot.test('/home/me/project/source/.cache')).toBe(true)
  })
})

describe('the development watcher', () => {
  test('reports a change in a source directory under a hidden ancestor', async () => {
    const base = await mkdtemp(join(tmpdir(), 'basis-watcher-'))
    const source = join(base, '.hidden', 'source')
    await mkdir(source, { recursive: true })

    const file = join(source, 'index.ts')
    await writeFile(file, 'export const value = 1\n')

    const watcher = watch([source], {
      ignoreInitial: true,
      ignored: WATCH_IGNORED,
      persistent: true,
    })

    try {
      await new Promise<void>(resolve => watcher.once('ready', () => resolve()))

      const changed = new Promise<string>(resolve => watcher.once('change', resolve))
      await appendFile(file, '\nexport const next = 2\n')

      const changedPath = await Promise.race([
        changed,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('the watcher reported no change')), 5000)
        }),
      ])

      expect(changedPath.endsWith('index.ts')).toBe(true)
    } finally {
      await watcher.close()
      await rm(base, { force: true, recursive: true })
    }
  })
})
