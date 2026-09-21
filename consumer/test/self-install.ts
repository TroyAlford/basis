import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assert, assertDoctorOk, assertEslintSurface, assertNodeFree, assertPatchesActive, initApp, makeTempDir, makeToolPath, run } from './harness'

/**
 * A minimal package manifest, used for assertions.
 */
interface PackageManifest {
  /** Bun-owned patch map; must stay empty in the consumer. */
  patchedDependencies?: Record<string, string>,
  /** Packages Bun is allowed to run install lifecycle scripts for. */
  trustedDependencies?: string[],
}

/**
 * Runs the full clean-install contract against the current checkout:
 * a trusted Git install, a genuinely Node-free PATH, `basis doctor`, host
 * lint/typecheck, a true clean reinstall, and strict isolated linking.
 */
const main = (): void => {
  const repoRoot = join(import.meta.dir, '..', '..')
  const workspace = makeTempDir('basis-consumer-')
  const source = join(workspace, 'basis-source')
  const tag = 'basis-self-install-e2e'
  const { path } = makeToolPath(workspace)
  const env = { PATH: path }

  try {
    run(['git', 'clone', '--quiet', '--local', '--no-hardlinks', repoRoot, source], workspace, env)
    // Force a lightweight tag so the fixture works even on hosts that enable
    // global tag signing (which would otherwise require a tag message).
    run(['git', '-c', 'tag.gpgsign=false', 'tag', tag], source, env)
    const spec = `git+file://${source}#${tag}`

    // Trusted install into a fresh host via the documented command.
    const app = join(workspace, 'app')
    initApp(app, spec, { includeBasis: false })
    run(['bun', 'add', '--dev', '--trust', spec], app, env)

    assertNodeFree(app, env)
    assertEslintSurface(app, env)
    assertPatchesActive(app)
    assertDoctorOk(app, env)

    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as PackageManifest
    assert((manifest.trustedDependencies ?? []).includes('basis'), 'basis is trusted')
    assert(
      Object.keys(manifest.patchedDependencies ?? {}).length === 0,
      'consumer has no copied patchedDependencies',
    )

    const basisBin = join(app, 'node_modules', '.bin', 'basis')
    run(['bun', basisBin, 'lint'], app, env)
    run(['bun', basisBin, 'typecheck'], app, env)

    // True clean reinstall: drop node_modules and the lockfile, install again.
    rmSync(join(app, 'node_modules'), { force: true, recursive: true })
    rmSync(join(app, 'bun.lock'), { force: true })
    run(['bun', 'install'], app, env)
    assertPatchesActive(app)
    assertDoctorOk(app, env)

    // Strict isolated linking must be patched as well.
    const isolated = join(workspace, 'isolated')
    initApp(isolated, spec)
    run(['bun', 'install', '--linker=isolated'], isolated, env)
    assertNodeFree(isolated, env)
    assertEslintSurface(isolated, env)
    assertPatchesActive(isolated)
    assertDoctorOk(isolated, env)

    process.stdout.write(`[basis] consumer self-install: ok (${workspace})\n`)
  } finally {
    if (process.env.BASIS_KEEP_FIXTURE === '1') {
      process.stdout.write(`[basis] fixture kept at ${workspace}\n`)
    } else {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
}

main()
