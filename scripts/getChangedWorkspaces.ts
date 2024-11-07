/* eslint-disable no-console */
import { $, Glob } from 'bun'
import { resolve } from 'path'
import { workspaces } from '../package.json'

interface PackageJson {
  dependencies?: Record<string, string>,
  name: string,
  peerDependencies?: Record<string, string>,
}

// Get all workspace packages
const getAllWorkspaces = async () => {
  const packages = new Map<string, PackageJson>()
  const packagePaths = new Map<string, string>()

  workspaces.flatMap(pattern => {
    const glob = new Glob(`${pattern}/package.json`)
    const paths = Array.from(glob.scanSync({ onlyFiles: false }))
    paths.forEach(async path => {
      const packagePath = resolve(process.cwd(), path.replace(/package\.json$/, ''))
      const pkg = await Bun.file(path).json() as PackageJson
      packages.set(pkg.name, pkg)
      packagePaths.set(pkg.name, packagePath)
    })
  })
  return { packagePaths, packages }
}

// Get changed files
const getChangedFiles = async () => {
  try {
    // Try to get the last tag
    const lastTag = await $`git describe --tags --abbrev=0`.text().catch(() => '')

    // Get both committed and staged/unstaged changes
    const committedChanges = lastTag.trim()
      ? (await $`git diff --name-only ${lastTag.trim()}..HEAD`.text()).split('\n')
      : []

    // Get staged changes
    const stagedChanges = (await $`git diff --name-only --cached`.text()).split('\n')

    // Get unstaged changes
    const unstagedChanges = (await $`git diff --name-only`.text()).split('\n')

    // Combine all changes and clean up the results
    const changedFiles = [...new Set([
      ...committedChanges,
      ...stagedChanges,
      ...unstagedChanges,
    ])]
      .map(line => line.trim())
      .filter(Boolean)

    return changedFiles
  } catch (error) {
    console.error('Error getting changed files:', error)
    return []
  }
}

const isPackageAffected = (
  pkg: PackageJson,
  changedFiles: string[],
  allPackages: Map<string, PackageJson>,
  packagePaths: Map<string, string>,
  checked = new Set<string>(),
): boolean => {
  if (checked.has(pkg.name)) return false
  checked.add(pkg.name)

  const packagePath = packagePaths.get(pkg.name)
  if (!packagePath) return false

  const rootPath = process.cwd()
  const hasDirectChanges = changedFiles.some(file => (
    resolve(rootPath, file).startsWith(packagePath)
  ))

  if (hasDirectChanges) return true

  const deps = { ...pkg.dependencies, ...pkg.peerDependencies }
  return Object.keys(deps || {}).some(dep => {
    const depPkg = allPackages.get(dep)
    return depPkg && isPackageAffected(depPkg, changedFiles, allPackages, packagePaths, checked)
  })
}

const main = async () => {
  const [changedFiles, workspaceInfo] = await Promise.all([
    getChangedFiles(),
    getAllWorkspaces(),
  ])

  const { packagePaths, packages } = workspaceInfo
  const changedPackages = new Set<string>()

  packages.forEach((pkg, name) => {
    if (isPackageAffected(pkg, changedFiles, packages, packagePaths)) {
      changedPackages.add(name)
    }
  })

  console.log(JSON.stringify([...changedPackages], null, 2))
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
