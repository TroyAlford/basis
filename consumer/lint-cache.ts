import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

/** Cache format version. */
const CACHE_VERSION = 1

/** Source extensions the TypeScript linter accepts. */
const LINT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']

/** Directories no target or cache-key walk should enter. */
const SKIPPED_DIRECTORIES = new Set([
  '.basis',
  '.cache',
  '.git',
  '.playwright-local',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'test-results',
  'tmp',
])

/** The cached result for one source file. */
export interface LintCacheEntry {
  /** Content hash at the time the result was recorded. */
  hash: string,
  /** Whether the file was clean. */
  status: 'ok' | 'error',
}

/** Persisted per-file lint results. */
export interface LintCache {
  /** Per-file results, keyed by repository-relative path. */
  files: Record<string, LintCacheEntry>,
  /** Cache format version. */
  version: typeof CACHE_VERSION,
}

/** Inputs that invalidate a cache when changed. */
export interface LintCacheKeyOptions {
  /** ESLint flat config path. */
  configPath: string,
  /** Repository root. */
  cwd: string,
  /** Rule-source directories whose changes invalidate the cache. */
  sourceRoots: readonly string[],
}

/**
 * Hash arbitrary content.
 * @param value - String or byte content.
 * @returns Hexadecimal SHA-256 digest.
 */
export const hashContent = (value: string | Uint8Array): string => (
  createHash('sha256').update(value).digest('hex')
)

/**
 * Hash one file's contents, treating a missing file as changed.
 * @param path - Absolute file path.
 * @returns Hexadecimal digest.
 */
export const hashFile = (path: string): string => {
  try {
    return hashContent(readFileSync(path))
  } catch {
    return hashContent(`missing:${path}`)
  }
}

/**
 * Whether a file is a TypeScript/JavaScript lint target.
 * @param name - File name.
 * @returns Whether the file should be linted.
 */
const isLintFile = (name: string): boolean => (
  LINT_EXTENSIONS.some(extension => name.endsWith(extension))
  || name.endsWith('.entities.json')
)

/**
 * Collect the source files the linter should visit.
 * @param root - Repository root.
 * @returns Sorted repository-relative file paths.
 */
export const collectLintTargets = (root: string): string[] => {
  const files: string[] = []

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name))
        continue
      }
      if (entry.isFile() && isLintFile(entry.name)) {
        files.push(relative(root, join(directory, entry.name)))
      }
    }
  }

  walk(root)
  return files.sort()
}

/**
 * Hash every file in a source directory so rule-code changes invalidate caches.
 * @param root - Directory to hash.
 * @returns Hexadecimal digest.
 */
const hashDirectory = (root: string): string => {
  const hash = createHash('sha256')
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      const path = join(directory, entry.name)
      hash.update(`${relative(root, path)}\0${hashFile(path)}\0`)
    }
  }

  if (existsSync(root)) walk(root)
  return hash.digest('hex')
}

/**
 * Collect package manifests that can affect dependency-aware rules.
 * @param root - Repository root.
 * @returns Sorted absolute manifest paths.
 */
const collectManifests = (root: string): string[] => {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name))
        continue
      }
      if (entry.isFile() && entry.name === 'package.json') files.push(join(directory, entry.name))
    }
  }
  walk(root)
  return files.sort()
}

/**
 * Build the cache key for one lint configuration.
 * @param options - Config, repository, and rule-source inputs.
 * @returns Hexadecimal cache key.
 */
export const computeLintCacheKey = (options: LintCacheKeyOptions): string => {
  const hash = createHash('sha256')
  hash.update(`basis-lint-cache:${CACHE_VERSION}\0`)
  hash.update(`bun:${Bun.revision ?? Bun.version}\0`)
  hash.update(`config:${hashFile(options.configPath)}\0`)

  for (const root of [...options.sourceRoots].sort()) {
    hash.update(`source:${root}:${hashDirectory(root)}\0`)
  }
  for (const manifest of collectManifests(options.cwd)) {
    hash.update(`manifest:${relative(options.cwd, manifest)}:${hashFile(manifest)}\0`)
  }

  return hash.digest('hex')
}

/**
 * Find files with reported diagnostics in Bun lint output.
 * @param output - Combined stdout and stderr.
 * @param cwd - Repository root.
 * @param targets - Files included in the lint run.
 * @returns Repository-relative paths with errors.
 */
export const erroredLintTargets = (
  output: string,
  cwd: string,
  targets: readonly string[],
): Set<string> => {
  const wanted = new Set(targets)
  const errored = new Set<string>()
  for (const line of output.split('\n')) {
    const candidate = line.trim()
    if (!isAbsolute(candidate)) continue
    const file = relative(cwd, candidate)
    if (wanted.has(file)) errored.add(file)
  }
  return errored
}

/**
 * Select files that need linting on this run.
 * @param targets - Current target list.
 * @param hashes - Current content hashes by target path.
 * @param cache - Previous cache, or null.
 * @returns Changed, new, or previously failing targets.
 */
export const pendingLintTargets = (
  targets: readonly string[],
  hashes: ReadonlyMap<string, string>,
  cache: LintCache | null,
): string[] => targets.filter(target => {
  const entry = cache?.files[target]
  return entry === undefined || entry.status !== 'ok' || entry.hash !== hashes.get(target)
})

/**
 * Resolve the cache file for one key.
 * @param cwd - Repository root.
 * @param key - Cache key.
 * @returns Absolute cache path.
 */
export const lintCachePath = (cwd: string, key: string): string => (
  join(cwd, '.cache', 'basis-lint', key.slice(0, 16), 'cache.json')
)

/**
 * Read a cache file, ignoring malformed or superseded caches.
 * @param path - Cache path.
 * @returns The cache, or null.
 */
export const readLintCache = (path: string): LintCache | null => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LintCache>
    if (parsed.version !== CACHE_VERSION || typeof parsed.files !== 'object' || parsed.files === null) {
      return null
    }
    return parsed as LintCache
  } catch {
    return null
  }
}

/**
 * Persist a cache file atomically.
 * @param path - Cache path.
 * @param cache - Cache contents.
 */
export const writeLintCache = (path: string, cache: LintCache): void => {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(cache)}\n`)
  renameSync(temporary, path)
}
