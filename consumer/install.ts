#!/usr/bin/env bun
import { join } from 'node:path'
import { applyBasisPatches } from './patches/install'
import { resolveInstallRoot } from './patches/root'

/**
 * Trusted install hook that makes Basis-owned transitive patches effective in a
 * consuming project. Bun only honors root-level `patchedDependencies`, so this
 * hook re-applies the exact-version patch set the installed Basis release owns.
 */
const main = (): void => {
  const basisDir = join(import.meta.dir, '..')
  const rootDir = resolveInstallRoot(basisDir)

  try {
    const results = applyBasisPatches({ basisDir, rootDir })
    const applied = results.filter(result => result.status === 'applied')

    if (applied.length > 0) {
      const summary = applied.map(result => `${result.name}@${result.version}`).join(', ')
      process.stdout.write(`[basis] applied owned patch(es): ${summary}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[basis] failed to apply owned patches: ${message}\n`)
    process.exit(1)
  }
}

main()
