/* eslint-disable no-console */
import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository
 * @returns The list of changed files
 */
export async function getChangedFiles(): Promise<string[]> {
  try {
    await fetchAllTags()
    const lastTag = await $`git describe --tags --abbrev=0`.text().catch(() => '')
    const committedChanges = lastTag.trim()
      ? (await $`git diff --name-only ${lastTag.trim()}..HEAD`.text()).split('\n')
      : []
    const stagedChanges = (await $`git diff --name-only --cached`.text()).split('\n')
    const unstagedChanges = (await $`git diff --name-only`.text()).split('\n')

    return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    console.error('Error getting changed files:', error)
    return []
  }
}
