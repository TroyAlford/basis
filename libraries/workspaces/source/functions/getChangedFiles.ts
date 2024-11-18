/* eslint-disable no-console */
import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository by comparing the current state
 * against the appropriate base (merge-base with main, latest tag, or initial commit)
 * @returns The list of changed files
 */
export async function getChangedFiles(): Promise<string[]> {
  try {
    // Make sure we have all tags from the remote
    await fetchAllTags()

    /*
     * SCENARIO 1: We're on a PR branch
     * Check if HEAD is NOT an ancestor of main (meaning we're on a branch)
     * exitCode of 1 means we're on a branch diverged from main
     */
    const hasMergeBase = (await $`git merge-base --is-ancestor HEAD origin/main`).exitCode === 1
    if (hasMergeBase) {
      // Find the common ancestor commit between our branch and main
      const mergeBase = await $`git merge-base HEAD origin/main`.text()

      /*
       * Get three types of changes:
       * 1. Committed changes since the branch diverged from main
       */
      const committedChanges = (await $`git diff --name-only ${mergeBase.trim()}..HEAD`.text()).split('\n')
      // 2. Changes staged but not committed
      const stagedChanges = (await $`git diff --name-only --cached`.text()).split('\n')
      // 3. Changes in working directory, not staged
      const unstagedChanges = (await $`git diff --name-only`.text()).split('\n')

      // Combine all changes, remove duplicates and empty lines
      return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
        .map(line => line.trim())
        .filter(Boolean)
    }

    /*
     * SCENARIO 2: We're on main branch or a tag
     * Try to get the most recent tag
     */
    const lastTag = await $`git describe --tags --abbrev=0`.text().catch(() => '')
    if (!lastTag.trim()) {
      // SCENARIO 3: No tags exist yet
      console.warn('No tags found and not a PR - comparing against initial commit')
      // Find the very first commit in the repository
      const firstCommit = await $`git rev-list --max-parents=0 HEAD`.text()
      // Compare everything since the first commit
      const committedChanges = (await $`git diff --name-only ${firstCommit.trim()}..HEAD`.text()).split('\n')
      return committedChanges
        .map(line => line.trim())
        .filter(Boolean)
    }

    // SCENARIO 2 (continued): We have a tag to compare against
    const tag = lastTag.trim()
    // Get the current commit hash
    const head = (await $`git rev-parse HEAD`.text()).trim()
    // Get the commit hash that the tag points to
    const tagCommit = (await $`git rev-parse ${tag}`.text()).trim()

    /*
     * Get all types of changes since the last tag:
     * 1. Committed changes since the tag
     */
    const committedChanges = (await $`git diff --name-only ${tagCommit} ${head}`.text()).split('\n')
    // 2. Staged changes
    const stagedChanges = (await $`git diff --name-only --cached`.text()).split('\n')
    // 3. Unstaged changes
    const unstagedChanges = (await $`git diff --name-only`.text()).split('\n')

    // Combine all changes, remove duplicates and empty lines
    return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    console.error('Error getting changed files:', error)
    return []
  }
}
