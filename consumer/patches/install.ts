import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPatchToText } from './apply'
import type { PatchFile } from './parse'
import { parsePatch } from './parse'

/**
 * A single patch Basis owns, derived from the root `patchedDependencies` map.
 */
export interface BasisPatch {
  /** Package name the patch targets, for example `eslint-plugin-import`. */
  name: string,
  /** Absolute path to the patch file inside the installed Basis package. */
  patchPath: string,
  /** Exact package version the patch was authored against. */
  version: string,
}

/**
 * A physical installation of a Basis-owned dependency that the hook inspected.
 */
export interface InstalledInstance {
  /** Package name read from the installed `package.json`. */
  name: string,
  /** Absolute path to the installed package directory. */
  path: string,
  /** Whether the patch changed the package, or was already in place. */
  status: 'applied' | 'unchanged',
  /** Installed package version. */
  version: string,
}

/**
 * Options controlling where Basis reads its patches from and what it patches.
 */
export interface ApplyPatchesOptions {
  /** Absolute path to the installed Basis package root. */
  basisDir: string,
  /** Absolute path to the consumer project root whose `node_modules` is patched. */
  rootDir: string,
  /** When `false`, report the outcome without writing any files. Defaults to `true`. */
  write?: boolean,
}

/**
 * The subset of a package manifest the patch hook cares about.
 */
interface PackageManifest {
  /** Declared package name. */
  name?: string,
  /** Bun-owned patch map, keyed by `name@version`. */
  patchedDependencies?: Record<string, string>,
  /** Declared package version. */
  version?: string,
}

/**
 * Reads and parses a JSON file synchronously.
 * @param path Absolute path to the JSON file.
 * @returns The parsed value cast to the requested shape.
 */
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/**
 * Returns true when the path exists and resolves to a directory.
 * @param path Absolute path to test.
 * @returns Whether the path is a readable directory.
 */
const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Loads the patch set Basis owns, sourced from the installed package's own
 * `patchedDependencies` map so the patch list never drifts from the release.
 * @param basisDir Absolute path to the installed Basis package root.
 * @returns The declared patches, sorted by package name for deterministic output.
 */
export const loadBasisPatches = (basisDir: string): BasisPatch[] => {
  const manifest = readJson<PackageManifest>(join(basisDir, 'package.json'))
  const patchedDependencies = manifest.patchedDependencies ?? {}

  return Object.entries(patchedDependencies)
    .map(([key, relativePath]) => {
      const separator = key.lastIndexOf('@')
      return {
        name: key.slice(0, separator),
        patchPath: join(basisDir, relativePath),
        version: key.slice(separator + 1),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Finds every installed copy of a package, including nested and hoisted
 * instances, so the exact-version patch is applied wherever it can be resolved.
 * @param rootDir Absolute path to the consumer project root.
 * @param name The package name to look for.
 * @returns One entry per physical `node_modules` copy of the package.
 */
export const findInstalledInstances = (rootDir: string, name: string): InstalledInstance[] => {
  const instances: InstalledInstance[] = []
  const pending = [join(rootDir, 'node_modules')]

  while (pending.length > 0) {
    const nodeModules = pending.pop()
    if (nodeModules === undefined || !isDirectory(nodeModules)) continue

    for (const entry of readdirSync(nodeModules)) {
      if (entry === '.bin' || entry === '.cache') continue
      const entryPath = join(nodeModules, entry)
      const candidates = entry.startsWith('@')
        ? readdirSync(entryPath).map(scoped => join(entryPath, scoped))
        : [entryPath]

      for (const candidate of candidates) {
        if (!isDirectory(candidate)) continue

        const manifestPath = join(candidate, 'package.json')
        if (existsSync(manifestPath)) {
          const manifest = readJson<PackageManifest>(manifestPath)
          if (manifest.name === name) {
            instances.push({
              name,
              path: candidate,
              status: 'unchanged',
              version: manifest.version ?? '0.0.0',
            })
          }
        }

        const nested = join(candidate, 'node_modules')
        if (isDirectory(nested)) pending.push(nested)
      }
    }
  }

  return instances
}

/**
 * Applies every file in a parsed patch to one installed package copy.
 * @param instance The installed package copy to patch.
 * @param files The parsed patch files.
 * @param write Whether to persist changes.
 * @returns The same instance with an updated status.
 */
const patchInstance = (instance: InstalledInstance, files: PatchFile[], write: boolean): InstalledInstance => {
  let status: InstalledInstance['status'] = 'unchanged'

  for (const file of files) {
    const target = join(instance.path, file.newPath)
    if (!existsSync(target)) throw new Error(`[basis] expected patched file is missing: ${target}`)

    const result = applyPatchToText(readFileSync(target, 'utf8'), file)
    if (result.applied) {
      if (write) writeFileSync(target, result.content)
      status = 'applied'
    }
  }

  return { ...instance, status }
}

/**
 * Applies the Basis-owned transitive patch set to a consumer installation.
 *
 * The set is derived from the installed Basis version, matched by exact
 * `name@version`, and applied to every physical install of that exact version.
 * Unrelated versions are left untouched, and a missing expected version throws
 * rather than guessing.
 * @param options The Basis package root, consumer root, and write mode.
 * @returns The inspected instances and their resulting status.
 */
export const applyBasisPatches = (options: ApplyPatchesOptions): InstalledInstance[] => {
  const { basisDir, rootDir, write = true } = options
  const results: InstalledInstance[] = []

  for (const basisPatch of loadBasisPatches(basisDir)) {
    const files = parsePatch(readFileSync(basisPatch.patchPath, 'utf8'))
    const matches = findInstalledInstances(rootDir, basisPatch.name)
      .filter(instance => instance.version === basisPatch.version)

    if (matches.length === 0) {
      throw new Error(
        `[basis] no installed ${basisPatch.name}@${basisPatch.version} found under ${rootDir}`,
      )
    }

    for (const instance of matches) {
      results.push(patchInstance(instance, files, write))
    }
  }

  return results
}
