import { readFileSync, rmSync, writeFileSync } from 'node:fs'
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

    writeFileSync(join(app, 'fixture.test.ts'), [
      "import { expect, test } from 'bun:test'",
      "import { DatabaseRelease, Graph } from 'basis/server'",
      "import * as serverSurface from 'basis/server'",
      "import { generateJSONSchemas, generateTypes } from 'basis/codegen'",
      "import { generateErd } from 'basis/visualization'",
      "import { withIsolatedDatabase } from 'basis/testing'",
      '',
      'const graph = new Graph({',
      '  entities: [{',
      "    fields: [{ field: 'id', format: 'UUID' }, { field: 'label', type: 'String' }],",
      "    name: 'ConsumerNote',",
      '  }],',
      '})',
      'const entities = graph.definitions',
      '',
      "test('consumer fixture extends the system User ontology', () => {",
      '  const application = new Graph({',
      "    entities: [{ name: 'ApplicationUser', extends: 'User', fields: [] }],",
      '  })',
      "  expect(application.definitions.entity('ApplicationUser')).toBeTruthy()",
      "  expect(application.definitions.entity('User')).toBeTruthy()",
      "  expect('EntityDefinitions' in serverSurface).toBe(false)",
      "  expect(typeof DatabaseRelease).toBe('function')",
      '})',
      '',
      "test('consumer codegen and visualization surfaces resolve', () => {",
      "  expect(generateTypes(graph)).toContain('export interface ConsumerNote')",
      '  expect(generateJSONSchemas(graph).ConsumerNote?.output).toBeDefined()',
      "  expect(generateErd(graph)).toContain('ConsumerNote')",
      '})',
      '',
      "test('consumer fixture uses provided entities', async () => {",
      "  await withIsolatedDatabase('consumer-fixture', async database => {",
      "    const id = '00000000-0000-4000-8000-000000000001'",
      '    await database.sql`',
      '      INSERT INTO "Entity" ("id", "name", "entity")',
      "      VALUES (${id}, 'Consumer', 'ConsumerNote')",
      '    `',
      '    await database.sql`',
      '      INSERT INTO "ConsumerNote" ("id", "label")',
      "      VALUES (${id}, 'isolated')",
      '    `',
      "    expect(await database.query('ConsumerNote', { fields: ['id', 'label'] }))",
      "      .toEqual([{ id, label: 'isolated' }])",
      '  }, { entities })',
      '})',
    ].join('\n'))
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
