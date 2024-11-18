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
     * SCENARIO 1: Try to find merge base with main
     * This will work if we're on a branch that was created from main
     * or if we're on main itself
     */
    const mergeBaseResult = await $`git merge-base HEAD origin/main`.nothrow()
    if (mergeBaseResult.exitCode === 0) {
      const mergeBase = mergeBaseResult.stdout.toString().trim()
      console.log('Found merge base with main:', mergeBase)

      /*
       * Get three types of changes:
       * 1. Committed changes since the branch diverged from main
       */
      const committedResult = await $`git diff --name-only ${mergeBase}..HEAD`.nothrow()
      const committedChanges = committedResult.exitCode === 0
        ? committedResult.stdout.toString().split('\n')
        : []

      // 2. Changes staged but not committed
      const stagedResult = await $`git diff --name-only --cached`.nothrow()
      const stagedChanges = stagedResult.exitCode === 0
        ? stagedResult.stdout.toString().split('\n')
        : []

      // 3. Changes in working directory, not staged
      const unstagedResult = await $`git diff --name-only`.nothrow()
      const unstagedChanges = unstagedResult.exitCode === 0
        ? unstagedResult.stdout.toString().split('\n')
        : []

      // Combine all changes, remove duplicates and empty lines
      return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
        .map(line => line.trim())
        .filter(Boolean)
    }

    /*
     * SCENARIO 2: No merge base found, try using latest tag
     * This is typically used when we're in a detached HEAD state
     * or when the branch history is complex
     */
    const tagResult = await $`git describe --tags --abbrev=0`.nothrow()
    if (tagResult.exitCode === 0) {
      const tag = tagResult.stdout.toString().trim()
      const headResult = await $`git rev-parse HEAD`.nothrow()
      if (headResult.exitCode !== 0) {
        console.error('Failed to get HEAD commit')
        return []
      }
      const head = headResult.stdout.toString().trim()
      console.log('Using latest tag for comparison:', tag)

      /*
       * Get all types of changes since the last tag:
       * 1. Committed changes since the tag
       */
      const committedResult = await $`git diff --name-only ${tag}..${head}`.nothrow()
      const committedChanges = committedResult.exitCode === 0
        ? committedResult.stdout.toString().split('\n')
        : []

      // 2. Changes staged but not committed
      const stagedResult = await $`git diff --name-only --cached`.nothrow()
      const stagedChanges = stagedResult.exitCode === 0
        ? stagedResult.stdout.toString().split('\n')
        : []

      // 3. Changes in working directory, not staged
      const unstagedResult = await $`git diff --name-only`.nothrow()
      const unstagedChanges = unstagedResult.exitCode === 0
        ? unstagedResult.stdout.toString().split('\n')
        : []

      // Combine all changes, remove duplicates and empty lines
      return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
        .map(line => line.trim())
        .filter(Boolean)
    }

    /*
     * SCENARIO 3: No tags exist yet
     * This is typically only on initial repository setup
     * Compare against the very first commit
     */
    console.warn('No merge base or tags found - comparing against initial commit')
    const firstCommitResult = await $`git rev-list --max-parents=0 HEAD`.nothrow()
    if (firstCommitResult.exitCode !== 0) {
      console.error('Failed to find initial commit')
      return []
    }

    // Compare everything since the first commit
    const committedResult = await $`git diff --name-only ${firstCommitResult.stdout.toString().trim()}..HEAD`.nothrow()
    const committedChanges = committedResult.exitCode === 0
      ? committedResult.stdout.toString().split('\n')
      : []

    return committedChanges
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    console.error('Error getting changed files:', error)
    return []
  }
}
