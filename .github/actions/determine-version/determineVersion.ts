/* eslint-disable no-console */
import { $ } from 'bun'
import { getCurrentVersion } from './getCurrentVersion'
import { getUnreleasedCommitMessages, isMinorChange, isPatchChange } from './getUnreleasedCommitMessages'

/** A semantic version number */
interface Version {
  /** The major version number, incremented for breaking changes */
  major: number,
  /** The minor version number, incremented for new features */
  minor: number,
  /** The patch version number, incremented for bug fixes */
  patch: number,
}

/**
 * Parse a version string into its component parts
 * @param version - The version string to parse (e.g. 'v1.2.3')
 * @returns A Version object containing the major, minor, and patch numbers
 * @example
 * parseVersion('v1.2.3') // { major: 1, minor: 2, patch: 3 }
 * parseVersion('v0.0.0') // { major: 0, minor: 0, patch: 0 }
 */
function parseVersion(version: string): Version {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map(Number)
  return { major, minor, patch }
}

/**
 * Format a Version object into a version string
 * @param version - The Version object to format
 * @returns A version string prefixed with 'v' (e.g. 'v1.2.3')
 * @example
 * formatVersion({ major: 1, minor: 2, patch: 3 }) // 'v1.2.3'
 * formatVersion({ major: 0, minor: 0, patch: 0 }) // 'v0.0.0'
 */
function formatVersion(version: Version): string {
  return `v${version.major}.${version.minor}.${version.patch}`
}

/**
 * Determines if a new version is needed based on conventional commits, and if so, what that version should be.
 * Outputs three GitHub Action variables:
 * - current-version: The current version from git tags
 * - next-version: The computed next version (same as current if no release needed)
 * - release-needed: Whether a new release should be created
 *
 * Version numbers are incremented according to these rules:
 * - Major version: Incremented for breaking changes
 * - Minor version: Incremented for new features
 * - Patch version: Incremented for bug fixes
 *
 * If no version bump is needed, next-version will equal current-version and release-needed will be false.
 */
async function main() {
  const currentVersion = await getCurrentVersion()
  await $`echo "current-version=${currentVersion}" >> $GITHUB_OUTPUT`

  const commits = await getUnreleasedCommitMessages()
  if (commits.length === 0) {
    console.log('No unreleased commits found')
    await $`echo "release-needed=false" >> $GITHUB_OUTPUT`
    await $`echo "next-version=${currentVersion}" >> $GITHUB_OUTPUT`
    process.exit(0)
  }

  console.log('Unreleased commits found:')
  console.log(commits
    .filter(commit => commit.title)
    .map(commit => (
      commit.title.length > 75
        ? `${commit.type}: ${commit.title.slice(0, 75)}...`
        : `${commit.type}: ${commit.title}`
    ))
    .join('\n'))

  const version = parseVersion(currentVersion)
  let releaseNeeded = false

  // Determine version bump based on conventional commits
  if (commits.some(commit => commit.breaking)) {
    version.major++
    version.minor = 0
    version.patch = 0
    releaseNeeded = true
  } else if (commits.some(commit => isMinorChange(commit.type))) {
    version.minor++
    version.patch = 0
    releaseNeeded = true
  } else if (commits.some(commit => isPatchChange(commit.type))) {
    version.patch++
    releaseNeeded = true
  }

  const nextVersion = formatVersion(version)
  await $`echo "release-needed=${releaseNeeded}" >> $GITHUB_OUTPUT`
  await $`echo "next-version=${nextVersion}" >> $GITHUB_OUTPUT`
}

main().catch(error => {
  console.error('Failed to determine version:', error)
  process.exit(1)
})
