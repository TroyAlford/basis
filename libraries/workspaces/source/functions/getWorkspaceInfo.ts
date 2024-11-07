import { Glob } from 'bun'
import { resolve } from 'path'
import type { PackageJSON } from '../types/PackageJSON'
import type { WorkspaceInfo } from '../types/WorkspaceInfo'

/**
 * Get information about all workspaces in the project
 * @returns Workspace information including package.json contents and paths
 */
export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  const packages = new Map<string, PackageJSON>()
  const paths = new Map<string, string>()
  const { workspaces } = await Bun.file('package.json').json()

  for (const pattern of workspaces) {
    const glob = new Glob(`${pattern}/package.json`)
    const packagePaths = Array.from(glob.scanSync({ absolute: true }))

    for (const path of packagePaths) {
      const pkg = await Bun.file(path).json() as PackageJSON
      const packagePath = resolve(process.cwd(), path.replace(/package\.json$/, ''))
      packages.set(pkg.name, pkg)
      paths.set(pkg.name, packagePath)
    }
  }

  return { packages, paths }
}
