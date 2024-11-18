import { $ } from 'bun'

/** Fetch all tags from the origin repository */
export async function fetchAllTags(): Promise<void> {
  await $`git fetch --prune --tags origin`.text()
}
