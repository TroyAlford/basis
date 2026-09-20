import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { findInstalledInstances } from '../patches/install'
import { assert, assertPatchesAbsent, assertPatchesActive, initApp, linkCount, makeTempDir, makeToolPath, PATCH_MARKERS, run } from './harness'

/**
 * Regression test for Bun's shared install cache. Two hosts install Basis
 * through one temporary cache; a third installs the same packages from that
 * cache with scripts disabled. If patching mutated a hardlinked cache entry,
 * the third host would receive patched bytes. It must not.
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
    run(['git', 'tag', tag], source, env)
    const spec = `git+file://${source}#${tag}`

    const hostA = join(workspace, 'host-a')
    initApp(hostA, spec)
    run(['bun', 'install', '--cache-dir', cache], hostA, env)
    assertPatchesActive(hostA)

    // Patching must replace the file rather than mutate a hardlinked cache copy.
    const importMarker = PATCH_MARKERS[0]
    assert(importMarker !== undefined, 'expected an eslint-plugin-import marker')
    const [instance] = findInstalledInstances(hostA, importMarker.name)
      .filter(candidate => candidate.version === importMarker.version)
    assert(instance !== undefined, 'host A has the patched package')
    assert(
      linkCount(join(instance.path, importMarker.file)) === 1,
      'patched file is not hardlinked into the shared cache',
    )

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
