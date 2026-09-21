#!/usr/bin/env bun
import { join } from 'node:path'
import { applyBasisPatches } from './patches/install'
import { resolveInstallRoot } from './patches/root'

/**
 * Trusted install hook that makes Basis-owned transitive patches effective in a
 * consuming project.
 *
 * Bun applies `patchedDependencies` during install and only from the install
 * root, so a dependency cannot declare patches transitively. The hook instead
 * applies Basis's exact patch files with `git apply` once the dependencies are
 * on disk, matched by exact `name@version`.
 */
const main = (): void => {
  const basisDir = join(import.meta.dir, '..')
  const rootDir = resolveInstallRoot(basisDir)

  try {
    const result = applyBasisPatches({ basisDir, rootDir })

    if (result.applied.length > 0) {
      process.stdout.write(`[basis] applied owned patch(es): ${result.applied.join(', ')}\n`)
    }
    if (result.retired.length > 0) {
      process.stdout.write(`[basis] reversed retired patch(es): ${result.retired.join(', ')}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[basis] failed to apply owned patches: ${message}\n`)
    process.exit(1)
  }
}

main()
