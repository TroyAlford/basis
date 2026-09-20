import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

/**
 * Optional inputs for {@link resolveInstallRoot}, used to keep the resolution
 * testable without mutating process-wide state.
 */
export interface ResolveInstallRootOptions {
  /** Working directory to use instead of `process.cwd()`. */
  cwd?: string,
  /** Lifecycle `INIT_CWD` value; pass `null` to simulate an interactive invocation. */
  initCwd?: string | null,
}

/**
 * Reports whether a path is the directory itself or one of its descendants.
 * @param candidate Path to test.
 * @param dir Directory that may contain the candidate.
 * @returns Whether the candidate is inside the directory.
 */
const isInside = (candidate: string, dir: string): boolean => {
  const rel = relative(dir, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Determines which project's `node_modules` Basis should patch.
 *
 * Bun runs a dependency lifecycle script with `INIT_CWD` set to the project
 * root, which is the primary signal. Interactive CLI commands fall back to the
 * current working directory, then to the nearest ancestor that looks like a
 * project. This matters under Bun's isolated linker, where the real Basis
 * package lives under `node_modules/.bun/<name>@<version>/node_modules/...` and
 * a naive parent lookup would resolve to the store instead of the application.
 * @param basisDir Absolute path to the installed Basis package root.
 * @param options Optional working-directory and `INIT_CWD` overrides.
 * @returns Absolute path to the project root whose dependencies should be patched.
 */
export const resolveInstallRoot = (
  basisDir: string,
  options: ResolveInstallRootOptions = {},
): string => {
  const initCwd = options.initCwd === undefined ? process.env.INIT_CWD : options.initCwd
  if (initCwd && existsSync(join(initCwd, 'package.json'))) return initCwd

  const cwd = options.cwd ?? process.cwd()
  if (!isInside(cwd, basisDir) && existsSync(join(cwd, 'package.json'))) return cwd

  let current = basisDir
  while (true) {
    const parent = dirname(current)
    if (parent === current) break

    if (existsSync(join(parent, 'node_modules')) && existsSync(join(parent, 'package.json'))) {
      return parent
    }

    current = parent
  }

  return basisDir
}
