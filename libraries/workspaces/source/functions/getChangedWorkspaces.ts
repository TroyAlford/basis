import { resolve } from 'path'
import type { PackageJSON } from '../types/PackageJSON'
import type { WorkspaceInfo } from '../types/WorkspaceInfo'
import { getChangedFiles } from './getChangedFiles'
import { getWorkspaceInfo } from './getWorkspaceInfo'

/**
 * Check if a package is affected by the changed files
 * @param pkg - The package to check
 * @param changedFiles - The list of changed files
 * @param info - The workspace info
 * @param checked - The set of already checked packages
 * @returns Whether the package is affected
 */
function isPackageAffected(
  pkg: PackageJSON,
  changedFiles: string[],
  info: WorkspaceInfo,
  checked = new Set<string>(),
): boolean {
  if (checked.has(pkg.name)) return false
  checked.add(pkg.name)

  const packagePath = info.paths.get(pkg.name)
  if (!packagePath) return false

  const hasDirectChanges = changedFiles.some(file => (
    resolve(process.cwd(), file).startsWith(packagePath)
  ))

  if (hasDirectChanges) return true

  const deps = { ...pkg.dependencies, ...pkg.peerDependencies }
  return Object.keys(deps || {}).some(dep => {
    const depPkg = info.packages.get(dep)
    return depPkg && isPackageAffected(depPkg, changedFiles, info, checked)
  })
}

/**
 * Get the names of the workspaces that have changed files
 * @returns The names of the changed workspaces
 */
export async function getChangedWorkspaces(): Promise<string[]> {
  const [changedFiles, info] = await Promise.all([
    getChangedFiles(),
    getWorkspaceInfo(),
  ])

  const changedPackages = new Set<string>()
  info.packages.forEach((pkg, name) => {
    if (isPackageAffected(pkg, changedFiles, info)) {
      changedPackages.add(name)
    }
  })

  return Array.from(changedPackages)
}
