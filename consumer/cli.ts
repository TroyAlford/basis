#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyBasisPatches, loadBasisPatches } from './patches/install'
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
  /** Declared package version. */
  version?: string,
}

const REQUIRED_EXPORTS = [
  './cli',
  './eslint',
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
    const patches = loadBasisPatches(root)
    const statuses = applyBasisPatches({ basisDir: root, rootDir: installRoot, write: false })
    write(`[basis] owned patches ${patches.length}`)
    for (const status of statuses) write(`[basis] patch ${status.name}@${status.version} ${status.status}`)
  } catch (error) {
    failures += 1
    write(`[basis] patch ${error instanceof Error ? error.message : String(error)}`)
  }

  const consumerManifest = readJson<BasisManifest>(join(installRoot, 'package.json'))
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
 * Runs a locally installed binary through Bun, forwarding stdio and the exit code.
 * @param args The binary and its arguments.
 * @returns The child process exit code.
 */
const run = (args: string[]): number => {
  const result = Bun.spawnSync(['bun', 'x', ...args], {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  return result.exitCode
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
  if (command === 'lint') process.exit(run(['eslint', '.']))
  if (command === 'typecheck') process.exit(run(['tsc', '--noEmit']))
  if (command === 'check') {
    const lintCode = run(['eslint', '.'])
    const typeCode = lintCode === 0 ? run(['tsc', '--noEmit']) : lintCode
    process.exit(typeCode)
  }

  usage()
  process.exit(1)
}

main()
