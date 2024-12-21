/* eslint-disable no-console */
import { $ } from 'bun'
import { getCurrentVersion } from './getCurrentVersion'
import { getUnreleasedCommitMessages, isMinorChange, isPatchChange } from './getUnreleasedCommitMessages'

/** A SemVer version */
interface Version {
  /** The major version */
  major: number,
  /** The minor version */
  minor: number,
  /** The patch version */
  patch: number,
}

/**
 * Parse a version string into a Version object
 * @param version - The version string (e.g. 'v1.2.3')
 * @returns The parsed version object
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
 * @param version - The Version object
 * @returns The formatted version string (e.g. 'v1.2.3')
 */
function formatVersion(version: Version): string {
  return `v${version.major}.${version.minor}.${version.patch}`
}

/** Determine the next version based on the unreleased commit messages */
async function main() {
  const currentVersion = await getCurrentVersion()
  await $`echo "current-version=${currentVersion}" >> $GITHUB_OUTPUT`

  const commits = await getUnreleasedCommitMessages()
  if (commits.length === 0) {
    console.log('No unreleased commits found')
    await $`echo "release-needed=false" >> $GITHUB_OUTPUT`
    await $`echo "next-version=${currentVersion}" >> $GITHUB_OUTPUT`
    process.exit(0)
  } else {
    console.log('Unreleased commits found:')
    console.log(commits
      .filter(commit => commit.title)
      .map(commit => (
        commit.title.length > 75
          ? `${commit.type}: ${commit.title.slice(0, 75)}...`
          : `${commit.type}: ${commit.title}`
      ))
      .join('\n'))
  }

  const version = parseVersion(currentVersion)
  let releaseNeeded = false

  // Check for breaking changes
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
  } else {
    console.log('No version bump needed')
  }

  const nextVersion = formatVersion(version)
  await $`echo "release-needed=${releaseNeeded}" >> $GITHUB_OUTPUT`
  await $`echo "next-version=${nextVersion}" >> $GITHUB_OUTPUT`
}

main().catch(error => {
  console.error('Failed to determine next version:', error)
  process.exit(1)
})
