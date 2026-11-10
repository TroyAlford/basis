import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { directories } from './directories'

/**
 * Run one assertion inside an isolated working directory.
 * @param work - Test body.
 */
async function inDirectory(work: (root: string) => Promise<void>): Promise<void> {
  const previous = process.cwd()
  const root = await mkdtemp(join(tmpdir(), 'basis-directories-'))
  process.chdir(root)
  try {
    await work(root)
  } finally {
    process.chdir(previous)
    await rm(root, { force: true, recursive: true })
  }
}

describe('directories', () => {
  test('reads a missing JSON file as null and round-trips explicit null', async () => {
    await inDirectory(async () => {
      const database = directories('database')
      expect(await database.json('missing.json')).toBeNull()
      expect(await database.json('null.json', null)).toBeNull()
      expect(await database.json('null.json')).toBeNull()
    })
  })

  test('writes atomically and honors file modes', async () => {
    await inDirectory(async () => {
      const database = directories('database')
      const value = { name: 'basis', nested: { enabled: true } }
      expect(await database.json('state.json', value)).toEqual(value)
      expect(await database.json<typeof value>('state.json')).toEqual(value)
      const file = await database.file('state.json')
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
    })
  })

  test('rejects traversal and absolute segments', async () => {
    await inDirectory(async () => {
      expect(() => directories('../database')).toThrow('Invalid directory segment')
      expect(() => directories('/database')).toThrow('Invalid directory segment')
      const database = directories('database')
      expect(database.json('../escape.json')).rejects.toThrow('Invalid file segment')
      expect(database.json('/escape.json')).rejects.toThrow('Invalid file segment')
    })
  })

  test('creates only the requested directory and preserves an existing ignore file', async () => {
    await inDirectory(async root => {
      const database = directories('database')
      await database.ensure()
      const ignore = join(root, '.basis', 'database', '.gitignore')
      await writeFile(ignore, 'custom\n')
      await database.ensure()
      expect(await readFile(ignore, 'utf8')).toBe('custom\n')
      await expect(stat(join(root, '.basis', 'backups'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})
