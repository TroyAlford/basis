import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { findInstalledInstances } from '../patches/install'
import { assert, assertDoctorOk, assertNoBasisRuntimeHacks, assertNodeFree, initReactApp, makeTempDir, makeToolPath, run } from './harness'

/**
 * Regression test for the external React/server consumer contract.
 *
 * Installs Basis from a tag-shaped Git surface and proves that `basis/react`
 * and `basis/server` typecheck, run, and bundle without Basis-monorepo `paths`
 * aliases or direct `node_modules/basis/libraries/*` imports. The fixture has no
 * workspace symlinks, so it catches dependency/peer-resolution mistakes that
 * workspace hoisting would otherwise hide. It declares the same React range as
 * Basis, so the exact-one-runtime assertions are a real deduplication test.
 */
const main = (): void => {
  const repoRoot = join(import.meta.dir, '..', '..')
  const workspace = makeTempDir('basis-react-')
  const source = join(workspace, 'basis-source')
  const tag = 'basis-react-runtime-e2e'
  const { path } = makeToolPath(workspace)
  const env = { PATH: path }

  try {
    run(['git', 'clone', '--quiet', '--local', '--no-hardlinks', repoRoot, source], workspace, env)
    // Force a lightweight tag so the fixture works even on hosts that enable
    // global tag signing (which would otherwise require a tag message).
    run(['git', '-c', 'tag.gpgsign=false', 'tag', tag], source, env)
    const spec = `git+file://${source}#${tag}`

    const app = join(workspace, 'app')
    initReactApp(app, spec)
    run(['bun', 'install'], app, env)

    assertNodeFree(app, env)
    assertDoctorOk(app, env)
    assertNoBasisRuntimeHacks(app)

    /*
     * One documented React contract. Because the app declares the same React
     * range as Basis, a real React consumer must deduplicate with Basis into a
     * single runtime instead of installing a copy per package.
     */
    assert(findInstalledInstances(app, 'react').length === 1, 'exactly one React runtime is installed')
    assert(findInstalledInstances(app, 'react-dom').length === 1, 'exactly one ReactDOM runtime is installed')

    /*
     * `basis typecheck` compiles the consumer source through the shipped React
     * preset, so it proves the runtime source graph is self-contained.
     */
    const basisBin = join(app, 'node_modules', '.bin', 'basis')
    run(['bun', basisBin, 'typecheck'], app, env)

    /*
     * Executing the fixture proves runtime module resolution (React, the server,
     * and their transitive dependencies) without workspace symlinks.
     */
    const output = run(['bun', 'src/runtime.tsx'], app, env)
    assert(output.includes('runtime-ok'), 'react/server runtime executed')

    // Bundling proves the source resolves through Bun's bundler too.
    run(['bun', 'build', 'src/runtime.tsx', '--outdir', 'dist'], app, env)

    process.stdout.write(`[basis] consumer react runtime: ok (${workspace})\n`)
  } finally {
    if (process.env.BASIS_KEEP_FIXTURE === '1') {
      process.stdout.write(`[basis] fixture kept at ${workspace}\n`)
    } else {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
}

main()
