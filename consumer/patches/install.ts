import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A single patch Basis owns, sourced from the root `patchedDependencies` map.
 */
export interface BasisPatch {
  /** Package name the patch targets, for example `eslint-plugin-import`. */
  name: string,
  /** Absolute path to the patch file inside the installed Basis package. */
  path: string,
  /** Exact package version the patch was authored against. */
  version: string,
}

/**
 * A physical installation of a Basis-owned dependency.
 */
export interface InstalledInstance {
  /** Package name read from the installed `package.json`. */
  name: string,
  /** Absolute path to the installed package directory. */
  path: string,
  /** Installed package version. */
  version: string,
}

/**
 * Options controlling where Basis reads patches from and what it patches.
 */
export interface ApplyBasisPatchesOptions {
  /** Absolute path to the installed Basis package root. */
  basisDir: string,
  /** Absolute path to the consumer project root whose `node_modules` is patched. */
  rootDir: string,
  /** When `false`, report the outcome without writing any files. Defaults to `true`. */
  write?: boolean,
}

/**
 * Outcome of applying the Basis-owned patch set.
 */
export interface ApplyBasisPatchesResult {
  /** `name@version` patches that were pending and have now been applied. */
  applied: string[],
  /** `name@version` patches that were already applied. */
  skipped: string[],
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
 * Result of running a `git apply` subcommand.
 */
interface GitApplyResult {
  /** Process exit code. */
  code: number,
  /** Captured standard error, used for loud failure messages. */
  stderr: string,
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
 * Resolves the `git` binary once so patch application can fail with a clear
 * message when Git is unavailable.
 * @returns Absolute path to the git binary.
 */
const gitBinary = (): string => {
  const git = Bun.which('git')
  if (git === null) {
    throw new Error('[basis] git is required to apply Basis-owned patches')
  }
  return git
}

/**
 * Runs `git apply` inside a package directory, outside any repository.
 * @param packageDir Absolute path to the package being patched.
 * @param args Arguments for `git apply`.
 * @param patchPath Absolute path to the patch file.
 * @returns The exit code and captured standard error.
 */
const gitApply = (packageDir: string, args: string[], patchPath: string): GitApplyResult => {
  const result = Bun.spawnSync([gitBinary(), 'apply', '-p1', ...args, patchPath], {
    cwd: packageDir,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: packageDir },
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })

  return { code: result.exitCode, stderr: result.stderr.toString() }
}

/**
 * Reports whether a patch is already present in an installed package.
 * @param patchPath Absolute path to the patch file.
 * @param packageDir Absolute path to the installed package directory.
 * @returns Whether the patch is already applied.
 */
const isPatchApplied = (patchPath: string, packageDir: string): boolean => gitApply(
  packageDir,
  ['--reverse', '--check'],
  patchPath,
).code === 0

/**
 * Applies one patch to an installed package, failing loudly when it no longer
 * matches the exact installed source.
 * @param patchPath Absolute path to the patch file.
 * @param packageDir Absolute path to the installed package directory.
 * @param key The `name@version` key, for error messages.
 */
const applyPatchToPackage = (patchPath: string, packageDir: string, key: string): void => {
  const check = gitApply(packageDir, ['--check'], patchPath)
  if (check.code !== 0) {
    throw new Error(`[basis] ${key} no longer applies to ${packageDir}: ${check.stderr.trim()}`)
  }

  const applied = gitApply(packageDir, [], patchPath)
  if (applied.code !== 0) {
    throw new Error(`[basis] failed to apply ${key} to ${packageDir}: ${applied.stderr.trim()}`)
  }
}

/**
 * Loads the patch set Basis owns from the installed package's own
 * `patchedDependencies` map, so the list never drifts from the release.
 * @param basisDir Absolute path to the installed Basis package root.
 * @returns The declared patches, sorted by package name for deterministic output.
 */
export const loadBasisPatches = (basisDir: string): BasisPatch[] => {
  const manifest = readJson<PackageManifest>(join(basisDir, 'package.json'))
  const patchedDependencies = manifest.patchedDependencies ?? {}

  return Object.entries(patchedDependencies)
    .map(([key, patchPath]) => {
      const separator = key.lastIndexOf('@')
      return {
        name: key.slice(0, separator),
        path: join(basisDir, patchPath),
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
            instances.push({ name, path: candidate, version: manifest.version ?? '0.0.0' })
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
 * Applies the Basis-owned transitive patch set to a consumer installation.
 *
 * Bun applies `patchedDependencies` during install and cannot apply a
 * dependency's patches transitively, so the hook applies the exact patch files
 * with `git apply` after install. Each patch is matched by exact
 * `name@version`, applied idempotently to every installed copy of that version,
 * and a missing version or a patch that no longer matches fails loudly.
 * @param options The Basis package root, consumer root, and write mode.
 * @returns The entries applied and those already registered.
 */
export const applyBasisPatches = (options: ApplyBasisPatchesOptions): ApplyBasisPatchesResult => {
  const { basisDir, rootDir, write = true } = options
  const applied: string[] = []
  const skipped: string[] = []

  for (const patch of loadBasisPatches(basisDir)) {
    const key = `${patch.name}@${patch.version}`
    const matches = findInstalledInstances(rootDir, patch.name)
      .filter(instance => instance.version === patch.version)

    if (matches.length === 0) {
      throw new Error(`[basis] no installed copy at the patched version for: ${key}`)
    }

    let pending = false
    for (const instance of matches) {
      if (isPatchApplied(patch.path, instance.path)) continue
      if (write) applyPatchToPackage(patch.path, instance.path, key)
      pending = true
    }

    if (pending) applied.push(key)
    else skipped.push(key)
  }

  return { applied, skipped }
}
