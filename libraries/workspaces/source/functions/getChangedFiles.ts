/* eslint-disable no-console */
import { $ } from 'bun'
import { fetchAllTags } from './fetchAllTags'

/**
 * Get the changed files in the git repository
 * @param base - The base commit to compare against
 * @returns The list of changed files
 */
export async function getChangedFiles(base = 'main'): Promise<string[]> {
  try {
    console.log('\nChecking for changed files...')

    await fetchAllTags()
    console.log('Fetched all tags')

    await $`git fetch origin ${base}:${base}`.quiet().nothrow()
    console.log(`Fetched ${base} branch`)

    // Log current git status
    console.log('\nGit Status:')
    console.log('Current SHA:', (await $`git rev-parse HEAD`.text()).trim())
    console.log('Current branch:', (await $`git rev-parse --abbrev-ref HEAD`.text()).trim())

    // Get all tags sorted by version
    const tags = (await $`git tag -l`.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.replace('v', '').split('.').map(Number)
        const [bMajor, bMinor, bPatch] = b.replace('v', '').split('.').map(Number)
        return (bMajor - aMajor) || (bMinor - aMinor) || (bPatch - aPatch)
      })

    console.log('All tags:', tags.join(', '))
    console.log('Tag count:', tags.length)

    // Check if we're at the tip of the base branch
    const baseRef = await $`git rev-parse origin/${base}`.quiet().text()
    const headRef = await $`git rev-parse HEAD`.quiet().text()
    const isAtBaseTip = baseRef.trim() === headRef.trim()

    console.log('\nRef Comparison:')
    console.log(`Base ref (origin/${base}):`, baseRef.trim())
    console.log('Head ref:', headRef.trim())
    console.log('Is at base tip:', isAtBaseTip)

    let compareRef: string
    if (isAtBaseTip) {
      /*
       * If we're at the tip and have tags, compare with latest tag
       * Otherwise fall back to previous commit
       */
      compareRef = tags.length > 0 ? tags[0] : 'HEAD~1'
      console.log('\nOn base branch, comparing with:', compareRef)
      if (compareRef === 'HEAD~1') {
        console.log('Warning: No tags found, falling back to previous commit')
      }
    } else {
      // If we're not at the tip, compare with main branch
      compareRef = `origin/${base}`
      console.log('\nNot on base branch, comparing with:', compareRef)
    }

    // Get changes between base and current branch
    const committed = await $`git diff --name-only ${compareRef}..HEAD`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])
    const staged = await $`git diff --name-only --cached`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])
    const unstaged = await $`git diff --name-only`
      .quiet().nothrow().text().then(t => t.split('\n')).catch(() => [])

    console.log('\nFound changes:')
    console.log('Committed:', committed.length)
    console.log('Staged:', staged.length)
    console.log('Unstaged:', unstaged.length)

    const changes = [...new Set([...committed, ...staged, ...unstaged])]
      .map(line => line.trim())
      .filter(Boolean)

    console.log('\nTotal unique changes:', changes.length)
    if (changes.length > 0) {
      console.log('Changed files:', changes.join(', '))
    }

    return changes
  } catch (error) {
    console.error('\nError in getChangedFiles:', error)
    return []
  }
}
