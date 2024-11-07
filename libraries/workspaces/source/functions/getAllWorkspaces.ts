import { getWorkspaceInfo } from './getWorkspaceInfo'

/**
 * Get all workspaces in the monorepo
 * @returns The names of all workspaces
 */
export async function getAllWorkspaces(): Promise<string[]> {
  const { packages } = await getWorkspaceInfo()
  return Array.from(packages.keys())
}
