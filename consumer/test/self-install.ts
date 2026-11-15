import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, assertDoctorOk, assertEslintSurface, assertMarkdownSurface, assertNodeFree, assertPatchesActive, assertStylelintSurface, initApp, makeTempDir, makeToolPath, run, runAllowFailure } from './harness'

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

    /*
     * Trusted install into a fresh host via the documented command. The hook
     * applies Basis-owned patches and validates declared host dependencies; it
     * provisions no browser, because snapshot capture runs Chromium in Docker.
     */
    const app = join(workspace, 'app')
    initApp(app, spec, { includeBasis: false })
    run(['bun', 'add', '--dev', '--trust', spec], app)

    mkdirSync(join(app, 'emitters'), { recursive: true })
    writeFileSync(join(app, 'graph.ts'), `import { FieldType, Graph } from 'basis/server'

export default new Graph({
  entities: [{
    fields: [{ field: 'title', type: FieldType.String }],
    name: 'EmitThing',
  }],
})
`)
    writeFileSync(join(app, 'emitters', 'custom.ts'), `import { emitter } from 'basis/codegen'

export default emitter({ extension: 'txt', folder: 'custom' }, graph => [{
  content: graph.definitions.entities.map(entity => entity.name).join('\\n'),
  name: 'summary',
}])
`)

    const basisBinEarly = join(app, 'node_modules', '.bin', 'basis')
    run(['bun', basisBinEarly, 'emit'], app, env)
    assert(existsSync(join(app, 'generated', 'typescript', 'index.ts')), 'built-in TypeScript emitter ran')
    assert(existsSync(join(app, 'generated', 'json-schema', 'schemas.json')), 'built-in JSON Schema emitter ran')
    assert(
      readFileSync(join(app, 'generated', 'custom', 'summary.txt'), 'utf8').includes('EmitThing'),
      'application emitter received the constructed Graph',
    )
    rmSync(join(app, 'generated'), { force: true, recursive: true })

    assertNodeFree(app, env)
    assertEslintSurface(app, env)
    assertStylelintSurface(app, env)
    assertMarkdownSurface(app, env)
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

    // A consumer repo with no ESLint config still lints: Basis supplies its own.
    rmSync(join(app, 'eslint.config.mjs'), { force: true })
    run(['bun', basisBin, 'lint'], app, env)

    run(['bun', basisBin, 'typecheck'], app, env)
    assert(
      existsSync(join(app, 'generated', 'custom', 'summary.txt')),
      'typecheck lifecycle automatically reran application emitters',
    )

    copyFileSync(join(import.meta.dir, 'fixtures', 'consumer-fixture.ts'), join(app, 'fixture.test.ts'))
    run(['bun', 'test', 'fixture.test.ts', '--timeout', '120000'], app)

    // True clean reinstall: drop node_modules and the lockfile, install again.
    rmSync(join(app, 'node_modules'), { force: true, recursive: true })
    rmSync(join(app, 'bun.lock'), { force: true })
    run(['bun', 'install'], app)
    assertPatchesActive(app)
    assertDoctorOk(app, env)

    // Strict isolated linking must be patched as well.
    const isolated = join(workspace, 'isolated')
    initApp(isolated, spec)
    run(['bun', 'install', '--linker=isolated'], isolated)
    assertNodeFree(isolated, env)
    assertEslintSurface(isolated, env)
    assertStylelintSurface(isolated, env)
    assertPatchesActive(isolated)
    assertDoctorOk(isolated, env)

    /*
     * A consumer that declares a host capability the machine cannot provide
     * must fail the install loudly, naming the capability, rather than settling
     * into a state that looks installed but cannot run.
     */
    const rejected = join(workspace, 'rejected')
    initApp(rejected, spec, { hostDependencies: ['basis-missing-host-command'] })
    const failure = runAllowFailure(['bun', 'install'], rejected, env)
    assert(failure.exitCode !== 0, 'install fails when a declared host dependency is missing')
    const output = `${failure.stdout}\n${failure.stderr}`
    assert(output.includes('basis-missing-host-command'), 'install names the missing host dependency')

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
