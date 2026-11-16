import { run } from 'basis/utilities'

/**
 * Resolve one Git revision to an immutable commit id.
 * @param ref - User-supplied revision.
 * @returns Full commit SHA.
 * @throws {Error} When Git cannot resolve the revision.
 */
export function resolveRevision(ref: string): string {
  const result = run('git', ['rev-parse', '--verify', `${ref}^{commit}`])
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `git rev-parse exited ${result.exitCode}`
    throw new Error(`Invalid migration base revision "${ref}": ${detail}`)
  }
  const revision = result.stdout.trim()
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
  const tree = run('git', ['ls-tree', '--name-only', ref, '--', path])
  if (tree.exitCode !== 0) {
    const detail = tree.stderr.trim() || `git ls-tree exited ${tree.exitCode}`
    throw new Error(`Git could not inspect ${object}: ${detail}`)
  }
  if (tree.stdout.trim().length === 0) return null
  const result = run('git', ['show', object])
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `git show exited ${result.exitCode}`
    throw new Error(`Git could not read ${object}: ${detail}`)
  }
  return result.stdout
}

/**
 * List files beneath one repository path at a Git revision.
 * @param ref - Full commit id.
 * @param path - Repository-relative directory.
 * @returns Repository-relative paths.
 * @throws {Error} When Git cannot list the revision.
 */
export function gitFiles(ref: string, path: string): string[] {
  const result = run('git', ['ls-tree', '-r', '--name-only', ref, '--', path])
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `git ls-tree exited ${result.exitCode}`
    throw new Error(`Git could not list ${ref}:${path}: ${detail}`)
  }
  return result.stdout.split('\n').filter(Boolean)
}
