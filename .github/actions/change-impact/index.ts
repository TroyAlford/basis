#!/usr/bin/env bun
/* eslint-disable no-console -- this is an operator-facing CLI and GitHub Action entrypoint. */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

/*
 * Portable change-impact analysis.
 *
 * The action reads the policy from the merge base, not from the pull request
 * head, so a pull request cannot weaken the gates that validate it. It compares
 * the exact merge base with the head, enumerates every added/modified/deleted/
 * renamed path, and decides each suite from path rules plus a resolved import
 * graph rooted at that suite's test files and declared extra entry points.
 *
 * The default is conservative: an unknown change, an unparseable file, a graph
 * that is too large, or a source file that is not reachable runs the suite.
 * A suite only skips unreachable source when its config explicitly says so.
 */

/** A changed path from `git diff --name-status`. */
export interface ChangedFile {
  /** The old path for a rename or copy. */
  oldPath?: string,
  /** The new path, or the only path for a non-rename. */
  path: string,
  /** Git status letter. */
  status: string,
}

/** The decision for one suite. */
export interface SuiteDecision {
  /** Paths that caused the decision. */
  evidence: string[],
  /** Whether the suite must run. */
  needed: boolean,
  /** Machine-readable reason for the decision. */
  reason: string,
  /** Test files that reach a changed path, when the import graph proves it. */
  selectedTests: string[],
  /** Changed paths the suite could not classify. */
  unknownFiles: string[],
}

/** The complete impact decision for one exact head SHA. */
export interface ImpactDecision {
  /** Enumerated changes. */
  changedFiles: ChangedFile[],
  /** Whether every changed path is documentation. */
  docsOnly: boolean,
  /** Exact head commit the decision represents. */
  headSha: string,
  /** Exact merge base used for the diff. */
  mergeBase: string,
  /** SHA-256 of the policy text read from the merge base. */
  policyHash: string,
  /** Per-suite decisions, keyed by the consumer's suite id. */
  suites: Record<string, SuiteDecision>,
  /** Decision schema version. */
  version: 1,
}

/** A suite's declared rules. */
export interface SuiteConfig {
  /** Paths that always run the suite. */
  alwaysRunGlobs?: string[],
  /** Non-test entry points whose imports also affect the suite. */
  extraRoots?: string[],
  /** Paths the suite declares unrelated unless the import graph proves otherwise. */
  ignoreGlobs?: string[],
  /** `paths` skips the import graph; `imports` is the default. */
  mode?: 'imports' | 'paths',
  /** Globs for source files that can affect this suite. */
  sourceGlobs: string[],
  /** Globs excluded from this suite's test roots, for example another suite's tests. */
  testExcludeGlobs?: string[],
  /** Globs for test files that belong to this suite. */
  testGlobs: string[],
  /** `run` is the fail-safe default; `skip` requires an explicit policy. */
  unreachableSource?: 'run' | 'skip',
}

/** The policy read from the merge base. */
export interface ImpactConfig {
  /** Import prefix aliases, for example `basis/` -> `./consumer/`. */
  aliases?: Record<string, string>,
  /** Documentation paths that never trigger code suites unless a suite claims them. */
  docs?: {
    /** All documentation paths. */
    globs: string[],
  },
  /** Maximum files visited per test root before failing closed. */
  maxGraphFiles?: number,
  /** Per-suite rules. */
  suites: Record<string, SuiteConfig>,
  /** Config schema version. */
  version: 1,
}

/** Options for {@link analyze}. */
export interface AnalyzeOptions {
  /** Enumerated changes. */
  changedFiles: ChangedFile[],
  /** Parsed policy. */
  config: ImpactConfig,
  /** Raw policy text, for the policy hash. */
  configText: string,
  /** Repository working directory. */
  cwd: string,
  /** Exact head commit. */
  headSha: string,
  /** Exact merge base commit. */
  mergeBase: string,
}

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const LOADERS: Record<string, 'ts' | 'tsx' | 'js' | 'jsx'> = {
  '.cjs': 'js',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.ts': 'ts',
  '.tsx': 'tsx',
}
const RESOLVE_EXTENSIONS = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.css', '.scss', '.less', '.svg', '.png', '.woff', '.woff2',
]
const MAX_SOURCE_BYTES = 2_000_000
const transpilers = new Map<string, Bun.Transpiler>()

/**
 * Convert a path to forward slashes for glob matching and stable output.
 * @param path A filesystem path.
 * @returns The POSIX-style path.
 */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Test a path against a list of globs.
 * @param globs Globs to test, or undefined.
 * @param path Repo-relative path.
 * @returns True when any glob matches.
 */
function matches(globs: string[] | undefined, path: string): boolean {
  if (!globs?.length) return false
  return globs.some(glob => new Bun.Glob(glob).match(path))
}

/**
 * Return the paths a change touches, including the old path for a rename.
 * @param file A changed file.
 * @returns One or two repo-relative paths.
 */
function touchedPaths(file: ChangedFile): string[] {
  return file.oldPath ? [file.oldPath, file.path] : [file.path]
}

/**
 * Read the policy text from the exact merge base.
 * @param cwd Repository working directory.
 * @param mergeBase Exact merge base commit.
 * @param configPath Repo-relative policy path.
 * @returns The policy text.
 */
function policyFromBase(cwd: string, mergeBase: string, configPath: string): string {
  return git(['show', `${mergeBase}:${configPath}`], cwd)
}

/**
 * Run a git command and return its standard output.
 * @param args Arguments after `git`.
 * @param cwd Repository working directory.
 * @returns Standard output.
 */
function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) {
    const detail = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return new TextDecoder().decode(result.stdout)
}

/**
 * Enumerate changes between two commits, including renames and deletions.
 * @param cwd Repository working directory.
 * @param mergeBase Exact merge base commit.
 * @param headSha Exact head commit.
 * @returns Sorted changed files.
 */
export function changedFiles(cwd: string, mergeBase: string, headSha: string): ChangedFile[] {
  const output = git(['diff', '--name-status', '-M', '-z', mergeBase, headSha], cwd)
  const parts = output.split('\u0000')
  const files: ChangedFile[] = []
  for (let index = 0; index < parts.length;) {
    const status = parts[index++]
    if (!status) continue
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[index++]
      const path = parts[index++]
      files.push({ oldPath, path, status: status[0] })
    } else {
      const path = parts[index++]
      files.push({ path, status: status[0] })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Test whether a path is a regular, reasonably sized file.
 *
 * `lstat` is deliberate: a pull request can contain a symlink, and the
 * analyzer must not follow it outside the checkout or read a device.
 * @param path Candidate path.
 * @returns True for a regular file within the size limit.
 */
function isSafeFile(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && stat.size <= MAX_SOURCE_BYTES
  } catch {
    return false
  }
}

/**
 * Resolve a file path, trying source extensions and directory indexes.
 * @param base Absolute or working-directory-relative path without an extension.
 * @returns The resolved file, or null.
 */
function resolveFile(base: string): string | null {
  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (existsSync(candidate) && isSafeFile(candidate)) return candidate
  }
  if (existsSync(base)) {
    try {
      if (!lstatSync(base).isDirectory()) return null
    } catch {
      return null
    }
    for (const extension of RESOLVE_EXTENSIONS.slice(1)) {
      const candidate = join(base, `index${extension}`)
      if (isSafeFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve an import specifier to a repository file.
 * @param specifier Import specifier.
 * @param fromFile Absolute importing file.
 * @param cwd Repository working directory.
 * @param aliases Import prefix aliases.
 * @returns The absolute resolved file, or null for bare packages and unresolved imports.
 */
function resolveImport(
  specifier: string,
  fromFile: string,
  cwd: string,
  aliases: Record<string, string>,
): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return resolveFile(resolve(dirname(fromFile), specifier))
  }
  for (const [prefix, target] of Object.entries(aliases)) {
    if (specifier !== prefix && !specifier.startsWith(prefix)) continue
    return resolveFile(join(cwd, target, specifier.slice(prefix.length)))
  }
  return null
}

/** Imports found in one file. */
interface ScannedImports {
  /** Whether the file contains an unresolved dynamic import. */
  dynamic: boolean,
  /** Import specifiers. */
  imports: string[],
}

/**
 * Extract imports from a source, style, or asset file.
 * @param file Absolute file path.
 * @returns Import specifiers and dynamic-import state.
 */
function scanImports(file: string): ScannedImports {
  const extension = extname(file).toLowerCase()
  if (!JS_EXTENSIONS.has(extension) && !['.css', '.scss', '.less'].includes(extension)) {
    return { dynamic: false, imports: [] }
  }
  if (!isSafeFile(file)) return { dynamic: true, imports: [] }

  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { dynamic: true, imports: [] }
  }

  if (!JS_EXTENSIONS.has(extension)) {
    const imports = [...text.matchAll(/@(?:import|use)\s+(?:url\()?['"]([^'"]+)['"]/g)]
      .map(match => match[1])
    return { dynamic: false, imports }
  }

  const loader = LOADERS[extension]
  let transpiler = transpilers.get(loader)
  if (!transpiler) {
    transpiler = new Bun.Transpiler({ loader })
    transpilers.set(loader, transpiler)
  }

  try {
    const imports = transpiler.scanImports(text)
      .map(record => record.path)
      .filter((path): path is string => Boolean(path))
    return {
      dynamic: /import\s*\(|import\.meta\.glob|require\.context/.test(text),
      imports,
    }
  } catch {
    return { dynamic: true, imports: [] }
  }
}

/** The import graph for one suite. */
interface SuiteGraph {
  /** Map from a repo-relative path to the test roots that reach it. */
  dependents: Map<string, Set<string>>,
  /** Whether any root could not be parsed or used a dynamic import. */
  dynamic: boolean,
  /** Whether the graph exceeded the configured limit. */
  tooLarge: boolean,
}

/**
 * Build the reverse dependency graph for a suite.
 * @param cwd Repository working directory.
 * @param roots Absolute test and entry-point paths.
 * @param aliases Import prefix aliases.
 * @param maxFiles Maximum files visited per root.
 * @returns The reverse dependency graph.
 */
function suiteGraph(
  cwd: string,
  roots: string[],
  aliases: Record<string, string>,
  maxFiles: number,
): SuiteGraph {
  const dependents = new Map<string, Set<string>>()
  const scanCache = new Map<string, ScannedImports>()
  let dynamic = false
  let tooLarge = false

  for (const root of roots) {
    const rootPath = toPosix(relative(cwd, root))
    const stack = [root]
    const visited = new Set<string>()

    while (stack.length) {
      if (visited.size > maxFiles) {
        tooLarge = true
        break
      }
      const file = stack.pop() as string
      if (visited.has(file)) continue
      visited.add(file)

      let scanned = scanCache.get(file)
      if (!scanned) {
        scanned = scanImports(file)
        scanCache.set(file, scanned)
      }
      if (scanned.dynamic) dynamic = true

      const filePath = toPosix(relative(cwd, file))
      const owners = dependents.get(filePath) ?? new Set<string>()
      owners.add(rootPath)
      dependents.set(filePath, owners)

      for (const specifier of scanned.imports) {
        const resolved = resolveImport(specifier, file, cwd, aliases)
        if (!resolved) continue
        const path = toPosix(relative(cwd, resolved))
        if (path.startsWith('..') || path.split('/').includes('node_modules')) continue
        stack.push(resolved)
      }
    }
    if (tooLarge) break
  }

  return { dependents, dynamic, tooLarge }
}

/**
 * List repository files matching a set of globs.
 * @param cwd Repository working directory.
 * @param globs Globs to expand.
 * @returns Sorted absolute paths.
 */
function expandGlobs(cwd: string, globs: string[]): string[] {
  const paths = new Set<string>()
  for (const glob of globs) {
    for (const path of new Bun.Glob(glob).scanSync({ cwd, dot: true, onlyFiles: true })) {
      paths.add(resolve(cwd, path))
    }
  }
  return [...paths].sort()
}

/**
 * Test whether a path is a test file.
 *
 * Includes the opt-in `.screenshot` and `.e2e` lanes as well as Bun's default
 * `.test`/`.spec`, so a test owned by another suite does not count as
 * unreachable source for this one.
 * @param path Repo-relative path.
 * @returns True for a supported test filename.
 */
function isTestFile(path: string): boolean {
  return /(^|\/)[^/]+\.(test|spec|screenshot|e2e)\.[^/]+$/.test(path)
}

/**
 * Unique and sort a list of strings.
 * @param values Values to deduplicate.
 * @returns The unique sorted values.
 */
function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * Decide one suite.
 * @param suite Suite rules.
 * @param files Enumerated changes.
 * @param options Analysis options.
 * @param docsGlobs Documentation globs from the policy.
 * @returns The suite decision.
 */
function analyzeSuite(
  suite: SuiteConfig,
  files: ChangedFile[],
  options: AnalyzeOptions,
  docsGlobs: string[],
): SuiteDecision {
  const evidence: string[] = []
  const selectedTests = new Set<string>()
  const unknownFiles = new Set<string>()
  let reason = 'no-impact'
  let needed = false

  const roots = [
    ...expandGlobs(options.cwd, suite.testGlobs)
      .filter(path => !matches(suite.testExcludeGlobs, toPosix(relative(options.cwd, path)))),
    ...(suite.extraRoots ?? []).map(path => resolve(options.cwd, path)),
  ]
  const graph = suite.mode === 'paths'
    ? { dependents: new Map<string, Set<string>>(), dynamic: false, tooLarge: false }
    : suiteGraph(options.cwd, roots, options.config.aliases ?? {}, options.config.maxGraphFiles ?? 20_000)

  if (graph.tooLarge) {
    return {
      evidence: ['import graph exceeded maxGraphFiles'],
      needed: true,
      reason: 'graph-too-large',
      selectedTests: [],
      unknownFiles: [],
    }
  }

  for (const file of files) {
    for (const path of touchedPaths(file)) {
      const dependents = graph.dependents.get(path)
      const isAlways = matches(suite.alwaysRunGlobs, path)
      const isTest = matches(suite.testGlobs, path) && !matches(suite.testExcludeGlobs, path)
      const isSource = matches(suite.sourceGlobs, path)
      const isIgnored = matches(suite.ignoreGlobs, path)
      const isDocs = matches(docsGlobs, path)

      if (isAlways) {
        needed = true
        if (reason === 'no-impact') reason = 'always-run'
        evidence.push(path)
        continue
      }

      if (isTest) {
        needed = true
        if (reason === 'no-impact') reason = 'test-changed'
        selectedTests.add(path)
        evidence.push(path)
        continue
      }

      if (dependents?.size) {
        needed = true
        if (reason === 'no-impact') reason = 'import-reachable'
        for (const root of dependents) {
          if (matches(suite.testGlobs, root) && !matches(suite.testExcludeGlobs, root)) {
            selectedTests.add(root)
          }
        }
        evidence.push(path)
        continue
      }

      /*
       * A test file from another suite is not evidence for this suite unless
       * this suite's import graph reaches it. Path-only suites (quality) still
       * lint and typecheck every test file.
       */
      if (suite.mode !== 'paths' && isTestFile(path)) continue

      if (isSource) {
        if ((file.status === 'D' || file.status === 'R') && !isIgnored) {
          needed = true
          if (reason === 'no-impact') reason = 'deleted-or-renamed-source'
          evidence.push(path)
          continue
        }
        if ((suite.unreachableSource ?? 'run') === 'run') {
          needed = true
          const conservativeReason = graph.dynamic
            ? 'dynamic-import-conservative'
            : 'unreachable-source-conservative'
          if (reason === 'no-impact') reason = conservativeReason
          evidence.push(path)
          continue
        }
        continue
      }

      if (isIgnored || isDocs) continue
      unknownFiles.add(path)
    }
  }

  if (unknownFiles.size) {
    return {
      evidence: unique([...evidence, ...unknownFiles]),
      needed: true,
      reason: 'unknown-change-conservative',
      selectedTests: [...selectedTests].sort(),
      unknownFiles: [...unknownFiles].sort(),
    }
  }

  return {
    evidence: unique(evidence),
    needed,
    reason,
    selectedTests: [...selectedTests].sort(),
    unknownFiles: [],
  }
}

/**
 * Analyze a set of changes against a parsed policy.
 * @param options Analysis options.
 * @returns The exact-head decision.
 */
export function analyze(options: AnalyzeOptions): ImpactDecision {
  const suites = Object.fromEntries(
    Object.entries(options.config.suites)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, suite]) => [
        key,
        analyzeSuite(suite, options.changedFiles, options, options.config.docs?.globs ?? []),
      ]),
  )

  return {
    changedFiles: options.changedFiles,
    docsOnly: options.config.docs?.globs
      ? options.changedFiles.every(file => touchedPaths(file).every(path => matches(options.config.docs?.globs, path)))
      : false,
    headSha: options.headSha,
    mergeBase: options.mergeBase,
    policyHash: createHash('sha256').update(options.configText).digest('hex'),
    suites,
    version: 1,
  }
}

/**
 * Recursively sort object keys for a stable decision hash.
 * @param value Any JSON value.
 * @returns The same value with sorted keys.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortKeysDeep(nested)]),
    )
  }
  return value
}

/**
 * Compute the canonical decision hash.
 * @param decision A decision.
 * @returns Lower-case SHA-256.
 */
export function decisionHash(decision: ImpactDecision): string {
  return createHash('sha256').update(JSON.stringify(sortKeysDeep(decision))).digest('hex')
}

/**
 * Append the decision and its derived outputs to `GITHUB_OUTPUT`.
 * @param outputFile GitHub output file path.
 * @param decision A decision.
 * @param json Pretty-printed decision JSON.
 */
function writeOutputs(outputFile: string, decision: ImpactDecision, json: string): void {
  if (json.length > 900_000) {
    throw new Error(
      'impact decision exceeds the GitHub output limit; reduce the evidence lists or inspect the artifact',
    )
  }
  const delimiter = '__BASIS_IMPACT_DECISION__'
  appendFileSync(outputFile, `decision<<${delimiter}\n${json.trimEnd()}\n${delimiter}\n`)
  appendFileSync(outputFile, `decision-hash=${decisionHash(decision)}\n`)
  appendFileSync(outputFile, `policy-hash=${decision.policyHash}\n`)
  appendFileSync(outputFile, `merge-base=${decision.mergeBase}\n`)
  appendFileSync(outputFile, `head-sha=${decision.headSha}\n`)
  appendFileSync(outputFile, `docs-only=${decision.docsOnly}\n`)
  appendFileSync(outputFile, `any-needed=${Object.values(decision.suites).some(suite => suite.needed)}\n`)
  for (const [key, suite] of Object.entries(decision.suites)) {
    appendFileSync(outputFile, `${key}-needed=${suite.needed}\n`)
  }
}

/**
 * Verify the Bun capability the analyzer relies on.
 */
function assertCapabilities(): void {
  if (typeof Bun.Transpiler !== 'function') {
    throw new Error('Bun.Transpiler is required; use a Bun version with import scanning support')
  }
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  if (typeof transpiler.scanImports !== 'function') {
    throw new Error('Bun.Transpiler.scanImports is required; use a Bun version with import scanning support')
  }
}

/**
 * Test that a value is an array of strings.
 * @param value Candidate value.
 * @returns True for a string array.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * Validate a parsed policy before analysis.
 * @param config Parsed policy.
 */
function validateConfig(config: ImpactConfig): void {
  if (config.version !== 1) throw new Error(`unsupported impact config version: ${String(config.version)}`)
  if (!config.suites || typeof config.suites !== 'object') {
    throw new Error('impact config must declare suites')
  }
  if (config.aliases !== undefined) {
    if (!config.aliases || typeof config.aliases !== 'object') throw new Error('aliases must be an object')
    for (const [prefix, target] of Object.entries(config.aliases)) {
      if (typeof prefix !== 'string' || typeof target !== 'string') {
        throw new Error('aliases must map strings to strings')
      }
    }
  }
  if (config.docs !== undefined && !isStringArray(config.docs.globs)) {
    throw new Error('docs.globs must be an array of strings')
  }
  if (config.maxGraphFiles !== undefined && (!Number.isInteger(config.maxGraphFiles) || config.maxGraphFiles < 1)) {
    throw new Error('maxGraphFiles must be a positive integer')
  }

  for (const [key, suite] of Object.entries(config.suites)) {
    if (!suite || typeof suite !== 'object') throw new Error(`suite ${key} must be an object`)
    if (!isStringArray(suite.testGlobs)) throw new Error(`suite ${key} testGlobs must be an array of strings`)
    if (!isStringArray(suite.sourceGlobs)) throw new Error(`suite ${key} sourceGlobs must be an array of strings`)
    for (const field of ['alwaysRunGlobs', 'ignoreGlobs', 'testExcludeGlobs', 'extraRoots'] as const) {
      if (suite[field] !== undefined && !isStringArray(suite[field])) {
        throw new Error(`suite ${key} ${field} must be an array of strings`)
      }
    }
    if (suite.unreachableSource !== undefined && !['run', 'skip'].includes(suite.unreachableSource)) {
      throw new Error(`suite ${key} unreachableSource must be run or skip`)
    }
    if (suite.mode !== undefined && !['imports', 'paths'].includes(suite.mode)) {
      throw new Error(`suite ${key} mode must be imports or paths`)
    }
  }
}

/** Parsed command-line options. */
interface CliOptions {
  /** Base ref used to compute the merge base. */
  baseRef: string,
  /** Repo-relative policy path. */
  configPath: string,
  /** Read the policy from the base or the working tree. */
  configSource: 'base' | 'head',
  /** Working directory. */
  cwd: string,
  /** Exact head SHA, or `HEAD`. */
  headSha: string,
  /** Output file, or null to only print. */
  output: string | null,
}

/**
 * Parse command-line arguments.
 * @param argv Arguments after the script name.
 * @returns Parsed options.
 */
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseRef: 'origin/main',
    configPath: '.github/ci-impact.json',
    configSource: 'base',
    cwd: process.cwd(),
    headSha: 'HEAD',
    output: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    switch (argument) {
      case '--base-ref':
        options.baseRef = value
        index += 1
        break
      case '--head-sha':
        options.headSha = value
        index += 1
        break
      case '--config-path':
        options.configPath = value
        index += 1
        break
      case '--config-source':
        options.configSource = value === 'head' ? 'head' : 'base'
        index += 1
        break
      case '--cwd':
        options.cwd = resolve(value)
        index += 1
        break
      case '--output':
        options.output = value
        index += 1
        break
      default:
        throw new Error(`unknown argument: ${argument}`)
    }
  }
  return options
}

/**
 * Run the analyzer as a CLI.
 */
function main(): void {
  assertCapabilities()
  const options = parseArgs(process.argv.slice(2))
  const cwd = options.cwd
  const headSha = options.headSha === 'HEAD'
    ? git(['rev-parse', 'HEAD'], cwd).trim()
    : options.headSha
  const mergeBase = git(['merge-base', options.baseRef, headSha], cwd).trim()
  const configText = options.configSource === 'head'
    ? readFileSync(resolve(cwd, options.configPath), 'utf8')
    : policyFromBase(cwd, mergeBase, options.configPath)
  const config = JSON.parse(configText) as ImpactConfig
  validateConfig(config)

  const decision = analyze({
    changedFiles: changedFiles(cwd, mergeBase, headSha),
    config,
    configText,
    cwd,
    headSha,
    mergeBase,
  })
  const json = `${JSON.stringify(decision, null, 2)}\n`
  if (options.output) writeFileSync(resolve(cwd, options.output), json)
  process.stdout.write(json)
  if (process.env.GITHUB_OUTPUT) writeOutputs(process.env.GITHUB_OUTPUT, decision, json)
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`change-impact: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
