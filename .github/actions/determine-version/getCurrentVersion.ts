import { $ } from 'bun'

/**
 * Get the current version from the git repository.
 * This function will:
 * 1. Unshallow the repository if needed
 * 2. Fetch all tags
 * 3. Return the latest version tag
 * @returns The current version string (e.g. 'v1.2.3')
 */
export async function getCurrentVersion(): Promise<string> {
  try {
    // First unshallow the repository
    await $`git fetch --unshallow origin`.quiet().nothrow()
    // Then fetch main and tags
    await $`git fetch origin main:main`.quiet().nothrow()
    await $`git fetch --tags --force origin`.quiet()

    // Get latest tag, sorted by version number
    const latestTag = await $`git tag -l | sort -V | tail -n 1`
      .quiet().text().then(v => v.trim())

    return latestTag || 'v0.0.0'
  } catch {
    return 'v0.0.0'
  }
}

/**
 * Get the commit hash of the current version tag
 * @returns The commit hash of the current version
 */
export async function getCurrentVersionCommit(): Promise<string> {
  const currentVersion = await getCurrentVersion()
  if (currentVersion === 'v0.0.0') return ''

  return await $`git rev-list -n 1 ${currentVersion}`
    .quiet().text().then(v => v.trim()).catch(() => '')
}
