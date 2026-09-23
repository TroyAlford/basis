import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { findInstalledInstances } from '../patches/install'

/**
 * A source marker proving a Basis-owned patch is active in an installed copy.
 */
export interface PatchMarker {
  /** Package-relative file that the patch rewrites. */
  file: string,
  /** Package the marker applies to. */
  name: string,
  /** Text that must be present once the patch is applied. */
  snippet: string,
  /** Exact patched version. */
  version: string,
}

/**
 * Basis-owned patches and the observable markers they produce in an installed
 * copy. Basis currently owns none, so this is empty; keep it as the single
 * source of truth for the patch assertions below.
 */
export const PATCH_MARKERS: PatchMarker[] = []

export const APP_TSCONFIG = JSON.stringify({ extends: 'basis/tsconfig/bun.json', include: ['src'] }, null, 2)

export const APP_ESLINT_CONFIG = "export { default } from 'basis/eslint'\n"

export const APP_SOURCE = `import { Logger } from 'basis/logger'

const logger = new Logger({ prefix: '[fixture]' })

/**
 * Formats a greeting for a name.
 * @param name The name to greet.
 * @returns The greeting.
 */
export const greet = (name: string): string => {
  const greeting = \`Hello, \${name}!\`
  logger.info(greeting)
  return greeting
}
`

/**
 * React fixture tsconfig. It extends the shipped preset and declares no Basis
 * path mappings, so it fails if the runtime surfaces need workspace aliases.
 */
export const REACT_TSCONFIG = JSON.stringify(
  { extends: 'basis/tsconfig/react.json', include: ['src'] },
  null,
  2,
)

/**
 * React fixture client entry. It typechecks and builds against `basis/react`.
 */
export const REACT_APP_SOURCE = `import { Button, Theme } from 'basis/react'

export const component = (
  <Theme>
    <Button disabled>Hello</Button>
  </Theme>
)
`

/**
 * React fixture entrypoint that proves runtime module resolution by rendering a
 * Basis component and touching the server export.
 */
export const REACT_APP_RUNTIME = `import { renderToString } from 'react-dom/server'
import { Button } from 'basis/react'
import { Server } from 'basis/server'

const html = renderToString(<Button data-x="1">Hello</Button>)
if (!html.includes('Hello')) throw new Error(\`render failed: \${JSON.stringify(html)}\`)
if (typeof Server !== 'function') throw new Error('basis/server did not export Server')

process.stdout.write('runtime-ok')
`

/**
 * React fixture managed-production entrypoint. It starts `basis/server` in
 * production mode and prints the bound address for the test harness.
 */
export const REACT_APP_SERVER = `import { Server } from 'basis/server'

const server = new Server()
  .root(import.meta.dir)
  .main('./app.tsx')
  .start({
    development: false,
    hostname: '127.0.0.1',
    port: 0,
    version: 'consumer-version',
  })

process.stdout.write(\`listening http://\${server.hostname}:\${server.port}\\n\`)
`

const SURFACE_CHECK = [
  "import config from 'basis/eslint'",
  "if (!Array.isArray(config) || config.length === 0) throw new Error('bad surface')",
  "process.stdout.write('ok')",
].join('; ')

/**
 * Throws when a required condition is not met.
 * @param condition The condition expected to hold.
 * @param message Human-readable failure description.
 */
export const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`assertion failed: ${message}`)
}

/**
 * Writes a file, creating parent directories as needed.
 * @param path Absolute file path.
 * @param contents File contents.
 */
export const write = (path: string, contents: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

/**
 * Creates a temporary directory for a fixture.
 * @param prefix Directory name prefix.
 * @returns Absolute path to the new directory.
 */
export const makeTempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

/**
 * Builds a PATH containing only Bun and Git, so a fixture proves it never needs
 * Node. A `node` binary anywhere on the ambient PATH is deliberately excluded.
 * @param workspace Absolute path to the fixture workspace.
 * @returns The bin directory and the restricted PATH value.
 */
export const makeToolPath = (workspace: string): { binDir: string, path: string } => {
  const binDir = join(workspace, 'bin')
  mkdirSync(binDir, { recursive: true })
  symlinkSync(process.execPath, join(binDir, 'bun'))

  const git = Bun.which('git')
  if (git === null) throw new Error('git is required to run the consumer fixtures')
  symlinkSync(git, join(binDir, 'git'))

  return { binDir, path: binDir }
}

/**
 * Runs a command and returns stdout, throwing when the command fails.
 * @param command The executable and arguments.
 * @param cwd Working directory for the command.
 * @param env Environment overrides merged over the parent process environment.
 * @returns Captured standard output.
 */
export const run = (command: string[], cwd: string, env: Record<string, string> = {}): string => {
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
 * Creates a fixture application with TypeScript and ESLint wired up.
 * @param app Absolute path to the application directory.
 * @param basisSpec The Basis dependency specifier.
 * @param options Whether to seed Basis and trust it up front.
 * @param options.includeBasis Whether to include the Basis dependency. Defaults to `true`.
 * @param options.trust Whether to list Basis in trustedDependencies. Defaults to `true`.
 */
export const initApp = (
  app: string,
  basisSpec: string,
  options: { includeBasis?: boolean, trust?: boolean } = {},
): void => {
  const { includeBasis = true, trust = true } = options
  const devDependencies: Record<string, string> = {
    '@types/bun': '^1.3.11',
  }
  if (includeBasis) devDependencies.basis = basisSpec

  write(
    join(app, 'package.json'),
    JSON.stringify(
      {
        devDependencies,
        name: 'basis-consumer-fixture',
        private: true,
        type: 'module',
        ...(trust ? { trustedDependencies: ['basis'] } : {}),
      },
      null,
      2,
    ),
  )
  write(join(app, 'tsconfig.json'), APP_TSCONFIG)
  write(join(app, 'eslint.config.mjs'), APP_ESLINT_CONFIG)
  write(join(app, 'src', 'greeter.ts'), APP_SOURCE)

  /*
   * Real consumers are Git repositories. Initialize one here so the patch hook
   * is exercised with Git repository discovery active: without it, `git apply`
   * silently skips package-relative paths and the install looks successful.
   */
  const git = Bun.which('git')
  if (git === null) throw new Error('git is required to run the consumer fixtures')
  run([git, 'init', '--quiet'], app)
}

/**
 * Reads the root Basis manifest's dependency map. The root manifest is the
 * distribution contract, so fixtures reuse its versions instead of duplicating
 * them and drifting whenever Basis bumps a package.
 * @returns The root `dependencies` map.
 */
const basisDependencies = (): Record<string, string> => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  return manifest.dependencies ?? {}
}

/**
 * Creates an external React/server fixture app wired to the shipped
 * `basis/tsconfig/react.json` preset, with no Basis path mappings.
 *
 * The app declares the same React/ReactDOM range as Basis (read from the root
 * manifest), modeling a real React consumer (for example mtg-proxifier). That
 * lets the fixture prove the two deduplicate into a single runtime rather than
 * each installing a copy.
 * @param app Absolute path to the application directory.
 * @param basisSpec The Basis dependency specifier.
 */
export const initReactApp = (app: string, basisSpec: string): void => {
  const dependencies = basisDependencies()
  const react = dependencies.react
  const reactDom = dependencies['react-dom']
  if (react === undefined || reactDom === undefined) {
    throw new Error('basis package.json must declare react and react-dom dependencies')
  }

  write(
    join(app, 'package.json'),
    JSON.stringify(
      {
        dependencies: { react, 'react-dom': reactDom },
        devDependencies: {
          '@types/bun': '^1.4.2',
          'basis': basisSpec,
        },
        name: 'basis-react-consumer-fixture',
        private: true,
        trustedDependencies: ['basis'],
        type: 'module',
      },
      null,
      2,
    ),
  )
  write(join(app, 'tsconfig.json'), REACT_TSCONFIG)
  write(join(app, 'src', 'app.tsx'), REACT_APP_SOURCE)
  write(join(app, 'src', 'runtime.tsx'), REACT_APP_RUNTIME)
  write(join(app, 'src', 'server.ts'), REACT_APP_SERVER)

  const git = Bun.which('git')
  if (git === null) throw new Error('git is required to run the consumer fixtures')
  run([git, 'init', '--quiet'], app)
}

/**
 * Asserts that every installed exact-version copy of every patched package
 * carries the observable marker the patch produces.
 * @param appRoot Absolute path to the fixture application.
 */
export const assertPatchesActive = (appRoot: string): void => {
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
 * Asserts that no installed copy of a package carries its patch marker.
 * @param appRoot Absolute path to the fixture application.
 * @param marker The marker to test for.
 */
export const assertPatchesAbsent = (appRoot: string, marker: PatchMarker): void => {
  const matches = findInstalledInstances(appRoot, marker.name)
    .filter(instance => instance.version === marker.version)
  assert(matches.length > 0, `${marker.name}@${marker.version} is installed`)

  for (const instance of matches) {
    const contents = readFileSync(join(instance.path, marker.file), 'utf8')
    assert(!contents.includes(marker.snippet), `${marker.name} is unexpectedly patched at ${instance.path}`)
  }
}

/**
 * Asserts that a fixture runs without Node on its PATH.
 * @param app Absolute path to the fixture application.
 * @param env The restricted environment.
 */
export const assertNodeFree = (app: string, env: Record<string, string>): void => {
  const found = run(['bun', '-e', "process.stdout.write(String(Bun.which('node')))"], app, env)
  assert(found === 'null', `PATH must not expose node (found ${found})`)
}

/**
 * Asserts that `basis/eslint` resolves to a flat config inside a fixture.
 * @param app Absolute path to the fixture application.
 * @param env The restricted environment.
 */
export const assertEslintSurface = (app: string, env: Record<string, string>): void => {
  const output = run(['bun', '-e', SURFACE_CHECK], app, env)
  assert(output.includes('ok'), 'basis/eslint resolves to a flat config')
}

/**
 * Asserts that a React fixture reaches Basis only through the supported public
 * exports: no Basis path mappings and no direct library-path imports.
 * @param app Absolute path to the fixture application.
 */
export const assertNoBasisRuntimeHacks = (app: string): void => {
  const tsconfig = readFileSync(join(app, 'tsconfig.json'), 'utf8')
  assert(!tsconfig.includes('"paths"'), 'fixture tsconfig declares no path mappings')
  assert(!tsconfig.includes('libraries/'), 'fixture tsconfig does not target Basis library paths')

  for (const file of ['src/app.tsx', 'src/runtime.tsx', 'src/server.ts']) {
    const contents = readFileSync(join(app, file), 'utf8')
    assert(!contents.includes('@basis/'), `${file} does not import internal Basis workspaces`)
    assert(!contents.includes('node_modules/basis/libraries'), `${file} does not import Basis library paths`)
  }
}

/**
 * Runs `basis doctor` in a fixture and asserts it reports no problems.
 * @param app Absolute path to the fixture application.
 * @param env The restricted environment.
 * @returns The doctor output for optional inspection.
 */
export const assertDoctorOk = (app: string, env: Record<string, string>): string => {
  const output = run(['bun', join(app, 'node_modules', '.bin', 'basis'), 'doctor'], app, env)
  assert(output.includes('[basis] doctor: ok'), `basis doctor reported problems:\n${output}`)
  return output
}

/**
 * Reads the physical link count for a fixture file, used to prove patches do
 * not mutate a shared install cache in place.
 * @param path Absolute path to the file.
 * @returns The number of hardlinks to the file.
 */
export const linkCount = (path: string): number => {
  assert(existsSync(path), `${path} exists`)
  return statSync(path).nlink
}
