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
    if (!lastTag.trim()) {
      return (await $`git ls-files`.text())
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    }

    const tag = lastTag.trim()
    const head = (await $`git rev-parse HEAD`.text()).trim()
    const tagCommit = (await $`git rev-parse ${tag}`.text()).trim()

    const committedChanges = (await $`git diff --name-only ${tagCommit} ${head}`.text()).split('\n')
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
