import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Determines which project's `node_modules` Basis should patch.
 *
 * When Bun runs a dependency lifecycle script it sets `INIT_CWD` to the
 * directory where the install was initiated, which is the consumer project. The
 * filesystem fallback derives the consumer root from the conventional
 * `<root>/node_modules/basis` layout, and finally falls back to the Basis
 * checkout itself so the hook is safe to run while developing Basis.
 * @param basisDir Absolute path to the installed Basis package root.
 * @returns Absolute path to the project root whose dependencies should be patched.
 */
export const resolveInstallRoot = (basisDir: string): string => {
  const initCwd = process.env.INIT_CWD
  if (initCwd && existsSync(join(initCwd, 'package.json'))) return initCwd

  const parent = dirname(basisDir)
  if (basename(parent) === 'node_modules') return dirname(parent)

  return basisDir
}
