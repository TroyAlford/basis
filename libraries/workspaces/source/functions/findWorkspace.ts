import type { Workspace } from '../types/Workspace'
import { getWorkspaceInfo } from './getWorkspaceInfo'

/**
 * Find a workspace by name
 * @param name - The name of the workspace
 * @returns The workspace or null if it doesn't exist
 */
export async function findWorkspace(name: string): Promise<Workspace | null> {
  const { packages, paths } = await getWorkspaceInfo()
  const pkg = packages.get(name)
  const path = paths.get(name)

  if (!pkg || !path) return null

  return {
    packageJson: pkg,
    packagePath: path,
  }
}
