#!/usr/bin/env bun
import { Logger } from 'basis/logger'
import { run } from 'basis/utilities'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { basisServerUnsupportedReason, bunCheckUnsupportedReason } from './bun-version'
import { runDocs, runDocsBuild } from './docs'
import { emit } from './emit'
import { applyBasisPatches } from './patches/install'
import { resolveInstallRoot } from './patches/root'

/**
 * The subset of the Basis manifest the CLI inspects.
 */
interface BasisManifest {
  /** Stable public subpaths exposed through the package `exports` map. */
  exports?: Record<string, string>,
  /** Declared package name. */
  name?: string,
  /** Bun-owned patch map, keyed by `name@version`. */
  patchedDependencies?: Record<string, string>,
  /** Packages Bun is allowed to run install lifecycle scripts for. */
  trustedDependencies?: string[],
  /** Declared package version. */
  version?: string,
}

/**
 * The subset of a dependency manifest needed to locate a binary.
 */
interface BinaryManifest {
  /** Declared `bin` field, which may be a single path or a name-to-path map. */
  bin?: Record<string, string> | string,
}

const REQUIRED_EXPORTS = [
  './cli',
  './eslint',
  './logger',
  './markdown',
  './react',
  './react/icons',
  './review',
  './server',
  './stylelint',
  './tsconfig/base.json',
  './tsconfig/bun.json',
  './tsconfig/react.json',
]

/** The Basis CLI's structured logger. */
const logger = new Logger({ colors: false })

/** The closed CLI command vocabulary. */
enum Command {
  Compliance = 'compliance',
  Database = 'db',
  Docs = 'docs',
  Doctor = 'doctor',
  Emit = 'emit',
  Format = 'format',
  Lint = 'lint',
  Typecheck = 'typecheck',
}

/**
 * Reads and parses a JSON file.
 * @param path Absolute path to the JSON file.
 * @returns The parsed value cast to the requested shape.
 */
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/**
 * Resolves the Basis package directory from this CLI's location.
 * @returns Absolute path to the installed Basis package root.
 */
const basisDir = (): string => join(import.meta.dir, '..')

/**
 * Locates the JavaScript entrypoint behind a dependency's named binary.
 * @param packageName The dependency package name.
 * @param binName The binary name to resolve.
 * @returns Absolute path to the binary's JavaScript entrypoint.
 */
const resolveBin = (packageName: string, binName: string): string => {
  const manifestPath = Bun.resolveSync(`${packageName}/package.json`, import.meta.dir)
  const manifest = readJson<BinaryManifest>(manifestPath)
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]

  if (!relative) throw new Error(`[basis] ${packageName} does not expose a ${binName} binary`)

  return join(dirname(manifestPath), relative)
}

/**
 * Write one captured subprocess response to the caller's streams.
 * @param result - Captured command result.
 * @param result.exitCode - Child exit code.
 * @param result.stderr - Captured standard error.
 * @param result.stdout - Captured standard output.
 * @returns The child exit code.
 */
const writeResult = (
  result: { readonly exitCode: number, readonly stderr: string, readonly stdout: string },
): number => {
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  return result.exitCode
}

/**
 * Runs a dependency binary through Bun itself, so no Node shebang is required.
 * @param packageName The dependency package name.
 * @param binName The binary name to run.
 * @param args Arguments for the binary.
 * @returns The child process exit code.
 */
const runBin = (packageName: string, binName: string, args: string[]): number => writeResult(
  run(process.execPath, [resolveBin(packageName, binName), ...args]),
)

/** Flat ESLint config filenames ESLint discovers automatically. */
const ESLINT_CONFIG_FILES = [
  'eslint.config.cjs',
  'eslint.config.cts',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.mts',
  'eslint.config.ts',
]

/**
 * Whether the working directory provides its own ESLint config, in which case
 * the repository's policy wins over the Basis fallback.
 * @returns Whether a flat ESLint config file exists in the working directory.
 */
const hasEslintConfig = (): boolean => ESLINT_CONFIG_FILES.some(name => existsSync(join(process.cwd(), name)))

/**
 * Runs the TypeScript/JSX ESLint policy.
 *
 * A repository's own `eslint.config.*` wins when present; otherwise Basis
 * supplies its own config, so `basis lint` / `basis format` need no setup.
 * `format` applies fixes and ignores warning-only diagnostics; `lint` reports
 * warnings as actionable findings.
 * @param fix Whether to let ESLint apply the fixes it supports.
 * @param target Path to lint; defaults to the working directory.
 * @returns The child process exit code.
 */
const runEslint = (fix: boolean, target = '.'): number => {
  const config = hasEslintConfig() ? [] : ['--config', join(basisDir(), 'eslint.config.mjs')]
  return runBin('eslint', 'eslint', [
    target,
    ...config,
    ...eslintCache('style'),
    ...(fix ? ['--fix', '--quiet'] : ['--max-warnings', '0']),
  ])
}

/**
 * Build the stable cache arguments for one ESLint surface.
 *
 * The style and compliance configs have different rule sets, so they use
 * separate caches; sharing one would invalidate every entry on each run.
 * @param surface - ESLint surface name.
 * @returns Cache arguments, with the directory created eagerly.
 */
const eslintCache = (surface: 'compliance' | 'style'): string[] => {
  const directory = join(process.cwd(), '.cache', 'eslint', surface)
  mkdirSync(directory, { recursive: true })
  return ['--cache', '--cache-location', join(directory, '.eslintcache')]
}

/**
 * Runs the Basis CSS policy over every `*.styles.ts` file.
 * @param fix Whether to let Stylelint apply the fixes it supports.
 * @returns The child process exit code.
 */
const runStylelint = (fix: boolean): number => runBin('stylelint', 'stylelint', [
  '**/*.styles.ts',
  '--allow-empty-input',
  '--config',
  join(basisDir(), 'stylelint.config.mjs'),
  ...(fix ? ['--fix'] : []),
])

/**
 * Runs the Basis Markdown/MDX policy through the plugin's CLI entrypoint.
 * @param fix Whether to rewrite documents with the fixes the policy supports.
 * @returns The child process exit code.
 */
const runMarkdown = (fix: boolean): number => writeResult(run(
  process.execPath,
  [join(basisDir(), 'libraries', 'markdown-plugin', 'bin.ts'), ...(fix ? ['--fix'] : [])],
))

/**
 * Runs every Basis lint surface with the same engine, so `lint` reports and
 * `format` applies every autofix each surface supports.
 * @param fix Whether to apply the autofixes each surface supports.
 * @returns The first non-zero child process exit code, or `0`.
 */
const runLint = (fix: boolean): number => {
  const eslintCode = runEslint(fix)
  if (eslintCode !== 0) return eslintCode

  const stylelintCode = runStylelint(fix)
  if (stylelintCode !== 0) return stylelintCode

  return runMarkdown(fix)
}

/**
 * Runs the authoritative, report-only Basis paradigm policy.
 *
 * Compliance always uses the Basis-owned configuration so the check is
 * available and identical even when a consumer repository carries its own
 * ESLint config. It applies the architecture and infrastructure rules without
 * duplicating the style policy, which `basis lint` already ran.
 * @returns The child process exit code.
 */
const runCompliance = (): number => runBin('eslint', 'eslint', [
  '.',
  '--config',
  join(basisDir(), 'eslint.compliance.config.mjs'),
  ...eslintCache('compliance'),
])

/**
 * Reports whether the running Bun can type check through `bun --check`.
 * @returns Whether the type checker is available.
 */
const requireBunCheck = (): boolean => {
  const reason = bunCheckUnsupportedReason()
  if (reason === null) return true
  logger.error(reason)
  return false
}

/**
 * Runs Bun's built-in TypeScript checker for the current project.
 * @returns The child process exit code.
 */
const spawnBunCheck = (): number => writeResult(run(
  process.execPath,
  ['--check'],
))

/**
 * Runs the TypeScript checker after validating the runtime.
 * @returns The child process exit code.
 */
const runTypecheck = (): number => (requireBunCheck() ? spawnBunCheck() : 1)

/**
 * Runs the complete repository check: emit, style lint, optional paradigm
 * compliance, and typecheck.
 *
 * `basis lint` and `basis compliance` are the two supported entry points.
 * Compliance is the authoritative gate; lint omits only the paradigm rules.
 * @param paradigm Whether to run the compliance rule set.
 * @returns The first non-zero child process exit code, or `0`.
 */
const runCompleteCheck = async (paradigm: boolean): Promise<number> => {
  if (!requireBunCheck()) return 1
  const emitCode = await runEmit()
  if (emitCode !== 0) return emitCode
  const lintCode = runLint(false)
  if (lintCode !== 0) return lintCode
  if (paradigm) {
    const complianceCode = runCompliance()
    if (complianceCode !== 0) return complianceCode
  }
  return spawnBunCheck()
}

/**
 * Runs the conventional application emit lifecycle.
 * @returns Process exit code (`0` when emission succeeds or is not configured).
 */
const runEmit = async (): Promise<number> => {
  try {
    const result = await emit()
    if (!result) {
      logger.info('[basis] emit: no graph.ts found; skipped')
      return 0
    }
    const formatCode = runEslint(true, 'generated')
    if (formatCode !== 0) return formatCode
    logger.info(`[basis] emit: ${result.emitters.join(', ')} -> ${result.outputRoot}`)
    return 0
  } catch (error) {
    logger.error(`[basis] emit: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/**
 * Verifies the installed Basis surface and its owned patches.
 * @returns Process exit code (`0` when healthy).
 */
const doctor = (): number => {
  const root = basisDir()
  const manifest = readJson<BasisManifest>(join(root, 'package.json'))
  const installRoot = resolveInstallRoot(root)
  let failures = 0

  logger.info(`[basis] version ${manifest.version ?? 'unknown'}`)
  logger.info(`[basis] consumer root ${installRoot}`)

  const unsupportedBun = bunCheckUnsupportedReason()
  if (unsupportedBun === null) {
    logger.info(`[basis] bun ${Bun.version} typecheck ok`)
  } else {
    failures += 1
    logger.info(unsupportedBun)
  }

  const unsupportedServerBun = basisServerUnsupportedReason()
  if (unsupportedServerBun === null) {
    logger.info(`[basis] bun ${Bun.version} server ok`)
  } else {
    failures += 1
    logger.info(unsupportedServerBun)
  }

  for (const subpath of REQUIRED_EXPORTS) {
    const target = manifest.exports?.[subpath]
    const ok = target !== undefined && existsSync(join(root, target))
    if (!ok) failures += 1
    logger.info(`[basis] export ${subpath} ${ok ? 'ok' : 'missing'}`)
  }

  try {
    const result = applyBasisPatches({ basisDir: root, rootDir: installRoot, write: false })
    logger.info(`[basis] owned patches ${result.applied.length + result.retired.length + result.skipped.length}`)

    for (const key of result.skipped) logger.info(`[basis] patch ${key} applied`)
    for (const key of result.applied) {
      failures += 1
      logger.info(`[basis] patch ${key} pending (run \`bun install\`)`)
    }
    for (const key of result.retired) {
      failures += 1
      logger.info(`[basis] patch ${key} retired but still installed (run \`bun install\`)`)
    }
  } catch (error) {
    failures += 1
    logger.info(`[basis] patch ${error instanceof Error ? error.message : String(error)}`)
  }

  const consumerManifest = readJson<BasisManifest>(join(installRoot, 'package.json'))
  if (!(consumerManifest.trustedDependencies ?? []).includes('basis')) {
    failures += 1
    logger.info('[basis] trustedDependencies is missing "basis"; lifecycle hook will not run')
  }

  const consumerPatches = Object.keys(consumerManifest.patchedDependencies ?? {})
  const ownedPatches = Object.keys(manifest.patchedDependencies ?? {})
  const copied = consumerPatches.filter(key => ownedPatches.includes(key))
  if (copied.length > 0) {
    failures += 1
    logger.info(`[basis] legacy copied patches: ${copied.join(', ')}`)
  }

  logger.info(failures === 0 ? '[basis] doctor: ok' : `[basis] doctor: ${failures} problem(s)`)
  return failures === 0 ? 0 : 1
}

/**
 * Prints usage information for the CLI.
 */
const usage = (): void => {
  logger.info([
    'usage: basis <compliance|db <plan|release|backup|restore|upgrade|rollback>',
    '|docs build [--out <dir>] [--base <path>]|docs check|doctor|emit|format|lint|typecheck>',
  ].join(''))
}

/**
 * Dispatches the requested CLI command.
 */
const main = async (): Promise<void> => {
  const [rawCommand, ...args] = process.argv.slice(2)
  const command = Object.values(Command).find(candidate => candidate === rawCommand)

  if (command === Command.Doctor) process.exit(doctor())
  if (command === Command.Emit) process.exit(await runEmit())
  if (command === Command.Lint) process.exit(await runCompleteCheck(false))
  if (command === Command.Format) process.exit(runLint(true))
  if (command === Command.Compliance) process.exit(await runCompleteCheck(true))
  if (command === Command.Typecheck) {
    const emitCode = await runEmit()
    process.exit(emitCode === 0 ? runTypecheck() : emitCode)
  }

  if (command === Command.Database) {
    const { runDatabase } = await import('./database')
    process.exit(await runDatabase(args))
  }

  if (command === Command.Docs) {
    const [subcommand, ...rest] = args
    if (subcommand === 'build') {
      void runDocsBuild(rest).then(code => process.exit(code))
      return
    }
    process.exit(runDocs(args))
  }

  usage()
  process.exit(1)
}

if (import.meta.main) void main()
