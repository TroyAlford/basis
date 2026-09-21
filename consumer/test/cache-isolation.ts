import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { findInstalledInstances } from '../patches/install'
import { assert, assertPatchesAbsent, assertPatchesActive, initApp, linkCount, makeTempDir, makeToolPath, PATCH_MARKERS, run } from './harness'

/**
 * Regression test for Bun's shared install cache. Two hosts install Basis
 * through one temporary cache; a third installs the same packages from that
 * cache with scripts disabled. When Basis owns patches, this also proves that
 * patching replaced cache files instead of mutating hardlinked cache entries.
 */
const main = (): void => {
  const repoRoot = join(import.meta.dir, '..', '..')
  const workspace = makeTempDir('basis-cache-')
  const source = join(workspace, 'basis-source')
  const cache = join(workspace, 'cache')
  const tag = 'basis-cache-e2e'
  const { path } = makeToolPath(workspace)
  const env = { PATH: path }

  try {
    run(['git', 'clone', '--quiet', '--local', '--no-hardlinks', repoRoot, source], workspace, env)
    // Force a lightweight tag so the fixture works even on hosts that enable
    // global tag signing (which would otherwise require a tag message).
    run(['git', '-c', 'tag.gpgsign=false', 'tag', tag], source, env)
    const spec = `git+file://${source}#${tag}`

    const hostA = join(workspace, 'host-a')
    initApp(hostA, spec)
    run(['bun', 'install', '--cache-dir', cache], hostA, env)
    assertPatchesActive(hostA)

    /*
     * Basis currently owns no patches, so there is no patched file to inspect.
     * If patches return, assert each patched file was replaced (link count 1)
     * rather than mutated in the shared cache.
     */
    if (PATCH_MARKERS.length > 0) {
      const marker = PATCH_MARKERS[0]
      assert(marker !== undefined, 'expected a Basis-owned patch marker')
      const [instance] = findInstalledInstances(hostA, marker.name)
        .filter(candidate => candidate.version === marker.version)
      assert(instance !== undefined, 'host A has the patched package')
      assert(
        linkCount(join(instance.path, marker.file)) === 1,
        'patched file is not hardlinked into the shared cache',
      )
    }

    const hostB = join(workspace, 'host-b')
    initApp(hostB, spec)
    run(['bun', 'install', '--cache-dir', cache], hostB, env)
    assertPatchesActive(hostB)
    assertPatchesActive(hostA)

    const hostC = join(workspace, 'host-c')
    initApp(hostC, spec, { trust: false })
    run(['bun', 'install', '--ignore-scripts', '--cache-dir', cache], hostC, env)
    for (const marker of PATCH_MARKERS) assertPatchesAbsent(hostC, marker)

    process.stdout.write(`[basis] consumer cache isolation: ok (${workspace})\n`)
  } finally {
    if (process.env.BASIS_KEEP_FIXTURE === '1') {
      process.stdout.write(`[basis] fixture kept at ${workspace}\n`)
    } else {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
}

main()
