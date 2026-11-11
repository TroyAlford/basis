/**
 * Resolve one Git revision to an immutable commit id.
 * @param ref - User-supplied revision.
 * @returns Full commit SHA.
 * @throws {Error} When Git cannot resolve the revision.
 */
export function resolveRevision(ref: string): string {
  const result = Bun.spawnSync(['git', 'rev-parse', '--verify', `${ref}^{commit}`], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || `git rev-parse exited ${result.exitCode}`
    throw new Error(`Invalid migration base revision "${ref}": ${detail}`)
  }
  const revision = result.stdout.toString().trim()
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error(`Invalid migration base revision "${ref}": Git returned "${revision}"`)
  }
  return revision
}

/**
 * Read one file from a Git revision.
 * @param ref - Full commit id.
 * @param path - Repository-relative path.
 * @returns File content, or null only when the path is absent at that commit.
 * @throws {Error} When Git cannot inspect or read the revision.
 */
export function gitFile(ref: string, path: string): string | null {
  const object = `${ref}:${path}`
  const tree = Bun.spawnSync(['git', 'ls-tree', '--name-only', ref, '--', path], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (tree.exitCode !== 0) {
    const detail = tree.stderr.toString().trim() || `git ls-tree exited ${tree.exitCode}`
    throw new Error(`Git could not inspect ${object}: ${detail}`)
  }
  if (tree.stdout.toString().trim().length === 0) return null
  const result = Bun.spawnSync(['git', 'show', object], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || `git show exited ${result.exitCode}`
    throw new Error(`Git could not read ${object}: ${detail}`)
  }
  return result.stdout.toString()
}

/**
 * List files beneath one repository path at a Git revision.
 * @param ref - Full commit id.
 * @param path - Repository-relative directory.
 * @returns Repository-relative paths.
 * @throws {Error} When Git cannot list the revision.
 */
export function gitFiles(ref: string, path: string): string[] {
  const result = Bun.spawnSync(['git', 'ls-tree', '-r', '--name-only', ref, '--', path], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || `git ls-tree exited ${result.exitCode}`
    throw new Error(`Git could not list ${ref}:${path}: ${detail}`)
  }
  return result.stdout.toString().split('\n').filter(Boolean)
}
