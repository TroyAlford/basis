/* eslint-disable no-console */
import { $ } from 'bun'
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
 * @param version - The version string
 * @returns The parsed version
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
 * @returns The formatted version string
 */
function formatVersion(version: Version): string {
  return `v${version.major}.${version.minor}.${version.patch}`
}

/**
 * Get the current version from the git repository
 * @returns The current version
 */
async function getCurrentVersion(): Promise<string> {
  try {
    const { stdout } = await Bun.spawn(['git', 'describe', '--tags', '--abbrev=0'], {
      stdout: 'pipe',
    })
    return new TextDecoder().decode(await stdout.getReader().read().then(r => r.value)) || 'v0.0.0'
  } catch {
    return 'v0.0.0'
  }
}

/** Determine the next version based on the unreleased commit messages */
async function main() {
  const commits = await getUnreleasedCommitMessages()
  if (commits.length === 0) {
    console.log('No unreleased commits found')
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

  const currentVersion = await getCurrentVersion()
  const version = parseVersion(currentVersion)

  // Check for breaking changes
  if (commits.some(commit => commit.breaking)) {
    version.major++
    version.minor = 0
    version.patch = 0
  } else if (commits.some(commit => isMinorChange(commit.type))) {
    version.minor++
    version.patch = 0
  } else if (commits.some(commit => isPatchChange(commit.type))) {
    version.patch++
  } else {
    // No version bump needed
    console.log('No version bump needed')
    process.exit(0)
  }

  const nextVersion = formatVersion(version)
  await $`echo "version=${nextVersion}" >> $GITHUB_OUTPUT`
  await $`echo "released=true" >> $GITHUB_OUTPUT`
}

main().catch(error => {
  console.error('Failed to determine next version:', error)
  process.exit(1)
})
