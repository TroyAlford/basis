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

    // Get changes between main and current branch
    const committed = await $`git diff --name-only origin/${base}..HEAD`
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
