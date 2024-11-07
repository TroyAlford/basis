import type { PackageJSON } from './PackageJSON'

/** Information about a specific workspace */
export interface Workspace {
  /** The package.json contents */
  packageJson: PackageJSON,
  /** The filesystem path to the workspace */
  packagePath: string,
}
