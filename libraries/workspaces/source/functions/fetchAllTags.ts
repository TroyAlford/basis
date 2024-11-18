import { $ } from 'bun'

/** Fetch all tags from the origin repository */
export async function fetchAllTags(): Promise<void> {
  await $`git fetch --tags origin`.quiet()
}
