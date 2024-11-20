import type { FilterOptions } from '../types/FilterOptions'
import { filterByPatterns } from './filterByPatterns'
import { getWorkspaceInfo } from './getWorkspaceInfo'

/**
 * List workspaces in the monorepo, optionally filtered by patterns
 * @param options - Filter options
 * @returns The filtered list of workspace names
 */
export async function listWorkspaces(options: FilterOptions): Promise<string[]> {
  const { packages } = await getWorkspaceInfo()
  const workspaces = Array.from(packages.keys())
  return filterByPatterns(workspaces, options)
}
