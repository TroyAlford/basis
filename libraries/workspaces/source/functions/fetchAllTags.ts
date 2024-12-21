import { $ } from 'bun'

/**
 * Fetch all tags from the remote repository
 */
export async function fetchAllTags(): Promise<void> {
  await $`git fetch --unshallow origin`.quiet().nothrow()
  await $`git fetch --tags --force origin`.quiet()
}
