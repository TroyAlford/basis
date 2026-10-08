#!/usr/bin/env bun
import { join } from 'node:path'
import { requireHostDependencies } from './host-dependencies'
import { applyBasisPatches } from './patches/install'
import { resolveInstallRoot } from './patches/root'

/**
 * Trusted install hook that validates the host capabilities the consumer
 * declares and makes Basis-owned transitive patches effective in a consuming
 * project.
 *
 * A consumer declares non-npm host capabilities as static metadata in its own
 * root `package.json` (`basis.hostDependencies`); Basis resolves each on `PATH`
 * and, for known capabilities, proves it is runnable with its version command.
 * Anything missing, present-but-broken, or malformed fails the install loudly,
 * before any slower work.
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
    const host = requireHostDependencies(rootDir)
    if (host.resolved.length > 0) {
      process.stdout.write(`[basis] resolved host dependencies: ${host.resolved.join(', ')}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }

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
