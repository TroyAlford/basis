import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitFile, gitFiles, resolveRevision } from '../../scripts/migration-git'

/**
 * Run one assertion inside a temporary Git repository.
 * @param work - Test body.
 */
async function withRepository(work: (root: string) => Promise<void>): Promise<void> {
  const previous = process.cwd()
  const root = await mkdtemp(join(tmpdir(), 'basis-migration-git-'))
  process.chdir(root)
  try {
    Bun.spawnSync(['git', 'init', '-q'])
    Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'])
    Bun.spawnSync(['git', 'config', 'user.name', 'Basis Test'])
    await writeFile(join(root, 'graph.json'), '{}\n')
    Bun.spawnSync(['git', 'add', 'graph.json'])
    Bun.spawnSync(['git', 'commit', '-qm', 'initial'])
    await work(root)
  } finally {
    process.chdir(previous)
    await rm(root, { force: true, recursive: true })
  }
}

describe('migration Git snapshots', () => {
  test('resolves an existing commit and distinguishes absent paths', async () => {
    await withRepository(async root => {
      const revision = resolveRevision('HEAD')
      expect(revision).toMatch(/^[0-9a-f]{40}$/u)
      expect(gitFile(revision, 'graph.json')).toBe('{}\n')
      expect(gitFile(revision, 'missing.json')).toBeNull()
      expect(gitFiles(revision, 'missing')).toEqual([])
      expect(gitFiles(revision, '.')).toEqual(['graph.json'])
      await writeFile(join(root, 'graph.json'), '{}\n')
    })
  })

  test('rejects an invalid base revision instead of treating it as bootstrap', () => {
    expect(() => resolveRevision('does-not-exist')).toThrow(/Invalid migration base revision/u)
  })

  test('the CI entrypoint fails before release work for an invalid base', () => {
    const root = join(import.meta.dir, '..', '..')
    const result = Bun.spawnSync([process.execPath, 'scripts/check-migrations.ts', '--base', 'does-not-exist'], {
      cwd: root,
      stderr: 'pipe',
      stdout: 'pipe',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('Invalid migration base revision')
  })
})
