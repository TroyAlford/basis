import { Glob } from 'bun'
import { workspaces } from '../package.json'
import type { PackageJSON } from './PackageJSON'

/**
 * Find a workspace by name
 * @param name - Workspace name
 * @returns Workspace information
 */
export async function findWorkspace(name: string): Promise<{
  packageJson: PackageJSON,
  packagePath: string,
} | null> {
  for (const pattern of workspaces) {
    const glob = new Glob(`${pattern}/package.json`)
    const paths = Array.from(glob.scanSync({ absolute: true }))

    for (const path of paths) {
      const pkg = await Bun.file(path).json() as PackageJSON
      if (pkg.name === name) {
        return {
          packageJson: pkg,
          packagePath: path.replace(/package\.json$/, ''),
        }
      }
    }
  }

  return null
}
