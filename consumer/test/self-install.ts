import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { findInstalledInstances } from '../patches/install'

/**
 * A source marker proving a Basis-owned patch is active in an installed copy.
 */
interface PatchMarker {
  /** Package-relative file that the patch rewrites. */
  file: string,
  /** Package the marker applies to. */
  name: string,
  /** Text that must be present once the patch is applied. */
  snippet: string,
  /** Exact patched version. */
  version: string,
}

const PATCH_MARKERS: PatchMarker[] = [
  {
    file: 'lib/core/sourceType.js',
    name: 'eslint-plugin-import',
    snippet: "context.parserOptions && 'sourceType' in context.parserOptions",
    version: '2.32.0',
  },
  {
    file: 'dist/rules/named-import-spacing.js',
    name: 'eslint-plugin-named-import-spacing',
    snippet: 'const sourceCode = context.sourceCode;',
    version: '1.0.3',
  },
  {
    file: 'lib/rules/sort-keys-fix.js',
    name: 'eslint-plugin-sort-keys-fix',
    snippet: 'const sourceCode = context.sourceCode',
    version: '1.1.2',
  },
  {
    file: 'lib/index.cjs.js',
    name: 'eslint-plugin-typescript-sort-keys',
    snippet: 'const sourceCode = context.sourceCode;',
    version: '3.3.0',
  },
  {
    file: 'lib/index.mjs',
    name: 'eslint-plugin-typescript-sort-keys',
    snippet: 'const sourceCode = context.sourceCode;',
    version: '3.3.0',
  },
]

const APP_PACKAGE = JSON.stringify(
  {
    devDependencies: {
      '@types/bun': '^1.3.11',
      'eslint-plugin-import': '2.32.0',
    },
    name: 'basis-consumer-fixture',
    private: true,
    type: 'module',
  },
  null,
  2,
)

const APP_TSCONFIG = JSON.stringify({ extends: 'basis/tsconfig/bun.json', include: ['src'] }, null, 2)

const APP_ESLINT_CONFIG = "export { default } from 'basis/eslint'\n"

const APP_SOURCE = `/**
 * Formats a greeting for a name.
 * @param name The name to greet.
 * @returns The greeting.
 */
export const greet = (name: string): string => \`Hello, \${name}!\`
`

const SURFACE_CHECK = [
  "import config from 'basis/eslint'",
  "if (!Array.isArray(config) || config.length === 0) throw new Error('bad surface')",
  "process.stdout.write('ok')",
].join('; ')

/**
 * Writes a file, creating parent directories as needed.
 * @param path Absolute file path.
 * @param contents File contents.
 */
const write = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

/**
 * Runs a command and returns stdout, throwing when the command fails.
 * @param command The executable and arguments.
 * @param cwd Working directory for the command.
 * @param env Environment overrides merged over the parent process environment.
 * @returns Captured standard output.
 */
const run = (command: string[], cwd: string, env: Record<string, string> = {}): string => {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (!result.success) {
    throw new Error(`command failed (${result.exitCode}): ${command.join(' ')}\n${stdout}\n${stderr}`)
  }

  return stdout
}

/**
 * Throws when a required condition is not met.
 * @param condition The condition expected to hold.
 * @param message Human-readable failure description.
 */
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`assertion failed: ${message}`)
}

/**
 * Verifies that every installed exact-version copy of a patched package carries
 * the observable marker the patch produces.
 * @param appRoot Absolute path to the fixture application.
 */
const assertPatchesActive = (appRoot: string): void => {
  for (const marker of PATCH_MARKERS) {
    const matches = findInstalledInstances(appRoot, marker.name)
      .filter(instance => instance.version === marker.version)
    assert(matches.length > 0, `${marker.name}@${marker.version} is installed`)

    for (const instance of matches) {
      const contents = readFileSync(join(instance.path, marker.file), 'utf8')
      assert(contents.includes(marker.snippet), `${marker.name} is patched at ${instance.path}`)
    }
  }
}

/**
 * Runs the full clean-install contract against the current checkout.
 */
const main = (): void => {
  const repoRoot = join(import.meta.dir, '..', '..')
  const workspace = mkdtempSync(join(tmpdir(), 'basis-consumer-'))
  const source = join(workspace, 'basis-source')
  const app = join(workspace, 'app')
  const binDir = join(workspace, 'bin')
  const tag = 'basis-self-install-e2e'

  try {
    /*
     * Ensure child processes resolve the same Bun that is running this test, so
     * the fixture never falls back to a different runtime.
     */
    mkdirSync(binDir, { recursive: true })
    symlinkSync(process.execPath, join(binDir, 'bun'))
    const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` }

    run(['git', 'clone', '--quiet', '--local', '--no-hardlinks', repoRoot, source], workspace, env)
    run(['git', 'tag', tag], source, env)

    write(join(app, 'package.json'), APP_PACKAGE)
    write(join(app, 'tsconfig.json'), APP_TSCONFIG)
    write(join(app, 'eslint.config.mjs'), APP_ESLINT_CONFIG)
    write(join(app, 'src', 'greeter.ts'), APP_SOURCE)

    /*
     * The host directly depends on a package Basis also patches, so the shared
     * exact-version copy must come out patched rather than an accidental copy.
     */
    run(['bun', 'add', '--dev', '--trust', `git+file://${source}#${tag}`], app, env)

    const basisDir = join(app, 'node_modules', 'basis')
    assert(existsSync(join(basisDir, 'package.json')), 'basis is installed')
    assert(existsSync(join(basisDir, 'consumer', 'eslint.ts')), 'basis ESLint surface is present')
    assert(existsSync(join(basisDir, 'consumer', 'tsconfig', 'bun.json')), 'basis tsconfig preset is present')

    const eslintSurface = run(['bun', '-e', SURFACE_CHECK], app, env)
    assert(eslintSurface.includes('ok'), 'basis/eslint resolves to a flat config')

    assertPatchesActive(app)

    const basisBin = join(app, 'node_modules', '.bin', 'basis')
    run(['bun', basisBin, 'lint'], app, env)
    run(['bun', basisBin, 'typecheck'], app, env)

    // A clean reinstall plus a re-run of the hook must stay green and idempotent.
    run(['bun', 'install'], app, env)
    run(['bun', join(basisDir, 'consumer', 'install.ts')], app, { ...env, INIT_CWD: app })
    assertPatchesActive(app)

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
