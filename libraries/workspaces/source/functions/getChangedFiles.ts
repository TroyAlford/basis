import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository
 * @returns The list of changed files
 */
export async function getChangedFiles(): Promise<string[]> {
  try {
    await fetchAllTags()

    // SCENARIO 1: Try to find merge base with main
    const mergeBaseResult = await $`git merge-base HEAD origin/main`
      .quiet().nothrow()
    if (mergeBaseResult.exitCode === 0) {
      const mergeBase = mergeBaseResult.stdout.toString().trim()
      const committedResult = await $`git diff --name-only ${mergeBase}..HEAD`
        .quiet().nothrow()
      const stagedResult = await $`git diff --name-only --cached`
        .quiet().nothrow()
      const unstagedResult = await $`git diff --name-only`
        .quiet().nothrow()

      const committedChanges = committedResult.exitCode === 0
        ? committedResult.stdout.toString().split('\n')
        : []
      const stagedChanges = stagedResult.exitCode === 0
        ? stagedResult.stdout.toString().split('\n')
        : []
      const unstagedChanges = unstagedResult.exitCode === 0
        ? unstagedResult.stdout.toString().split('\n')
        : []

      return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
        .map(line => line.trim())
        .filter(Boolean)
    }

    // SCENARIO 2: Try using latest tag
    const tagResult = await $`git describe --tags --abbrev=0`
      .quiet().nothrow()
    if (tagResult.exitCode === 0) {
      const tag = tagResult.stdout.toString().trim()
      const headResult = await $`git rev-parse HEAD`
        .quiet().nothrow()
      if (headResult.exitCode !== 0) return []

      const head = headResult.stdout.toString().trim()
      const committedResult = await $`git diff --name-only ${tag}..${head}`
        .quiet().nothrow()
      const stagedResult = await $`git diff --name-only --cached`
        .quiet().nothrow()
      const unstagedResult = await $`git diff --name-only`
        .quiet().nothrow()

      const committedChanges = committedResult.exitCode === 0
        ? committedResult.stdout.toString().split('\n')
        : []
      const stagedChanges = stagedResult.exitCode === 0
        ? stagedResult.stdout.toString().split('\n')
        : []
      const unstagedChanges = unstagedResult.exitCode === 0
        ? unstagedResult.stdout.toString().split('\n')
        : []

      return [...new Set([...committedChanges, ...stagedChanges, ...unstagedChanges])]
        .map(line => line.trim())
        .filter(Boolean)
    }

    // SCENARIO 3: Use initial commit
    const firstCommitResult = await $`git rev-list --max-parents=0 HEAD`
      .quiet().nothrow()
    if (firstCommitResult.exitCode !== 0) return []

    const firstCommit = firstCommitResult.stdout.toString().trim()
    if (!firstCommit) return []

    console.error('Debug: Using initial commit:', firstCommit)

    // Use git ls-files instead of diff when comparing against initial commit
    const allFilesResult = await $`git ls-files`
      .quiet().nothrow()
    if (allFilesResult.exitCode !== 0) return []

    console.error('Debug: All tracked files:', allFilesResult.stdout.toString())

    return allFilesResult.stdout.toString().split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
