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

    // Check if we're on main branch
    const currentBranch = await $`git branch --show-current`.quiet().text()
    const isOnMain = currentBranch.trim() === 'main'

    let compareRef: string
    if (isOnMain) {
      // If we're on main, compare with the latest release tag
      const latestTag = await $`git describe --tags --abbrev=0`.quiet().nothrow().text().catch(() => '')
      compareRef = latestTag.trim() || 'HEAD~1' // Fallback to previous commit if no tags exist
    } else {
      // If we're not on main, compare with main branch
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
