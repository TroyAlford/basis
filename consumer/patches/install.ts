import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  /** `name@version` patches recorded in a previous install that Basis no longer ships. */
  retired: string[],
  /** `name@version` patches that were already applied. */
  skipped: string[],
}

/**
 * A patch recorded as applied during an earlier install.
 */
interface AppliedPatch {
  /** Content hash of the patch file that was applied. */
  hash: string,
  /** Path to the retained patch copy, relative to the Basis state directory. */
  path: string,
}

/**
 * Install-time patch state, kept under `node_modules` so it disappears with the
 * patched files it describes.
 */
interface PatchState {
  /** Applied patches keyed by `name@version`. */
  patches: Record<string, AppliedPatch>,
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
 * Splits a `name@version` key into its parts.
 * @param key The patch key.
 * @returns The package name and exact version.
 */
const splitKey = (key: string): { name: string, version: string } => {
  const separator = key.lastIndexOf('@')
  return { name: key.slice(0, separator), version: key.slice(separator + 1) }
}

/**
 * Hashes patch contents so changed patch files can be detected.
 * @param contents The patch file contents.
 * @returns A hex-encoded SHA-256 digest.
 */
const hashPatch = (contents: string): string => new Bun.CryptoHasher('sha256').update(contents).digest('hex')

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
    /*
     * Force `git apply` to treat the package directory as the working tree even
     * when the consumer project is itself a Git repository. The ceiling must be
     * an ancestor of the package, not the package directory itself: Git only
     * refuses to ascend *into* ceiling entries and always inspects the current
     * directory, so a ceiling equal to the cwd leaves the consumer repository
     * discoverable. Git would then resolve patch paths against that repository
     * root, skip the package-relative paths ("Skipped patch ..."), and still
     * exit 0 — silently reporting the patch as applied when it was not.
     */
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(packageDir) },
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
 * Locates the directory holding Basis install state for a consumer.
 * @param rootDir Absolute path to the consumer project root.
 * @returns Absolute path to the state directory.
 */
const stateDir = (rootDir: string): string => join(rootDir, 'node_modules', '.basis')

/**
 * Reads the recorded patch state. A missing file is an empty state, but an
 * unreadable or malformed file fails loudly: silently treating it as empty
 * would forget which patches still need reconciling.
 * @param rootDir Absolute path to the consumer project root.
 * @returns The recorded state.
 */
const readState = (rootDir: string): PatchState => {
  const path = join(stateDir(rootDir), 'patches.json')
  if (!existsSync(path)) return { patches: {} }

  let state: PatchState
  try {
    state = readJson<PatchState>(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[basis] patch state at ${path} is unreadable: ${message}`, { cause: error })
  }

  if (state === null || typeof state !== 'object' || state.patches === null || typeof state.patches !== 'object') {
    throw new Error(`[basis] patch state at ${path} is malformed`)
  }

  return { patches: state.patches }
}

/**
 * Persists the recorded patch state.
 * @param rootDir Absolute path to the consumer project root.
 * @param state The state to write.
 */
const writeState = (rootDir: string, state: PatchState): void => {
  const dir = stateDir(rootDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'patches.json'), `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Stores a copy of an applied patch so a later Basis version can reverse it.
 * @param rootDir Absolute path to the consumer project root.
 * @param key The `name@version` key.
 * @param contents The patch contents.
 * @returns The path recorded in the state, relative to the state directory.
 */
const storePatchCopy = (rootDir: string, key: string, contents: string): string => {
  const filename = `${key.replaceAll('/', '+')}.patch`
  const relativePath = join('patches', filename)
  mkdirSync(join(stateDir(rootDir), 'patches'), { recursive: true })
  writeFileSync(join(stateDir(rootDir), relativePath), contents)
  return relativePath
}

/**
 * Drops a stored patch copy when it is no longer needed.
 * @param rootDir Absolute path to the consumer project root.
 * @param applied The recorded patch.
 */
const removePatchCopy = (rootDir: string, applied: AppliedPatch): void => {
  rmSync(join(stateDir(rootDir), applied.path), { force: true })
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
      const { name, version } = splitKey(key)
      return { name, path: join(basisDir, patchPath), version }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Finds every installed copy of a package across Bun's hoisted, nested, scoped
 * and isolated (`.bun/<name>@<version>/node_modules/...`) layouts, deduplicated
 * by physical location so hardlinked or symlinked copies are patched once.
 * @param rootDir Absolute path to the consumer project root.
 * @param name The package name to look for.
 * @returns One entry per physical `node_modules` copy of the package.
 */
export const findInstalledInstances = (rootDir: string, name: string): InstalledInstance[] => {
  const instances: InstalledInstance[] = []
  const seen = new Set<string>()

  const inspect = (dir: string): void => {
    let resolved: string
    try {
      resolved = realpathSync(dir)
    } catch {
      return
    }
    if (seen.has(resolved)) return

    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = readJson<PackageManifest>(manifestPath)
      if (manifest.name === name) {
        seen.add(resolved)
        instances.push({ name, path: resolved, version: manifest.version ?? '0.0.0' })
      }
    }
  }

  const walk = (nodeModules: string): void => {
    for (const entry of readdirSync(nodeModules)) {
      if (entry === '.bin' || entry === '.cache' || entry === '.basis') continue
      const entryPath = join(nodeModules, entry)

      /*
       * Bun's isolated store: .bun/<name>@<version>/node_modules/<package>,
       * plus the .bun/node_modules compatibility hoist when present.
       */
      if (entry === '.bun') {
        const compat = join(entryPath, 'node_modules')
        if (isDirectory(compat)) walk(compat)
        for (const storeEntry of readdirSync(entryPath)) {
          if (storeEntry === 'node_modules') continue
          const storeNodeModules = join(entryPath, storeEntry, 'node_modules')
          if (isDirectory(storeNodeModules)) walk(storeNodeModules)
        }
        continue
      }

      if (!isDirectory(entryPath)) continue
      const candidates = entry.startsWith('@')
        ? readdirSync(entryPath).map(scoped => join(entryPath, scoped))
        : [entryPath]

      for (const candidate of candidates) {
        if (!isDirectory(candidate)) continue
        inspect(candidate)

        const nested = join(candidate, 'node_modules')
        if (isDirectory(nested)) walk(nested)
      }
    }
  }

  walk(join(rootDir, 'node_modules'))
  return instances
}

/**
 * Reverses every applied copy of a patch that Basis no longer ships.
 *
 * Retirement is strict: a patch that cannot be proven either applied or fully
 * pristine is drift, and the install fails while keeping the retained patch and
 * state entry so the situation stays recoverable. A package version that no
 * longer exists has nothing to reverse and is safe to forget.
 * @param rootDir Absolute path to the consumer project root.
 * @param key The retired `name@version` key.
 * @param applied The recorded patch.
 */
const retirePatch = (rootDir: string, key: string, applied: AppliedPatch): void => {
  const patchPath = join(stateDir(rootDir), applied.path)
  if (!existsSync(patchPath)) {
    throw new Error(`[basis] retained patch for ${key} is missing at ${patchPath}; keeping recorded state`)
  }

  const { name, version } = splitKey(key)
  const matches = findInstalledInstances(rootDir, name)
    .filter(instance => instance.version === version)

  for (const instance of matches) {
    if (isPatchApplied(patchPath, instance.path)) {
      const reversed = gitApply(instance.path, ['--reverse'], patchPath)
      if (reversed.code !== 0) {
        const detail = reversed.stderr.trim()
        throw new Error(`[basis] could not reverse retired ${key} at ${instance.path}; keeping state: ${detail}`)
      }
      continue
    }

    const pristine = gitApply(instance.path, ['--check'], patchPath)
    if (pristine.code !== 0) {
      const detail = pristine.stderr.trim()
      throw new Error(`[basis] could not resolve retired ${key} at ${instance.path}; keeping state: ${detail}`)
    }
  }
}

/**
 * Applies the Basis-owned transitive patch set to a consumer installation.
 *
 * Bun applies `patchedDependencies` during install and cannot apply a
 * dependency's patches transitively, so the hook applies the exact patch files
 * with `git apply` after install. Each patch is matched by exact
 * `name@version`, applied idempotently to every installed copy of that version,
 * and a missing version or a patch that no longer matches fails loudly.
 *
 * Applied patches are recorded so that a patch dropped or changed by a later
 * Basis version is reversed instead of sticking around.
 * @param options The Basis package root, consumer root, and write mode.
 * @returns The entries applied, skipped, and retired.
 */
export const applyBasisPatches = (options: ApplyBasisPatchesOptions): ApplyBasisPatchesResult => {
  const { basisDir, rootDir, write = true } = options
  const patches = loadBasisPatches(basisDir)
  const current = new Map(patches.map(patch => [`${patch.name}@${patch.version}`, patch]))
  const state = readState(rootDir)
  const applied: string[] = []
  const skipped: string[] = []
  const retired: string[] = []

  for (const [key, entry] of Object.entries(state.patches)) {
    if (current.has(key)) continue
    retired.push(key)

    if (write) {
      retirePatch(rootDir, key, entry)
      Reflect.deleteProperty(state.patches, key)
      writeState(rootDir, state)
      removePatchCopy(rootDir, entry)
    }
  }

  for (const patch of patches) {
    const key = `${patch.name}@${patch.version}`
    const contents = readFileSync(patch.path, 'utf8')
    const hash = hashPatch(contents)
    const recorded = state.patches[key]

    if (recorded !== undefined && recorded.hash !== hash) {
      if (write) {
        retirePatch(rootDir, key, recorded)
        Reflect.deleteProperty(state.patches, key)
        writeState(rootDir, state)
        removePatchCopy(rootDir, recorded)
      }
    }

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

    if (write && state.patches[key] === undefined) {
      state.patches[key] = { hash, path: storePatchCopy(rootDir, key, contents) }
      writeState(rootDir, state)
    }

    if (pending) applied.push(key)
    else skipped.push(key)
  }

  return { applied, retired, skipped }
}
