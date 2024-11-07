import type { PackageJSON } from './PackageJSON'

/** Information about all workspaces in the project */
export interface WorkspaceInfo {
  /** Map of package names to their package.json contents */
  packages: Map<string, PackageJSON>,
  /** Map of package names to their filesystem paths */
  paths: Map<string, string>,
}
