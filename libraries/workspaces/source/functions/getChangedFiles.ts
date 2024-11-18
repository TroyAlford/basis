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
      console.error('Debug: Using merge base:', mergeBase)

      const committedResult = await $`git diff --name-only ${mergeBase}..HEAD`
        .quiet().nothrow()
      const stagedResult = await $`git diff --name-only --cached`
        .quiet().nothrow()
      const unstagedResult = await $`git diff --name-only`
        .quiet().nothrow()

      console.error('Debug: Committed changes:', committedResult.stdout.toString())
      console.error('Debug: Staged changes:', stagedResult.stdout.toString())
      console.error('Debug: Unstaged changes:', unstagedResult.stdout.toString())

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

    console.error('Debug: No merge base, trying tags')

    // SCENARIO 2: Try using latest tag
    const tagResult = await $`git describe --tags --abbrev=0`
      .quiet().nothrow()
    if (tagResult.exitCode === 0) {
      const tag = tagResult.stdout.toString().trim()
      console.error('Debug: Using tag:', tag)

      const headResult = await $`git rev-parse HEAD`
        .quiet().nothrow()
      if (headResult.exitCode !== 0) return []

      const head = headResult.stdout.toString().trim()
      console.error('Debug: Current HEAD:', head)

      const committedResult = await $`git diff --name-only ${tag}..${head}`
        .quiet().nothrow()
      console.error('Debug: Changes since tag:', committedResult.stdout.toString())

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

    console.error('Debug: No tags, trying initial commit')

    // SCENARIO 3: Use initial commit
    const firstCommitResult = await $`git rev-list --max-parents=0 HEAD`
      .quiet().nothrow()
    if (firstCommitResult.exitCode !== 0) return []

    const firstCommit = firstCommitResult.stdout.toString().trim()
    if (!firstCommit) return []

    console.error('Debug: Using initial commit:', firstCommit)

    const committedResult = await $`git diff --name-only ${firstCommit}..HEAD`
      .quiet().nothrow()
    console.error('Debug: Changes since initial commit:', committedResult.stdout.toString())

    if (committedResult.exitCode !== 0) return []

    return committedResult.stdout.toString().split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    console.error('Debug: Error:', error)
    return []
  }
}
