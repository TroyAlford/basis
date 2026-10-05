#!/usr/bin/env bun
import { join } from 'node:path'
import { installChromium } from './browser'
import { requireHostDependencies } from './host-dependencies'
import { applyBasisPatches } from './patches/install'
import { resolveInstallRoot } from './patches/root'

/**
 * Trusted install hook that validates the host capabilities the consumer
 * declares, makes Basis-owned transitive patches effective in a consuming
 * project, and downloads the pinned Chromium browser `basis/testing` uses. The
 * operating-system libraries Chromium needs to launch are the environment's
 * responsibility (a CI image or a one-time host bootstrap); this hook never
 * escalates privileges or invokes a system package manager.
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
 * on disk, matched by exact `name@version`. Browser download failure is fatal
 * unless `BASIS_SKIP_BROWSER_INSTALL` opts out.
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

  try {
    installChromium(basisDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}

main()
