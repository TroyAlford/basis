import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository
 * @param base - The base commit to compare against
 * @returns The list of changed files
 */
export async function getChangedFiles(base = 'main'): Promise<string[]> {
  try {
    await fetchAllTags()
    await $`git fetch origin ${base}:${base}`.quiet().nothrow()

    // Get latest tag by version number (using proper semver sorting)
    const latestTag = await $`git tag -l | sort -V | tail -n 1`
      .quiet().nothrow().text().then(t => t.trim()).catch(() => '')

    // Check if we're at the tip of the base branch
    const baseRef = await $`git rev-parse origin/${base}`.quiet().text()
    const headRef = await $`git rev-parse HEAD`.quiet().text()
    const isAtBaseTip = baseRef.trim() === headRef.trim()

    /*
     * When on the base branch (e.g. main):
     * - Compare against the latest tag if one exists
     * - Fall back to previous commit only if no tags exist
     * Otherwise compare against the base branch
     */
    const compareRef = isAtBaseTip
      ? (latestTag || 'HEAD~1')
      : `origin/${base}`

    // Get all changes
    const committed = await $`git diff --name-only ${compareRef}..HEAD`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])
    const staged = await $`git diff --name-only --cached`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])
    const unstaged = await $`git diff --name-only`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])

    return [...new Set([...committed, ...staged, ...unstaged])]
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
