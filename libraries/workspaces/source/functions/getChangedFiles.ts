import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository
 * @param base - The base commit to compare against
 * @returns The list of changed files
 */
export async function getChangedFiles(
  base = 'main',
): Promise<string[]> {
  try {
    await fetchAllTags()
    await $`git fetch origin ${base}:${base}`.quiet().nothrow()

    // Check if we're at the tip of the base branch
    const baseRef = await $`git rev-parse origin/${base}`.quiet().text()
    const headRef = await $`git rev-parse HEAD`.quiet().text()
    const isAtBaseTip = baseRef.trim() === headRef.trim()

    let compareRef: string
    if (isAtBaseTip) {
      // If we're at the tip, compare with the latest release tag
      const latestTag = await $`git describe --tags --abbrev=0`.quiet().nothrow().text().catch(() => '')
      compareRef = latestTag.trim() || 'HEAD~1' // Fallback to previous commit if no tags exist
    } else {
      // If we're not at the tip, compare with main branch
      compareRef = `origin/${base}`
    }

    // Get changes between base and current branch
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
