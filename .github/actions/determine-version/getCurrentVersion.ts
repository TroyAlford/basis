import { $ } from 'bun'

/**
 * Get the current version from the git repository
 * @returns The current version string (e.g. 'v1.2.3')
 */
export async function getCurrentVersion(): Promise<string> {
  try {
    return await $`git describe --tags --abbrev=0`.text().then(v => v.trim()) || 'v0.0.0'
  } catch {
    return 'v0.0.0'
  }
}
