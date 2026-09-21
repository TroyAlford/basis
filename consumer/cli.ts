#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  './review',
  './tsconfig/base.json',
  './tsconfig/bun.json',
  './tsconfig/react.json',
]

/**
 * Writes a line to stdout, keeping the CLI free of direct console usage.
 * @param line The text to emit.
 */
const write = (line: string): void => {
  process.stdout.write(`${line}\n`)
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
 * Runs a dependency binary through Bun itself, so no Node shebang is required.
 * @param packageName The dependency package name.
 * @param binName The binary name to run.
 * @param args Arguments for the binary.
 * @returns The child process exit code.
 */
const runBin = (packageName: string, binName: string, args: string[]): number => {
  const result = Bun.spawnSync([process.execPath, resolveBin(packageName, binName), ...args], {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  return result.exitCode
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

  write(`[basis] version ${manifest.version ?? 'unknown'}`)
  write(`[basis] consumer root ${installRoot}`)

  for (const subpath of REQUIRED_EXPORTS) {
    const target = manifest.exports?.[subpath]
    const ok = target !== undefined && existsSync(join(root, target))
    if (!ok) failures += 1
    write(`[basis] export ${subpath} ${ok ? 'ok' : 'missing'}`)
  }

  try {
    const result = applyBasisPatches({ basisDir: root, rootDir: installRoot, write: false })
    write(`[basis] owned patches ${result.applied.length + result.retired.length + result.skipped.length}`)

    for (const key of result.skipped) write(`[basis] patch ${key} applied`)
    for (const key of result.applied) {
      failures += 1
      write(`[basis] patch ${key} pending (run \`bun install\`)`)
    }
    for (const key of result.retired) {
      failures += 1
      write(`[basis] patch ${key} retired but still installed (run \`bun install\`)`)
    }
  } catch (error) {
    failures += 1
    write(`[basis] patch ${error instanceof Error ? error.message : String(error)}`)
  }

  const consumerManifest = readJson<BasisManifest>(join(installRoot, 'package.json'))
  if (!(consumerManifest.trustedDependencies ?? []).includes('basis')) {
    failures += 1
    write('[basis] trustedDependencies is missing "basis"; lifecycle hook will not run')
  }

  const consumerPatches = Object.keys(consumerManifest.patchedDependencies ?? {})
  const ownedPatches = Object.keys(manifest.patchedDependencies ?? {})
  const copied = consumerPatches.filter(key => ownedPatches.includes(key))
  if (copied.length > 0) {
    failures += 1
    write(`[basis] legacy copied patches: ${copied.join(', ')}`)
  }

  write(failures === 0 ? '[basis] doctor: ok' : `[basis] doctor: ${failures} problem(s)`)
  return failures === 0 ? 0 : 1
}

/**
 * Prints usage information for the CLI.
 */
const usage = (): void => {
  write('usage: basis <doctor|lint|typecheck|check>')
}

/**
 * Dispatches the requested CLI command.
 */
const main = (): void => {
  const [command] = process.argv.slice(2)

  if (command === 'doctor') process.exit(doctor())
  if (command === 'lint') process.exit(runBin('eslint', 'eslint', ['.']))
  if (command === 'typecheck') process.exit(runBin('typescript', 'tsc', ['--noEmit']))
  if (command === 'check') {
    const lintCode = runBin('eslint', 'eslint', ['.'])
    const typeCode = lintCode === 0 ? runBin('typescript', 'tsc', ['--noEmit']) : lintCode
    process.exit(typeCode)
  }

  usage()
  process.exit(1)
}

main()
